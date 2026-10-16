/* Transport events are browser-local. One completed trip is the source of both truck and excavator counts. */
(() => {
  "use strict";
  const KEY="mine-management-lite-transport-v1", L=window.MineLogistics;
  const roles=["driver","excavator","dispatch"], uid=()=>crypto.randomUUID(), now=()=>new Date().toISOString();
  const fail=message=>{throw new Error(message);}, clone=v=>JSON.parse(JSON.stringify(v));
  const materialTypes=Object.freeze(["渣","煤","只记车数"]);
  const defaults={dwellSeconds:20,maxAccuracy:50,gapSeconds:90,exitMargin:15,maxSpeedKmh:150};
  function get(){let d;try{d=JSON.parse(localStorage.getItem(KEY)||"null");}catch{fail("运输台账无法读取，请保留浏览器数据并联系管理员");}if(!d)d={version:1,revision:0,settings:{...defaults},assignments:[],zones:[],shifts:[],inspections:[],faults:[],trips:[],devices:[],messages:[],audit:[]};for(const key of ["assignments","zones","shifts","inspections","faults","trips","devices","messages","audit"])if(!Array.isArray(d[key]))fail("运输台账格式异常");d.settings={...defaults,...d.settings};return d;}
  function context(role){if(!roles.includes(role))fail("无效工作端口");const p=L.context(role);if(!L.active(p))fail("当前人员状态不能进入运输工作台，请返回登记状态页");return p;}
  const date=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Ulaanbaatar"});
  const isExcavator=v=>/挖/.test(String(v?.category||v?.model||""));
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
  function requireWorking(d,a){const s=requireShift(d,a);if(s.status!=="working")fail("请先完成使用前检查并开始作业");return s;}
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
  function startLoad(d,m,s,z,p,a){const assignment=d.assignments.find(v=>v.id===s.assignmentId),exc=m.vehicles.find(v=>v.id===(s.tempExcavatorId||assignment?.excavatorId));if(!assignment||!exc||!working(d,m,exc.id))fail("装载挖机当前不可作业，请选择可用的临时挖机");const t={id:uid(),shiftId:s.id,assignmentId:s.assignmentId,personId:s.personId,personName:s.personName,vehicleId:s.vehicleId,vehicleCode:s.vehicleCode,workDate:s.workDate,shiftName:s.shiftName,excavatorId:exc.id,excavatorCode:exc.code,originalExcavatorId:assignment.excavatorId,isTemporary:exc.id!==assignment.excavatorId,mode:p.mode,status:"loaded",loadedAt:now(),loadPoint:clone(p),loadZone:clone(z),unloadZones:clone(d.zones.filter(z=>z.enabled&&z.kind==="unload"&&validZone(z)).map(z=>!z.material||materialTypes.includes(z.material)?z:{...z,legacyMaterial:z.material,material:""})),settings:clone(d.settings),zoneRevision:d.revision,events:[{at:now(),type:"装载区有效停留",point:clone(p)}]};d.trips.unshift(t);s.tempExcavatorId=null;resetCandidate(s);notify(d,"exc:"+exc.id,s.vehicleCode+"已在装载区形成在途车次",t.id);audit(d,a,"装载车次开始",s.vehicleCode+" 在 "+exc.code+" 装载",{tripId:t.id,mode:p.mode});return t;}
  function location(d,m,a,x){if(a.applicationRole!=="driver")fail("仅司机端处理运输定位");const s=requireWorking(d,a);if(!working(d,m,s.vehicleId))fail("当前车辆已暂停、维修或停用");let t=shiftTrip(d,s);const settings=t?.settings||d.settings,mode=x.mode;if(!["gps","simulation"].includes(mode))fail("请选择定位来源");if(t&&t.mode!==mode)fail("在途车次不能切换定位来源，请先处理本趟");
    const p={lat:optionalNumber(x.lat,"纬度",-90,90),lng:optionalNumber(x.lng,"经度",-180,180),accuracy:optionalNumber(x.accuracy,"定位精度",0,100000),ts:Number(x.ts),mode};if(p.lat==null||p.lng==null||p.accuracy==null||!Number.isFinite(p.ts))fail("尚未获得有效位置，请开启定位或输入模拟坐标");if(Math.abs(Date.now()-p.ts)>60000){s.locationWarning="位置时间已过期，等待新的定位";resetCandidate(s);return;}
    if(s.lastPoint?.mode!==mode){s.lastPoint=null;resetCandidate(s);}if(s.lastPoint&&p.ts<=s.lastPoint.ts)return;
    if(p.accuracy>settings.maxAccuracy){s.locationWarning="定位精度不足，当前误差约 "+Math.round(p.accuracy)+" 米";resetCandidate(s);if(t)t.unloadCandidate=null;return;}
    if(s.lastPoint&&p.ts-s.lastPoint.ts>settings.gapSeconds*1000){reviewTrip(d,s,t,"定位间隔超过 "+settings.gapSeconds+" 秒",a);s.lastPoint=p;s.track=[...(s.track||[]),p].slice(-80);if(t)return;}
    if(s.lastPoint&&mode==="gps"&&p.ts>s.lastPoint.ts&&distance(s.lastPoint,p)/(p.ts-s.lastPoint.ts)*3600>settings.maxSpeedKmh){reviewTrip(d,s,t,"定位发生明显跳点，未自动计车",a);s.lastRejectedPoint=p;s.lastPoint=p;return;}
    s.lastPoint=p;s.track=[...(s.track||[]),p].slice(-80);s.locationWarning="";if(t?.status==="review"){s.locationWarning=t.reviewReason;return;}
    if(!t){const assignment=d.assignments.find(v=>v.id===s.assignmentId),excId=s.tempExcavatorId||assignment?.excavatorId;if(!excId){s.locationWarning="尚未绑定装载挖机";return;}if(!working(d,m,excId)){s.locationWarning="绑定挖机暂停/维修，请选择临时非绑定挖机";resetCandidate(s);return;}
      const loading=d.zones.filter(z=>z.enabled&&z.kind==="load"&&inside(p,z)),unloading=d.zones.filter(z=>z.enabled&&z.kind==="unload"&&inside(p,z));if(loading.length!==1||unloading.length){resetCandidate(s);if(loading.length>1||(loading.length&&unloading.length))s.locationWarning="作业区域重叠，暂不自动识别装载";return;}
      const z=loading[0];if(s.candidate?.zoneId!==z.id)s.candidate={zoneId:z.id,since:p.ts,kind:"load"};if(p.ts-s.candidate.since>=settings.dwellSeconds*1000)startLoad(d,m,s,z,p,a);return;
    }
    if(t.status==="loaded"&&outside(p,t.loadZone,settings.exitMargin)){t.status="hauling";t.departedAt=now();t.events.push({at:now(),type:"离开装载区",point:clone(p)});}
    if(t.status!=="hauling")return;const unloading=t.unloadZones.filter(z=>inside(p,z));if(unloading.length!==1){t.unloadCandidate=null;if(unloading.length>1)s.locationWarning="卸载区重叠，暂不自动计车";return;}const z=unloading[0];if(t.unloadCandidate?.zoneId!==z.id)t.unloadCandidate={zoneId:z.id,since:p.ts};if(p.ts-t.unloadCandidate.since>=settings.dwellSeconds*1000)completeTrip(d,s,t,"gps",p,z,z.material,a);
  }
  function execute(d,m,a,type,x){const find=(array,id)=>d[array].find(v=>v.id===id)||fail("记录不存在，请刷新");
    if(type==="assignment"){
      dispatchOnly(a);const previous=x.id?find("assignments",x.id):null;if(previous&&d.shifts.some(s=>s.assignmentId===previous.id))fail("已有实际班次的排班不能改写，请新建后续排班");const kind=x.kind==="excavator"?"excavator":"driver";const value={personId:String(x.personId||""),vehicleId:String(x.vehicleId||""),excavatorId:kind==="driver"?String(x.excavatorId||""):"",kind,workDate:named(x.workDate,"排班日期",10),shiftName:x.shiftName==="夜班"?"夜班":"白班",note:named(x.note,"说明"),status:"draft"};if(value.workDate&&!/^\d{4}-\d{2}-\d{2}$/.test(value.workDate))fail("排班日期格式不正确");const row=previous||{id:uid(),createdAt:now()};Object.assign(row,value);if(!previous)d.assignments.unshift(row);audit(d,a,"保存排班草稿",kind+"；"+value.workDate+value.shiftName,{assignmentId:row.id});return row.id;
    }
    if(type==="activateAssignment"){
      dispatchOnly(a);const r=find("assignments",x.id);if(r.status!=="draft")fail("该排班已启用或结束");const person=m.people.find(p=>p.id===r.personId),v=m.vehicles.find(v=>v.id===r.vehicleId);if(!person||!L.active(person)||person.applicationRole!==r.kind)fail("启用排班前请选择对应端口的在岗人员");if(!v||!r.workDate)fail("排班尚未设置有效设备和日期");if(isExcavator(v)!==(r.kind==="excavator"))fail("车辆类别与操作岗位不匹配");if(r.kind==="driver"&&!isExcavator(m.vehicles.find(v=>v.id===r.excavatorId)))fail("请先设置有效的绑定挖机");if(d.assignments.some(o=>o.id!==r.id&&o.status==="active"&&o.workDate===r.workDate&&o.shiftName===r.shiftName&&(o.personId===r.personId||o.vehicleId===r.vehicleId)))fail("该日期/班别的人员或设备已有启用排班");r.status="active";r.activatedAt=now();notify(d,r.personId,"调度已分配 "+v.code+" · "+r.workDate+r.shiftName,r.id);audit(d,a,"启用排班",person.name+" → "+v.code,{assignmentId:r.id});return;
    }
    if(type==="cancelAssignment"){dispatchOnly(a);const r=find("assignments",x.id);if(d.shifts.some(s=>s.assignmentId===r.id&&s.status!=="closed"))fail("该排班仍在实际使用，请先结束班次");r.status="cancelled";r.cancelNote=named(x.note,"说明");notify(d,r.personId,"排班已取消："+r.workDate+r.shiftName,r.id);audit(d,a,"取消排班",r.cancelNote,{assignmentId:r.id});return;}
    if(type==="zone"){
      dispatchOnly(a);const old=x.id?find("zones",x.id):null;const row=old||{id:uid(),createdAt:now(),version:0};Object.assign(row,{name:named(x.name,"区域名称",60)||((x.kind==="unload"?"卸载区":"装载区")+" "+(old?d.zones.indexOf(old)+1:d.zones.length+1)),kind:x.kind==="unload"?"unload":"load",material:materialValue(x.material),lat:optionalNumber(x.lat,"纬度",-90,90),lng:optionalNumber(x.lng,"经度",-180,180),radius:optionalNumber(x.radius,"区域半径",1,100000),enabled:false,version:row.version+1});const fix=x.centerFix;row.centerFix=null;
      if(fix&&Number.isFinite(fix.lat)&&Number.isFinite(fix.lng)&&fix.lat===row.lat&&fix.lng===row.lng&&Number.isFinite(fix.accuracy)&&fix.accuracy>=0&&Number.isFinite(fix.ts))row.centerFix={lat:fix.lat,lng:fix.lng,accuracy:fix.accuracy,ts:fix.ts};
      if(Object.hasOwn(row,"excavatorId")){row.legacyExcavatorId=row.excavatorId;delete row.excavatorId;}if(!old)d.zones.push(row);d.revision++;audit(d,a,"保存区域草稿",row.name,{zoneId:row.id});return;
    }
    if(type==="toggleZone"){
      dispatchOnly(a);const z=find("zones",x.id);if(!z.enabled){if(!validZone(z))fail("启用前请设置区域经纬度与有效半径");}z.enabled=!z.enabled;z.version++;d.revision++;audit(d,a,z.enabled?"启用区域":"停用区域",z.name,{zoneId:z.id});return;
    }
    if(type==="settings"){
      dispatchOnly(a);const limits={dwellSeconds:[1,600],maxAccuracy:[1,1000],gapSeconds:[10,3600],exitMargin:[0,1000],maxSpeedKmh:[5,300]};for(const key of Object.keys(limits)){const n=optionalNumber(x[key],key,...limits[key]);if(n!=null)d.settings[key]=n;}d.revision++;audit(d,a,"定位规则设置",JSON.stringify(d.settings));return;
    }
    if(type==="openShift"){
      operatorOnly(a);if(ownShift(d,a.id))fail("你仍有未结束的实际班次");const r=find("assignments",x.id);if(r.personId!==a.id||r.kind!==a.applicationRole||r.status!=="active")fail("这不是你的有效排班");if(d.shifts.some(s=>s.vehicleId===r.vehicleId&&s.status!=="closed"))fail("此设备上一实际班次尚未结束，不能重复接班");const v=m.vehicles.find(v=>v.id===r.vehicleId);if(!v)fail("设备档案已不存在");if(isExcavator(v)!==(r.kind==="excavator"))fail("设备类别已变化，请调度重新安排");const previous=d.shifts.find(s=>s.vehicleId===r.vehicleId&&s.status==="closed"&&s.startedWorkAt);const s={id:uid(),assignmentId:r.id,personId:a.id,personName:a.name,kind:r.kind,vehicleId:v.id,vehicleCode:v.code,workDate:r.workDate,shiftName:r.shiftName,status:"checking",openedAt:now(),previousShiftId:previous?.id||null,previousDriverId:previous?.personId||null,previousDriverName:previous?.personName||"未记录",track:[],candidate:null,tempExcavatorId:null};d.shifts.unshift(s);audit(d,a,"接班",v.code+"；"+r.workDate+r.shiftName,{shiftId:s.id});return;
    }
    if(type==="inspection"){
      operatorOnly(a);const s=requireShift(d,a);if(!["checking","checked"].includes(s.status))fail("该班次已完成检查");const abnormal=x.outcome==="abnormal",attachments=Array.isArray(x.attachments)?x.attachments:[];if(attachments.length>10)fail("一次检查最多10张照片");for(const f of attachments)if(!f?.id||f.size>10*1024*1024||!String(f.type).startsWith("image/"))fail("请上传10MB以内的有效图片");const report={id:uid(),shiftId:s.id,personId:a.id,personName:a.name,vehicleId:s.vehicleId,vehicleCode:s.vehicleCode,outcome:abnormal?"abnormal":"normal",note:named(x.note,"检查说明"),attachments,at:now(),previousShiftId:s.previousShiftId,responsibleId:null,responsibleName:"未记录"};
      if(abnormal){let fault=x.faultId?d.faults.find(f=>f.id===x.faultId&&f.vehicleId===s.vehicleId&&f.status==="open"):null;if(x.faultId&&!fault)fail("所选既有异常状态已变化");if(!fault){fault={id:uid(),vehicleId:s.vehicleId,vehicleCode:s.vehicleCode,reportedAt:now(),reporterId:a.id,reporterName:a.name,responsibleId:s.previousDriverId,responsibleName:s.previousDriverName,previousShiftId:s.previousShiftId,status:"open",note:report.note,reports:[]};d.faults.unshift(fault);if(fault.responsibleId)notify(d,fault.responsibleId,"设备 "+s.vehicleCode+"新异常已直接关联你的上一实际班次",fault.id);}fault.reports.push(report.id);Object.assign(report,{faultId:fault.id,responsibleId:fault.responsibleId,responsibleName:fault.responsibleName});s.status="checked";setDevice(d,s.vehicleId,"paused","使用前检查异常",a);notify(d,"dispatch",s.personName+"上报设备异常，上一实际班次责任关联："+fault.responsibleName,fault.id);}
      else{if(!working(d,m,s.vehicleId)||d.faults.some(f=>f.vehicleId===s.vehicleId&&f.status==="open"))fail("设备仍有暂停/维修或未处理异常，请先处理后恢复作业");s.status="working";s.startedWorkAt=s.startedWorkAt||now();}
      d.inspections.unshift(report);audit(d,a,abnormal?"检查异常直接关联责任":"检查无异常并开工",s.vehicleCode+"；"+(report.responsibleName||""),{shiftId:s.id,inspectionId:report.id});return;
    }
    if(type==="device"){
      const vehicleId=String(x.vehicleId||""),v=m.vehicles.find(v=>v.id===vehicleId);if(!v)fail("设备不存在");if(a.applicationRole!=="dispatch"){const s=requireShift(d,a);if(s.vehicleId!==vehicleId)fail("只能处理本人班次设备");if(s.status==="checking")fail("请先提交使用前检查");}
      const mode=["working","paused","repair","maintenance"].includes(x.mode)?x.mode:"paused";if(mode==="working"){
        if(["停用","维修中"].includes(v.status))fail("主设备档案仍为停用/维修中，请先处理设备档案状态");for(const f of d.faults.filter(f=>f.vehicleId===vehicleId&&f.status==="open")){f.status="resolved";f.resolvedAt=now();f.resolvedBy=a.id;f.resolution=named(x.note,"处理说明");}const s=ownShift(d,a.id);if(s?.vehicleId===vehicleId&&s.status==="checked"){s.status="working";s.startedWorkAt=s.startedWorkAt||now();}}
      setDevice(d,vehicleId,mode,named(x.note,"状态说明"),a);notify(d,"dispatch",v.code+"状态更新为 "+mode,vehicleId);return;
    }
    if(type==="temporaryExcavator"){
      if(a.applicationRole!=="driver")fail("仅司机可选择临时挖机");const s=requireWorking(d,a);if(shiftTrip(d,s))fail("已经形成装载车次，本趟挖机归属不能改写");const exc=m.vehicles.find(v=>v.id===x.excavatorId);if(!isExcavator(exc)||!working(d,m,exc.id))fail("请选择可作业的挖机");if(!d.zones.some(z=>z.enabled&&z.kind==="load"&&validZone(z)))fail("尚未启用有效的通用装载区域");s.tempExcavatorId=exc.id;resetCandidate(s);audit(d,a,"临时非绑定挖机",exc.code+"；仅下一趟有效",{shiftId:s.id});notify(d,"exc:"+exc.id,s.personName+"选择本设备临时装载",s.id);return;
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
  window.MineTransport={KEY,get,context,act,defaults,materialTypes,date,distance,inside,validZone,ownShift,shiftTrip,liveTrip,equipmentState,working,isExcavator,visibleMessages};
})();

