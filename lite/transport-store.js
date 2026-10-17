/* Transport events are browser-local. One completed trip is the source of both truck and excavator counts. */
(() => {
  "use strict";
  const KEY="mine-management-lite-transport-v1", L=window.MineLogistics;
  const roles=["driver","excavator","dispatch"], uid=()=>crypto.randomUUID(), now=()=>new Date().toISOString();
  const fail=message=>{throw new Error(message);}, clone=v=>JSON.parse(JSON.stringify(v));
  const materialTypes=Object.freeze(["渣","煤","只记车数"]);
  const shiftTimeDefaults=Object.freeze({"白班":Object.freeze({start:"08:00",end:"20:00"}),"夜班":Object.freeze({start:"20:00",end:"08:00"})});
  const clockMinutes=value=>{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value)))fail("班次时间请使用HH:mm格式");return Number(value.slice(0,2))*60+Number(value.slice(3));};
  const shiftContains=(times,minute)=>{const start=clockMinutes(times.start),end=clockMinutes(times.end);return start<end?minute>=start&&minute<end:minute>=start||minute<end;};
  function currentShift(times,at=new Date()){const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Ulaanbaatar",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(at),values=Object.fromEntries(parts.map(p=>[p.type,p.value])),minute=Number(values.hour)*60+Number(values.minute);const matches=["白班","夜班"].filter(name=>shiftContains(times[name],minute));return matches.length===1?matches[0]:null;}
  const defaults={dwellSeconds:20,maxAccuracy:50,gapSeconds:90,exitMargin:15,maxSpeedKmh:150};
  function get(){let d;try{d=JSON.parse(localStorage.getItem(KEY)||"null");}catch{fail("运输台账无法读取，请保留浏览器数据并联系管理员");}if(!d)d={version:1,revision:0,settings:{...defaults},assignments:[],zones:[],shifts:[],inspections:[],faults:[],trips:[],devices:[],messages:[],audit:[]};for(const key of ["assignments","zones","shifts","inspections","faults","trips","devices","messages","audit"])if(!Array.isArray(d[key]))fail("运输台账格式异常");if(d.productionGroups==null)d.productionGroups=[];if(!Array.isArray(d.productionGroups))fail("生产设备组草稿格式异常");for(const group of d.productionGroups){if(group.followingTrucks==null)group.followingTrucks=group.followingTruck?[{...group.followingTruck}]:(group.vehicleId&&group.personId?[{id:group.id+"-truck-1",status:"draft",vehicleId:"",personId:"",createdAt:group.updatedAt||group.createdAt}]:[]);if(!Array.isArray(group.followingTrucks))fail("跟随汽车草稿格式异常");}if(d.auxiliaryPlans==null)d.auxiliaryPlans=[];if(!Array.isArray(d.auxiliaryPlans)||d.auxiliaryPlans.some(p=>!Array.isArray(p.cards)))fail("辅助车辆草稿格式异常");if(d.taskReleases==null)d.taskReleases=[];if(!Array.isArray(d.taskReleases))fail("任务发布记录格式异常");d.settings={...defaults,...d.settings};d.shiftTimes=Object.fromEntries(["白班","夜班"].map(name=>[name,{...shiftTimeDefaults[name],...d.shiftTimes?.[name]}]));return d;}
  function context(role){if(!roles.includes(role))fail("无效工作端口");const p=L.context(role);if(!L.active(p))fail("当前人员状态不能进入运输工作台，请返回登记状态页");return p;}
  const date=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Ulaanbaatar"});
  const isExcavator=v=>/挖/.test(String(v?.category||v?.model||""));
  const isHaulTruck=v=>/自卸|矿卡/.test(String(v?.category||v?.model||""));
  const auxiliaryRoles=["assistant_loader","assistant_fuel","assistant_water","assistant_grader","assistant_dump","assistant"];
  const isAuxiliaryVehicle=v=>!!v&&!isExcavator(v)&&!isHaulTruck(v);
  const sameDraftShift=(r,c)=>r.workDate===c.workDate&&r.shiftName===c.shiftName;
  function draftSlots(d,c){
    const slots=[];for(const g of d.productionGroups.filter(g=>g.status==="draft"&&sameDraftShift(g,c))){slots.push({id:g.id,vehicleId:g.vehicleId,personId:g.personId});for(const t of g.followingTrucks.filter(t=>t.status==="draft"))slots.push({id:t.id,vehicleId:t.vehicleId,personId:t.personId});}
    for(const plan of d.auxiliaryPlans.filter(p=>sameDraftShift(p,c)))for(const card of plan.cards.filter(c=>c.status==="draft"))slots.push({id:card.id,vehicleId:card.vehicleId,personId:card.personId});
    return slots;
  }
  function requireFree(d,c,field,value,except){if(value&&draftSlots(d,c).some(slot=>slot.id!==except&&slot[field]===value))fail(field==="vehicleId"?"该设备已在本班其他配置中选择":"该人员已在本班其他配置中选择");}
  const liveTrip=t=>["loaded","hauling","review"].includes(t.status);
  const ownShift=(d,pid)=>d.shifts.find(s=>s.personId===pid&&s.status!=="closed");
  const shiftTrip=(d,s)=>s?d.trips.find(t=>t.shiftId===s.id&&liveTrip(t)):null;
  const audit=(d,a,type,detail,extra={})=>d.audit.unshift({id:uid(),at:now(),personId:a.id,actor:a.name,role:a.applicationRole,type,detail,...extra});
  function notify(d,target,body,ref){d.messages.unshift({id:uid(),target,body,ref,at:now(),readBy:[]});}
  const named=(v,label,max=300)=>{const s=String(v??"").trim();if(s.length>max)fail(label+"最多"+max+"字");return s;};
  function materialValue(value){const text=named(value,"物料类型",60);if(text&&!materialTypes.includes(text))fail("物料类型请选择渣、煤或只记车数");return text;}
  function optionalNumber(value,label,min,max){if(value===""||value==null)return null;const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)fail(label+"超出有效范围");return n;}
  function distance(a,b){const rad=Math.PI/180,dlat=(b.lat-a.lat)*rad,dlng=(b.lng-a.lng)*rad;const v=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlng/2)**2;return 6371000*2*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));}
  const validZone=z=>Number.isFinite(z.lat)&&Number.isFinite(z.lng)&&Number.isFinite(z.radius)&&z.radius>0;
  const inside=(p,z)=>validZone(z)&&distance(p,z)+p.accuracy<=z.radius;
  const outside=(p,z,margin)=>distance(p,z)-p.accuracy>=z.radius+margin;
  function equipmentState(d,m,id){const v=m.vehicles.find(v=>v.id===id);if(!v)return "missing";if(v.status==="停用")return "disabled";if(v.status==="维修中")return "repair";return d.devices.find(s=>s.vehicleId===id)?.mode||"working";}
  const working=(d,m,id)=>equipmentState(d,m,id)==="working";
  function actorFrom(m,actor){if(!roles.includes(actor?.role))fail("无效端口");const p=m.people.find(p=>p.id===L.currentId(actor.role));if(!p||p.id!==actor.personId||p.applicationRole!==actor.role||!L.active(p))fail("人员状态或本人登记已变化，请重新进入工作台");return p;}
  const dispatchOnly=a=>{if(a.applicationRole!=="dispatch")fail("仅调度可操作");};
  const operatorOnly=a=>{if(!["driver","excavator"].includes(a.applicationRole))fail("仅驾驶/挖机操作人员可操作");};
  function requireShift(d,a){const s=ownShift(d,a.id);if(!s)fail("请先接班并完成检查");return s;}
  function requireWorking(d,a){const s=requireShift(d,a);if(s.status!=="working")fail("请先完成使用前检查并开始作业");const assignment=d.assignments.find(r=>r.id===s.assignmentId);if(assignment?.releaseId){const release=d.taskReleases.find(r=>r.id===assignment.releaseId),phase=release?window.MineTaskEngine.phase(release):"missing";if(!["running","ended"].includes(phase))fail("任务尚未开始或已被替代，不能执行作业");}return s;}
  function setDevice(d,vehicleId,mode,reason,a){
    let item=d.devices.find(v=>v.vehicleId===vehicleId);if(!item){item={vehicleId};d.devices.push(item);}Object.assign(item,{mode,reason,by:a.id,at:now()});
    if(mode!=="working")for(const s of d.shifts.filter(s=>s.kind==="driver"&&s.status!=="closed")){
      const assignment=d.assignments.find(r=>r.id===s.assignmentId);
      if((s.tempExcavatorId||assignment?.excavatorId)===vehicleId)resetCandidate(s);
      if(s.vehicleId===vehicleId)reviewTrip(d,s,shiftTrip(d,s),"驾驶设备已暂停："+reason,a);
    }
    audit(d,a,"设备状态",vehicleId+" → "+mode+"；"+reason,{vehicleId});
  }
  function resetCandidate(s){s.candidate=null;}
  function reviewTrip(d,s,trip,reason,a){resetCandidate(s);s.locationWarning=reason;if(trip&&trip.status!=="review"){trip.resumeStatus=trip.status;trip.status="review";trip.reviewReason=reason;trip.unloadCandidate=null;trip.events.push({at:now(),type:"定位中断待核对",reason});notify(d,s.personId,"本趟运输待核对："+reason,trip.id);notify(d,"dispatch",s.personName+"运输定位待核对："+reason,trip.id);audit(d,a,"车次待核对",reason,{tripId:trip.id});}}
  function completeTrip(d,s,t,method,p,zone,material,a){if(!liveTrip(t))fail("本趟已结束，不能重复计车");Object.assign(t,{status:"completed",completedAt:now(),method,unloadPoint:p?clone(p):null,unloadZone:zone?clone(zone):null,material:material||"未分类",materialSource:zone?"卸载区":"区外卸料填写",unloadCandidate:null});t.events.push({at:now(),type:method==="gps"?"GPS卸载区完成":"非卸载区卸料",point:p?clone(p):null});resetCandidate(s);s.tempExcavatorId=null;notify(d,t.personId,"本趟卸料完成，车辆和实际装载挖机各计1车",t.id);notify(d,"exc:"+t.excavatorId,t.vehicleCode+"已卸料，装载车次完成："+t.material,t.id);if(method==="outside")notify(d,"dispatch",t.personName+"提交非卸载区卸料，已计1车："+t.material,t.id);audit(d,a,"运输完成",t.vehicleCode+" → "+t.excavatorCode+"；"+t.material+"；"+method,{tripId:t.id,mode:t.mode});}
  function startLoad(d,m,s,z,p,a){const assignment=d.assignments.find(v=>v.id===s.assignmentId),exc=m.vehicles.find(v=>v.id===(s.tempExcavatorId||assignment?.excavatorId));if(!assignment||!exc||!working(d,m,exc.id))fail("装载挖机当前不可作业，请选择可用的临时挖机");const taskZones=window.MineTaskEngine?.zonesFor(d,assignment,exc.id);const t={id:uid(),shiftId:s.id,assignmentId:s.assignmentId,releaseId:assignment.releaseId||null,taskId:assignment.taskId||null,personId:s.personId,personName:s.personName,vehicleId:s.vehicleId,vehicleCode:s.vehicleCode,workDate:s.workDate,shiftName:s.shiftName,excavatorId:exc.id,excavatorCode:exc.code,originalExcavatorId:assignment.excavatorId,isTemporary:exc.id!==assignment.excavatorId,mode:p.mode,status:"loaded",loadedAt:now(),loadPoint:clone(p),loadZone:clone(z),unloadZones:clone((taskZones?taskZones.unloads:d.zones.filter(z=>z.enabled&&z.kind==="unload"&&validZone(z))).map(z=>!z.material||materialTypes.includes(z.material)?z:{...z,legacyMaterial:z.material,material:""})),settings:clone(d.settings),zoneRevision:d.revision,events:[{at:now(),type:"装载区有效停留",point:clone(p)}]};d.trips.unshift(t);s.tempExcavatorId=null;resetCandidate(s);notify(d,"exc:"+exc.id,s.vehicleCode+"已在装载区形成在途车次",t.id);audit(d,a,"装载车次开始",s.vehicleCode+" 在 "+exc.code+" 装载",{tripId:t.id,mode:p.mode});return t;}
  function location(d,m,a,x){if(a.applicationRole!=="driver")fail("仅司机端处理运输定位");const s=requireWorking(d,a);if(!working(d,m,s.vehicleId))fail("当前车辆已暂停、维修或停用");let t=shiftTrip(d,s);const settings=t?.settings||d.settings,mode=x.mode;if(!["gps","simulation"].includes(mode))fail("请选择定位来源");if(t&&t.mode!==mode)fail("在途车次不能切换定位来源，请先处理本趟");
    const p={lat:optionalNumber(x.lat,"纬度",-90,90),lng:optionalNumber(x.lng,"经度",-180,180),accuracy:optionalNumber(x.accuracy,"定位精度",0,100000),ts:Number(x.ts),mode};if(p.lat==null||p.lng==null||p.accuracy==null||!Number.isFinite(p.ts))fail("尚未获得有效位置，请开启定位或输入模拟坐标");if(Math.abs(Date.now()-p.ts)>60000){s.locationWarning="位置时间已过期，等待新的定位";resetCandidate(s);return;}
    if(s.lastPoint?.mode!==mode){s.lastPoint=null;resetCandidate(s);}if(s.lastPoint&&p.ts<=s.lastPoint.ts)return;
    if(p.accuracy>settings.maxAccuracy){s.locationWarning="定位精度不足，当前误差约 "+Math.round(p.accuracy)+" 米";resetCandidate(s);if(t)t.unloadCandidate=null;return;}
    if(s.lastPoint&&p.ts-s.lastPoint.ts>settings.gapSeconds*1000){reviewTrip(d,s,t,"定位间隔超过 "+settings.gapSeconds+" 秒",a);s.lastPoint=p;s.track=[...(s.track||[]),p].slice(-80);if(t)return;}
    if(s.lastPoint&&mode==="gps"&&p.ts>s.lastPoint.ts&&distance(s.lastPoint,p)/(p.ts-s.lastPoint.ts)*3600>settings.maxSpeedKmh){reviewTrip(d,s,t,"定位发生明显跳点，未自动计车",a);s.lastRejectedPoint=p;s.lastPoint=p;return;}
    s.lastPoint=p;s.track=[...(s.track||[]),p].slice(-80);s.locationWarning="";if(t?.status==="review"){s.locationWarning=t.reviewReason;return;}
    if(!t){const assignment=d.assignments.find(v=>v.id===s.assignmentId),excId=s.tempExcavatorId||assignment?.excavatorId;if(!excId){s.locationWarning="尚未绑定装载挖机";return;}if(!working(d,m,excId)){s.locationWarning="绑定挖机暂停/维修，请选择临时非绑定挖机";resetCandidate(s);return;}
      if(assignment?.releaseId&&Date.now()>=Date.parse(assignment.endAt)){s.locationWarning="班次时间已结束，不再开始新装载；可完成原在途车次";resetCandidate(s);return;}
      const taskZones=window.MineTaskEngine?.zonesFor(d,assignment,excId);
      const loading=(taskZones?(taskZones.load?[taskZones.load]:[]):d.zones.filter(z=>z.enabled&&z.kind==="load")).filter(z=>inside(p,z)),unloading=(taskZones?taskZones.unloads:d.zones.filter(z=>z.enabled&&z.kind==="unload")).filter(z=>inside(p,z));
      if(taskZones&&!taskZones.load){s.locationWarning="当前任务未配置装载区，请联系调度发布区域设置";resetCandidate(s);return;}if(loading.length!==1||unloading.length){resetCandidate(s);if(loading.length>1||(loading.length&&unloading.length))s.locationWarning="作业区域重叠，暂不自动识别装载";return;}
      const z=loading[0];if(s.candidate?.zoneId!==z.id)s.candidate={zoneId:z.id,since:p.ts,kind:"load"};if(p.ts-s.candidate.since>=settings.dwellSeconds*1000)startLoad(d,m,s,z,p,a);return;
    }
    if(t.status==="loaded"&&outside(p,t.loadZone,settings.exitMargin)){t.status="hauling";t.departedAt=now();t.events.push({at:now(),type:"离开装载区",point:clone(p)});}
    if(t.status!=="hauling")return;const unloading=t.unloadZones.filter(z=>inside(p,z));if(unloading.length!==1){t.unloadCandidate=null;if(unloading.length>1)s.locationWarning="卸载区重叠，暂不自动计车";return;}const z=unloading[0];if(t.unloadCandidate?.zoneId!==z.id)t.unloadCandidate={zoneId:z.id,since:p.ts};if(p.ts-t.unloadCandidate.since>=settings.dwellSeconds*1000)completeTrip(d,s,t,"gps",p,z,z.material,a);
  }
  function execute(d,m,a,type,x){const find=(array,id)=>d[array].find(v=>v.id===id)||fail("记录不存在，请刷新");
    if(type==="publishTasks"){dispatchOnly(a);return window.MineTaskEngine.publish(d,m,a,x);}
    if(type==="productionGroup"){
      dispatchOnly(a);
      const team=String(x.team||""),shiftName=String(x.shiftName||""),workDate=named(x.workDate,"日期",10)||date();
      if(!["生产A组","生产B组"].includes(team)||!["白班","夜班"].includes(shiftName))fail("请先选择有效班次和生产班组");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(workDate))fail("日期格式不正确");
      if(!["open","equipment","driver","remove","truckEquipment","truckDriver","removeTruck","addTruck","regions","add"].includes(x.action))fail("无效的生产设备组操作");
      const scope=g=>g.workDate===workDate&&g.shiftName===shiftName&&g.team===team;
      const renumber=()=>{
        const active=d.productionGroups.filter(g=>scope(g)&&g.status==="draft").sort((a,b)=>Number(a.number)-Number(b.number)||String(a.createdAt||"").localeCompare(String(b.createdAt||""))||a.id.localeCompare(b.id));
        const changes=[];active.forEach((g,index)=>{const number=index+1;if(g.number!==number){changes.push({id:g.id,before:g.number,after:number});g.number=number;}});
        if(changes.length)audit(d,a,"生产组顺序编号更新",shiftName+" "+team,{changes});
        return active.length;
      };
      renumber();
      let row=d.productionGroups.find(g=>scope(g)&&g.status==="draft"&&(x.id?g.id===x.id:g.number===1));
      const parentReady=g=>{const driver=m.people.find(p=>p.id===g.personId);return isExcavator(m.vehicles.find(v=>v.id===g.vehicleId))&&driver&&L.active(driver)&&driver.applicationRole==="excavator"&&driver.team===team;};
      const blankTruck=()=>({id:uid(),status:"draft",vehicleId:"",personId:"",createdAt:now()});
      if(x.id&&!row)fail("生产设备组已变化，请刷新后重新选择");
      if(x.action==="open"||x.action==="add"){
        if(x.action==="add")row=null;
        if(row){if(parentReady(row)&&!row.followingTrucks.some(t=>t.status==="draft")){row.followingTrucks.push(blankTruck());row.updatedAt=now();audit(d,a,"恢复跟随汽车空卡",shiftName+" "+team,{productionGroupId:row.id});}return row.id;}
        const number=x.action==="add"?d.productionGroups.filter(g=>scope(g)&&g.status==="draft").length+1:1;
        row={id:uid(),workDate,shiftName,team,number,status:"draft",vehicleId:"",personId:"",followingTrucks:[],createdAt:now(),createdBy:a.id,updatedAt:now()};
        d.productionGroups.unshift(row);audit(d,a,"建立生产设备组草稿",workDate+" "+shiftName+" "+team+" 第"+number+"组",{productionGroupId:row.id});return row.id;
      }
      if(!row||row.id!==x.id)fail("当前设备组已变化，请重新选择");
      if(x.action==="remove"){row.removedNumber=row.number;row.status="removed";row.removedAt=now();row.removedBy=a.id;audit(d,a,"移除生产设备组草稿",shiftName+" "+team+" 第"+row.removedNumber+"组",{productionGroupId:row.id,removedNumber:row.removedNumber});renumber();return;}
      if(x.action==="regions"){
        if(!parentReady(row))fail("请先选择当前班组的有效挖机及挖机司机");
        if(Array.isArray(x.loadZoneId))fail("装载区只能选择一个");
        const loadZoneId=String(x.loadZoneId||"");
        if(x.unloadZoneIds!=null&&!Array.isArray(x.unloadZoneIds))fail("卸载区选择格式不正确");
        const unloadZoneIds=[...new Set((x.unloadZoneIds||[]).map(String).filter(Boolean))];
        const usable=(id,kind)=>d.zones.some(z=>z.id===id&&z.kind===kind&&z.enabled&&validZone(z));
        if(loadZoneId&&!usable(loadZoneId,"load"))fail("所选装载区已停用、失效或用途不符，请重新选择");
        if(unloadZoneIds.some(id=>!usable(id,"unload")))fail("所选卸载区已停用、失效或用途不符，请取消或重新选择");
        const before={loadZoneId:row.loadZoneId||"",unloadZoneIds:clone(row.unloadZoneIds||[])};
        row.loadZoneId=loadZoneId;row.unloadZoneIds=unloadZoneIds;row.updatedAt=now();row.updatedBy=a.id;
        row.regionSelectionHistory=[...(row.regionSelectionHistory||[]),{at:now(),by:a.id,before,after:{loadZoneId,unloadZoneIds:clone(unloadZoneIds)}}];
        audit(d,a,"设置生产组装卸区域",shiftName+" "+team,{productionGroupId:row.id,loadZoneId,unloadZoneIds});return row.id;
      }
      if(["truckEquipment","truckDriver","removeTruck","addTruck"].includes(x.action)){
        if(!parentReady(row))fail("请先选择当前班组的有效挖机及挖机司机");
        if(x.action==="addTruck"){const truck=blankTruck();row.followingTrucks.push(truck);row.updatedAt=now();audit(d,a,"新增跟随汽车空卡",shiftName+" "+team,{productionGroupId:row.id,truckId:truck.id});return truck.id;}
        const active=row.followingTrucks.filter(t=>t.status==="draft"),truck=x.truckId?active.find(t=>t.id===x.truckId):(active.length===1?active[0]:null);
        if(!truck)fail("目标跟随汽车已变化，请刷新后重新选择");
        if(x.action==="removeTruck"){truck.status="removed";truck.removedAt=now();truck.removedBy=a.id;row.followingTruckHistory=[...(row.followingTruckHistory||[]),clone(truck)];row.updatedAt=now();audit(d,a,"移除跟随汽车草稿",shiftName+" "+team,{productionGroupId:row.id,truckId:truck.id});return;}
        const field=x.action==="truckEquipment"?"vehicleId":"personId",value=String(x.value||"");
        if(value&&field==="vehicleId"&&!isHaulTruck(m.vehicles.find(v=>v.id===value)))fail("请选择矿用自卸车设备");
        if(value&&field==="personId"){const p=m.people.find(p=>p.id===value);if(!p||!L.active(p)||p.applicationRole!=="driver"||p.team!==team)fail("只能选择"+team+"已审核在岗的汽车司机");}
        requireFree(d,row,field,value,truck.id);
        const previous=truck[field]||"";truck[field]=value;truck.updatedAt=now();truck.updatedBy=a.id;row.updatedAt=now();
        audit(d,a,field==="vehicleId"?"选择跟随汽车":"选择跟随汽车司机",shiftName+" "+team+"；"+previous+" → "+value,{productionGroupId:row.id,truckId:truck.id,field,previous,value});return row.id;
      }
      const field=x.action==="equipment"?"vehicleId":"personId",value=String(x.value||"");
      if(value&&field==="vehicleId"&&!isExcavator(m.vehicles.find(v=>v.id===value)))fail("请选择挖机设备");
      if(value&&field==="personId"){const p=m.people.find(p=>p.id===value);if(!p||!L.active(p)||p.applicationRole!=="excavator"||p.team!==team)fail("只能选择"+team+"已审核在岗的挖机司机");}
      requireFree(d,row,field,value,row.id);
      const previous=row[field]||"";row[field]=value;row.updatedAt=now();row.updatedBy=a.id;if(parentReady(row)&&row.followingTrucks.length===0)row.followingTrucks.push(blankTruck());
      audit(d,a,field==="vehicleId"?"选择生产组挖机":"选择生产组挖机司机",shiftName+" "+team+"；"+previous+" → "+value,{productionGroupId:row.id,field,previous,value});return row.id;
    }
    if(type==="auxiliaryPlan"){
      dispatchOnly(a);const team=String(x.team||""),shiftName=String(x.shiftName||""),workDate=named(x.workDate,"日期",10)||date();
      if(!["生产A组","生产B组"].includes(team)||!["白班","夜班"].includes(shiftName)||!/^\d{4}-\d{2}-\d{2}$/.test(workDate))fail("请先选择有效班次和生产班组");
      if(!["ensure","add","equipment","driver","content","remove"].includes(x.action))fail("无效辅助车辆操作");
      let plan=d.auxiliaryPlans.find(p=>p.workDate===workDate&&p.shiftName===shiftName&&p.team===team);
      const blank=()=>({id:uid(),status:"draft",vehicleId:"",personId:"",content:"",createdAt:now()});
      if(!plan){plan={id:uid(),workDate,shiftName,team,cards:Array.from({length:4},blank),createdAt:now()};d.auxiliaryPlans.push(plan);audit(d,a,"建立辅助车辆配置",shiftName+" "+team,{auxiliaryPlanId:plan.id});}
      if(x.action==="ensure")return plan.id;
      if(x.action==="add"){const card=blank();plan.cards.push(card);audit(d,a,"新增辅助车辆空卡",shiftName+" "+team,{auxiliaryPlanId:plan.id,cardId:card.id});return card.id;}
      const card=plan.cards.find(c=>c.id===x.cardId&&c.status==="draft");if(!card)fail("辅助车辆卡已变化，请刷新");
      if(x.action==="remove"){card.status="removed";card.removedAt=now();card.removedBy=a.id;audit(d,a,"移除辅助车辆草稿",shiftName+" "+team,{auxiliaryPlanId:plan.id,cardId:card.id});return;}
      if(x.action==="content"){const before=card.content||"";card.content=named(x.content,"作业内容",1000);card.updatedAt=now();audit(d,a,"设置辅助车辆作业内容",card.content,{auxiliaryPlanId:plan.id,cardId:card.id,before});return;}
      const field=x.action==="equipment"?"vehicleId":"personId",value=String(x.value||"");
      if(value&&field==="vehicleId"&&!isAuxiliaryVehicle(m.vehicles.find(v=>v.id===value)))fail("请选择辅助车辆/设备");
      if(value&&field==="personId"){const p=m.people.find(p=>p.id===value);if(!p||!L.active(p)||p.team!==team||!auxiliaryRoles.includes(p.applicationRole))fail("只能选择"+team+"已审核在岗辅助岗位人员");}
      requireFree(d,plan,field,value,card.id);const before=card[field]||"";card[field]=value;card.updatedAt=now();card.updatedBy=a.id;
      audit(d,a,field==="vehicleId"?"选择辅助设备":"选择辅助人员",shiftName+" "+team+"；"+before+" → "+value,{auxiliaryPlanId:plan.id,cardId:card.id,field,before,value});return;
    }
    if(type==="assignment"){
      dispatchOnly(a);const previous=x.id?find("assignments",x.id):null;if(previous&&d.shifts.some(s=>s.assignmentId===previous.id))fail("已有实际班次的排班不能改写，请新建后续排班");const kind=x.kind==="excavator"?"excavator":"driver";const value={personId:String(x.personId||""),vehicleId:String(x.vehicleId||""),excavatorId:kind==="driver"?String(x.excavatorId||""):"",kind,workDate:named(x.workDate,"排班日期",10),shiftName:x.shiftName==="夜班"?"夜班":"白班",note:named(x.note,"说明"),status:"draft"};if(value.workDate&&!/^\d{4}-\d{2}-\d{2}$/.test(value.workDate))fail("排班日期格式不正确");const row=previous||{id:uid(),createdAt:now()};Object.assign(row,value);if(!previous)d.assignments.unshift(row);audit(d,a,"保存排班草稿",kind+"；"+value.workDate+value.shiftName,{assignmentId:row.id});return row.id;
    }
    if(type==="activateAssignment"){
      dispatchOnly(a);const r=find("assignments",x.id);if(r.status!=="draft")fail("该排班已启用或结束");const person=m.people.find(p=>p.id===r.personId),v=m.vehicles.find(v=>v.id===r.vehicleId);if(!person||!L.active(person)||person.applicationRole!==r.kind)fail("启用排班前请选择对应端口的在岗人员");if(!v||!r.workDate)fail("排班尚未设置有效设备和日期");if(isExcavator(v)!==(r.kind==="excavator"))fail("车辆类别与操作岗位不匹配");if(r.kind==="driver"&&!isExcavator(m.vehicles.find(v=>v.id===r.excavatorId)))fail("请先设置有效的绑定挖机");if(d.assignments.some(o=>o.id!==r.id&&o.status==="active"&&o.workDate===r.workDate&&o.shiftName===r.shiftName&&(o.personId===r.personId||o.vehicleId===r.vehicleId)))fail("该日期/班别的人员或设备已有启用排班");r.status="active";r.activatedAt=now();notify(d,r.personId,"调度已分配 "+v.code+" · "+r.workDate+r.shiftName,r.id);audit(d,a,"启用排班",person.name+" → "+v.code,{assignmentId:r.id});return;
    }
    if(type==="cancelAssignment"){dispatchOnly(a);const r=find("assignments",x.id);if(d.shifts.some(s=>s.assignmentId===r.id&&s.status!=="closed"))fail("该排班仍在实际使用，请先结束班次");r.status="cancelled";r.cancelNote=named(x.note,"说明");notify(d,r.personId,"排班已取消："+r.workDate+r.shiftName,r.id);audit(d,a,"取消排班",r.cancelNote,{assignmentId:r.id});return;}
    if(type==="zone"){
      dispatchOnly(a);const old=x.id?find("zones",x.id):null;const row=old||{id:uid(),createdAt:now(),version:0};
      const coords=x.coordinateSystem==="WGS84-UTM"?window.MineUTM.toWGS84({zone:x.utmZone,hemisphere:x.utmHemisphere,easting:x.easting,northing:x.northing}):{lat:optionalNumber(x.lat,"纬度",-90,90),lng:optionalNumber(x.lng,"经度",-180,180)};
      Object.assign(row,{name:named(x.name,"区域名称",60)||((x.kind==="unload"?"卸载区":"装载区")+" "+(old?d.zones.indexOf(old)+1:d.zones.length+1)),kind:x.kind==="unload"?"unload":"load",material:materialValue(x.material),lat:coords.lat,lng:coords.lng,utm:coords.utm||null,coordinateSystem:x.coordinateSystem==="WGS84-UTM"?"WGS84-UTM":"WGS84",radius:optionalNumber(x.radius,"区域半径",1,100000),enabled:false,version:row.version+1});const fix=x.centerFix;row.centerFix=null;
      if(fix&&Number.isFinite(fix.lat)&&Number.isFinite(fix.lng)&&Number.isFinite(row.lat)&&Number.isFinite(row.lng)&&distance(fix,row)<=0.02&&Number.isFinite(fix.accuracy)&&fix.accuracy>=0&&Number.isFinite(fix.ts))row.centerFix={...fix,lat:row.lat,lng:row.lng,accuracy:fix.accuracy,ts:fix.ts};
      if(Object.hasOwn(row,"excavatorId")){row.legacyExcavatorId=row.excavatorId;delete row.excavatorId;}if(!old)d.zones.push(row);d.revision++;audit(d,a,"保存区域草稿",row.name,{zoneId:row.id});return;
    }
    if(type==="toggleZone"){
      dispatchOnly(a);const z=find("zones",x.id);if(!z.enabled){if(!validZone(z))fail("启用前请设置完整有效的UTM位置与区域半径");}z.enabled=!z.enabled;z.version++;d.revision++;audit(d,a,z.enabled?"启用区域":"停用区域",z.name,{zoneId:z.id});return;
    }
    if(type==="shiftTimes"){
      dispatchOnly(a);const times=clone(d.shiftTimes);
      for(const [name,prefix] of [["白班","day"],["夜班","night"]])for(const edge of ["start","end"]){const value=named(x[prefix+"_"+edge],"班次时间",5);if(value){clockMinutes(value);times[name][edge]=value;}}
      for(const name of ["白班","夜班"])if(times[name].start===times[name].end)fail(name+"开始和结束时间不能相同");
      const intervals=t=>{const start=clockMinutes(t.start),end=clockMinutes(t.end);return start<end?[[start,end]]:[[start,1440],[0,end]];};
      if(intervals(times["白班"]).some(a=>intervals(times["夜班"]).some(b=>Math.max(a[0],b[0])<Math.min(a[1],b[1]))))fail("白班与夜班时间重叠，请同时调整两班起止时间");
      d.shiftTimes=times;d.revision++;audit(d,a,"设置白夜班时间",JSON.stringify(times));return;
    }
    if(type==="settings"){
      dispatchOnly(a);const limits={dwellSeconds:[1,600],maxAccuracy:[1,1000],gapSeconds:[10,3600],exitMargin:[0,1000],maxSpeedKmh:[5,300]};for(const key of Object.keys(limits)){const n=optionalNumber(x[key],key,...limits[key]);if(n!=null)d.settings[key]=n;}d.revision++;audit(d,a,"定位规则设置",JSON.stringify(d.settings));return;
    }
    if(type==="openShift"){
      operatorOnly(a);if(ownShift(d,a.id))fail("你仍有未结束的实际班次");const r=find("assignments",x.id);if(r.personId!==a.id||r.kind!==a.applicationRole||r.status!=="active")fail("这不是你的有效排班");if(r.releaseId){const release=d.taskReleases.find(t=>t.id===r.releaseId);if(!release||window.MineTaskEngine.phase(release)!=="running")fail("任务尚未开始、已经过班或已被替代，不能接班");}if(d.shifts.some(s=>s.vehicleId===r.vehicleId&&s.status!=="closed"))fail("此设备上一实际班次尚未结束，不能重复接班");const v=m.vehicles.find(v=>v.id===r.vehicleId);if(!v)fail("设备档案已不存在");if(isExcavator(v)!==(r.kind==="excavator"))fail("设备类别已变化，请调度重新安排");const previous=d.shifts.find(s=>s.vehicleId===r.vehicleId&&s.status==="closed"&&s.startedWorkAt);const s={id:uid(),assignmentId:r.id,personId:a.id,personName:a.name,kind:r.kind,vehicleId:v.id,vehicleCode:v.code,workDate:r.workDate,shiftName:r.shiftName,status:"checking",openedAt:now(),releaseId:r.releaseId||null,taskId:r.taskId||null,previousShiftId:previous?.id||null,previousDriverId:previous?.personId||null,previousDriverName:previous?.personName||"未记录",track:[],candidate:null,tempExcavatorId:null};d.shifts.unshift(s);audit(d,a,"接班",v.code+"；"+r.workDate+r.shiftName,{shiftId:s.id});return;
    }
    if(type==="inspection"){
      operatorOnly(a);const s=requireShift(d,a);if(!["checking","checked"].includes(s.status))fail("该班次已完成检查");const abnormal=x.outcome==="abnormal",attachments=Array.isArray(x.attachments)?x.attachments:[];if(attachments.length>10)fail("一次检查最多10张照片");for(const f of attachments)if(!f?.id||f.size>10*1024*1024||!String(f.type).startsWith("image/"))fail("请上传10MB以内的有效图片");const report={id:uid(),shiftId:s.id,personId:a.id,personName:a.name,vehicleId:s.vehicleId,vehicleCode:s.vehicleCode,outcome:abnormal?"abnormal":"normal",note:named(x.note,"检查说明"),attachments,at:now(),previousShiftId:s.previousShiftId,responsibleId:null,responsibleName:"未记录"};
      if(abnormal){let fault=x.faultId?d.faults.find(f=>f.id===x.faultId&&f.vehicleId===s.vehicleId&&f.status==="open"):null;if(x.faultId&&!fault)fail("所选既有异常状态已变化");if(!fault){fault={id:uid(),vehicleId:s.vehicleId,vehicleCode:s.vehicleCode,reportedAt:now(),reporterId:a.id,reporterName:a.name,responsibleId:s.previousDriverId,responsibleName:s.previousDriverName,previousShiftId:s.previousShiftId,status:"open",note:report.note,reports:[]};d.faults.unshift(fault);if(fault.responsibleId)notify(d,fault.responsibleId,"设备 "+s.vehicleCode+"新异常已直接关联你的上一实际班次",fault.id);}fault.reports.push(report.id);Object.assign(report,{faultId:fault.id,responsibleId:fault.responsibleId,responsibleName:fault.responsibleName});s.status="checked";setDevice(d,s.vehicleId,"paused","使用前检查异常",a);notify(d,"dispatch",s.personName+"上报设备异常，上一实际班次责任关联："+fault.responsibleName,fault.id);}
      else{const assignment=d.assignments.find(r=>r.id===s.assignmentId);if(assignment?.releaseId){const release=d.taskReleases.find(r=>r.id===assignment.releaseId);if(!release||window.MineTaskEngine.phase(release)!=="running")fail("任务当前不在执行时段，不能开始新的作业");}if(!working(d,m,s.vehicleId)||d.faults.some(f=>f.vehicleId===s.vehicleId&&f.status==="open"))fail("设备仍有暂停/维修或未处理异常，请先处理后恢复作业");s.status="working";s.startedWorkAt=s.startedWorkAt||now();}
      d.inspections.unshift(report);audit(d,a,abnormal?"检查异常直接关联责任":"检查无异常并开工",s.vehicleCode+"；"+(report.responsibleName||""),{shiftId:s.id,inspectionId:report.id});return;
    }
    if(type==="device"){
      const vehicleId=String(x.vehicleId||""),v=m.vehicles.find(v=>v.id===vehicleId);if(!v)fail("设备不存在");if(a.applicationRole!=="dispatch"){const s=requireShift(d,a);if(s.vehicleId!==vehicleId)fail("只能处理本人班次设备");if(s.status==="checking")fail("请先提交使用前检查");}
      const mode=["working","paused","repair","maintenance"].includes(x.mode)?x.mode:"paused";if(mode==="working"){
        if(["停用","维修中"].includes(v.status))fail("主设备档案仍为停用/维修中，请先处理设备档案状态");for(const f of d.faults.filter(f=>f.vehicleId===vehicleId&&f.status==="open")){f.status="resolved";f.resolvedAt=now();f.resolvedBy=a.id;f.resolution=named(x.note,"处理说明");}const s=ownShift(d,a.id);if(s?.vehicleId===vehicleId&&s.status==="checked"){s.status="working";s.startedWorkAt=s.startedWorkAt||now();}}
      setDevice(d,vehicleId,mode,named(x.note,"状态说明"),a);notify(d,"dispatch",v.code+"状态更新为 "+mode,vehicleId);return;
    }
    if(type==="temporaryExcavator"){
      if(a.applicationRole!=="driver")fail("仅司机可选择临时挖机");const s=requireWorking(d,a);if(shiftTrip(d,s))fail("已经形成装载车次，本趟挖机归属不能改写");const exc=m.vehicles.find(v=>v.id===x.excavatorId);if(!isExcavator(exc)||!working(d,m,exc.id))fail("请选择可作业的挖机");const assignment=d.assignments.find(r=>r.id===s.assignmentId),taskZones=window.MineTaskEngine?.zonesFor(d,assignment,exc.id);if(taskZones?!taskZones.load:!d.zones.some(z=>z.enabled&&z.kind==="load"&&validZone(z)))fail("该任务尚未配置临时挖机的有效装载区域");s.tempExcavatorId=exc.id;resetCandidate(s);audit(d,a,"临时非绑定挖机",exc.code+"；仅下一趟有效",{shiftId:s.id});notify(d,"exc:"+exc.id,s.personName+"选择本设备临时装载",s.id);return;
    }
    if(type==="location")return location(d,m,a,x);
    if(type==="interrupt"){if(a.applicationRole!=="driver")fail("无效操作");const s=requireShift(d,a);reviewTrip(d,s,shiftTrip(d,s),named(x.note,"定位中断说明")||"页面隐藏或定位已停止",a);return;}
    if(type==="resumeTrip"){
      if(a.applicationRole!=="driver")fail("仅司机可确认继续运输");const s=requireWorking(d,a),t=shiftTrip(d,s);if(!t||t.status!=="review")fail("没有待核对车次");t.status=["loaded","hauling"].includes(t.resumeStatus)?t.resumeStatus:"loaded";t.events.push({at:now(),type:"司机确认仍在运输本趟"});t.reviewReason="";t.unloadCandidate=null;s.lastPoint=null;s.locationWarning="";resetCandidate(s);audit(d,a,"恢复当前运输车次","本人确认仍载有本趟物料",{tripId:t.id});return;
    }
    if(type==="outsideUnload"){
      if(a.applicationRole!=="driver")fail("仅司机可提交区外卸料");const s=requireWorking(d,a),t=find("trips",x.tripId);if(t.shiftId!==s.id||!liveTrip(t))fail("本趟已结束或不是你的装载车次，不能重复计车");t.outsideNote=named(x.note,"区外卸料说明");completeTrip(d,s,t,"outside",s.lastPoint||null,null,materialValue(x.material),a);return;
    }
    if(type==="closeShift"){
      operatorOnly(a);const s=requireShift(d,a);if(shiftTrip(d,s))fail("仍有未完成车次，请先完成卸料或记录作废后再结束班次");s.status="closed";s.closedAt=now();s.closeNote=named(x.note,"收班说明");const r=d.assignments.find(r=>r.id===s.assignmentId);if(r)r.status="completed";audit(d,a,"结束班次",s.vehicleCode,{shiftId:s.id});return;
    }
    if(type==="forceCloseShift"){
      dispatchOnly(a);const s=find("shifts",x.id);if(s.status==="closed")fail("该班次已结束");if(shiftTrip(d,s))fail("仍有在途车次，请先处理或作废车次");
      s.status="closed";s.closedAt=now();s.closeNote=named(x.note,"结束占用说明");s.closedByDispatch=a.id;
      const r=d.assignments.find(r=>r.id===s.assignmentId);if(r)r.status="completed";notify(d,s.personId,"调度已结束设备班次占用："+s.vehicleCode,s.id);audit(d,a,"调度结束班次占用",s.vehicleCode+"；"+s.closeNote,{shiftId:s.id});return;
    }
    if(type==="voidTrip"){
      const t=find("trips",x.id);if(a.applicationRole!=="dispatch"){if(a.applicationRole!=="driver"||t.personId!==a.id||!liveTrip(t))fail("仅调度可冲销已完成车次");}
      if(t.status==="voided")fail("该车次已经作废");t.previousStatus=t.status;t.status="voided";t.voidedBy=a.id;t.voidedAt=now();t.voidNote=named(x.note,"作废说明");const s=d.shifts.find(s=>s.id===t.shiftId);if(s&&!shiftTrip(d,s)){resetCandidate(s);s.tempExcavatorId=null;}notify(d,t.personId,"车次已作废/冲销，汽车和实际挖机统计同步更新",t.id);notify(d,"exc:"+t.excavatorId,"车次已作废/冲销："+t.vehicleCode,t.id);audit(d,a,"车次作废/冲销",t.voidNote,{tripId:t.id});return;
    }
    if(type==="correctMaterial"){dispatchOnly(a);const t=find("trips",x.id);t.corrections=[...(t.corrections||[]),{at:now(),by:a.id,from:t.material||"未分类",to:materialValue(x.material)||"未分类",note:named(x.note,"调整说明")}];t.material=materialValue(x.material)||"未分类";t.materialSource="调度修正";audit(d,a,"修正物料分类",t.material,{tripId:t.id});return;}
    if(type==="readMessages"){for(const msg of visibleMessages(d,a))if(!msg.readBy.includes(a.id))msg.readBy.push(a.id);return;}
    fail("未知运输操作");
  }
  function visibleMessages(d,a){const equipment=new Set(d.assignments.filter(r=>r.personId===a.id&&r.kind==="excavator").map(r=>"exc:"+r.vehicleId));return d.messages.filter(msg=>msg.target===a.id||(a.applicationRole==="dispatch"&&msg.target==="dispatch")||(a.applicationRole==="excavator"&&equipment.has(msg.target)));}
  async function act(type,args,actor){if(!navigator.locks?.request)fail("请使用支持事务锁的新版浏览器");return navigator.locks.request(KEY,async()=>{const d=get(),m=L.main(),a=actorFrom(m,actor),result=execute(d,m,a,type,args||{});try{localStorage.setItem(KEY,JSON.stringify(d));}catch(error){fail("保存失败，未新增车次或计数："+error.message);}window.dispatchEvent(new CustomEvent("mine-transport-change"));return result;});}
  window.MineTransport={KEY,get,context,act,defaults,materialTypes,shiftTimeDefaults,currentShift,date,distance,inside,validZone,ownShift,shiftTrip,liveTrip,equipmentState,working,isExcavator,isHaulTruck,isAuxiliaryVehicle,auxiliaryRoles,draftSlots,visibleMessages};
})();

