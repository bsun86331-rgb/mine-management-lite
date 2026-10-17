/* Published task snapshots and time-derived execution state. Browser-local. */
(() => {
  "use strict";
  const TZ="Asia/Ulaanbaatar", fail=m=>{throw new Error(m);}, clone=v=>JSON.parse(JSON.stringify(v)), uid=()=>crypto.randomUUID();
  const dateOnly=value=>{const s=String(value||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+"T00:00:00Z").toISOString().slice(0,10)!==s)fail("请选择有效任务日期");return s;};
  const addDays=(day,count)=>new Date(Date.parse(day+"T00:00:00Z")+count*86400000).toISOString().slice(0,10);
  function parts(at){return Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(at)).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));}
  function localInstant(day,time){
    dateOnly(day);if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time)))fail("班次起止时间无效");
    const target=Date.parse(day+"T"+time+":00Z");let value=target;
    for(let i=0;i<3;i++){const p=parts(value),rendered=Date.parse(p.year+"-"+p.month+"-"+p.day+"T"+p.hour+":"+p.minute+":"+p.second+"Z");const difference=target-rendered;if(!difference)break;value+=difference;}
    return new Date(value).toISOString();
  }
  function timeWindow(day,times){
    dateOnly(day);if(!times||times.start===times.end)fail("班次起止时间不能相同");
    const startAt=localInstant(day,times.start),endAt=localInstant(times.end<times.start?addDays(day,1):day,times.end);
    if(Date.parse(endAt)<=Date.parse(startAt))fail("班次时间配置无效");return {startAt,endAt,timeZone:TZ};
  }
  function phase(release,at=Date.now()){
    if(release.status!=="published")return release.status||"unknown";
    const stamp=Number(at instanceof Date?at.getTime():at);
    return stamp<Date.parse(release.startAt)?"scheduled":stamp<Date.parse(release.endAt)?"running":"ended";
  }
  function clockKey(d,at=Date.now()){return (d.taskReleases||[]).map(r=>r.id+":"+phase(r,at)).join("|");}
  function suggestDate(sourceDate,times,at=Date.now()){
    const p=parts(at),today=p.year+"-"+p.month+"-"+p.day,time=p.hour+":"+p.minute;
    return sourceDate===today&&times.end<times.start&&time<times.end?addDays(today,-1):sourceDate;
  }
  function prepare(d,m,x){
    const T=window.MineTransport,L=window.MineLogistics,sourceDate=dateOnly(x.sourceDate||x.workDate),workDate=dateOnly(x.taskDate||sourceDate),team=String(x.team||""),shiftName=String(x.shiftName||"");
    if(!["生产A组","生产B组"].includes(team)||!["白班","夜班"].includes(shiftName))fail("请先选择班次和生产班组");
    const times=clone(d.shiftTimes[shiftName]),windowTime=timeWindow(workDate,times),warnings=[],tasks=[],groups=[],seenPeople=new Set(),seenVehicles=new Set();
    const member=(id,role)=>{const p=m.people.find(p=>p.id===id);if(!p||!L.active(p)||p.team!==team||(Array.isArray(role)?!role.includes(p.applicationRole):p.applicationRole!==role))fail("人员已失效、岗位或班组不符，请重新选择");return p;};
    const device=(id,predicate)=>{const v=m.vehicles.find(v=>v.id===id);if(!v||!predicate(v))fail("设备档案已变化或类别不符，请重新选择");if(!T.working(d,m,id))fail((v.code||id)+" 当前维修、保养、暂停或停用，不能发布");return v;};
    function push(task,p,v){
      if(seenPeople.has(p.id))fail(p.name+" 在发布内容中重复分配");seenPeople.add(p.id);
      if(v){if(seenVehicles.has(v.id))fail((v.code||v.id)+" 在发布内容中重复分配");seenVehicles.add(v.id);}
      tasks.push({...task,personId:p.id,personName:p.name,role:p.applicationRole,personTeam:p.team,vehicleId:v?.id||"",vehicleCode:v?.code||"",vehicleName:v?.name||"",vehicleCategory:v?.category||v?.model||""});
    }
    const selected=d.productionGroups.filter(g=>g.status==="draft"&&g.workDate===sourceDate&&g.shiftName===shiftName&&g.team===team).sort((a,b)=>a.number-b.number);
    for(const [groupIndex,originalGroup] of selected.entries()){
      const g={...originalGroup,number:groupIndex+1};
      const trucks=g.followingTrucks.filter(t=>t.status==="draft"),configured=!!(g.vehicleId||g.personId||g.loadZoneId||(g.unloadZoneIds||[]).length||trucks.some(t=>t.vehicleId||t.personId));
      if(!configured)continue;
      if(!g.vehicleId||!g.personId)fail("第"+g.number+"组已配置但挖机/司机未配对，请补齐或清空该组后发布");
      const exc=device(g.vehicleId,T.isExcavator),operator=member(g.personId,"excavator");
      const zone=(id,kind)=>{const z=d.zones.find(z=>z.id===id&&z.kind===kind&&z.enabled&&T.validZone(z));if(!z)fail("第"+g.number+"组区域已停用或失效，请重新选择");const copy=clone(z);if(!T.materialTypes.includes(copy.material)){copy.legacyMaterial=copy.material||"";copy.material="";}return copy;};
      const regions={load:g.loadZoneId?zone(g.loadZoneId,"load"):null,unloads:[...new Set(g.unloadZoneIds||[])].map(id=>zone(id,"unload"))};
      const group={sourceGroupId:g.id,number:g.number,excavatorId:exc.id,excavatorCode:exc.code,excavatorDriverId:operator.id,excavatorDriverName:operator.name,regions,trucks:[]};
      const pending=[];
      for(const truck of trucks){
        if(!truck.vehicleId&&!truck.personId)continue;
        if(!truck.vehicleId||!truck.personId)fail("第"+g.number+"组汽车设备/司机未配对，请补齐或清空这张卡");
        const v=device(truck.vehicleId,T.isHaulTruck),p=member(truck.personId,"driver");
        group.trucks.push({sourceSlotId:truck.id,vehicleId:v.id,vehicleCode:v.code,personId:p.id,personName:p.name});
        pending.push({truck,v,p});
      }
      if(pending.length&&!regions.load)warnings.push("第"+g.number+"组未选装载区，GPS自动装载暂不可用");
      if(pending.length&&!regions.unloads.length)warnings.push("第"+g.number+"组未选卸载区，可使用非卸载区卸料");
      groups.push(group);
      push({sourceSlotId:g.id,kind:"excavator",groupNumber:g.number,group:clone(group),regions:clone(regions),content:""},operator,exc);
      for(const {truck,v,p} of pending)push({sourceSlotId:truck.id,kind:"driver",groupNumber:g.number,group:clone(group),regions:clone(regions),content:""},p,v);
    }
    const plan=d.auxiliaryPlans.find(p=>p.workDate===sourceDate&&p.shiftName===shiftName&&p.team===team);
    for(const card of plan?.cards.filter(c=>c.status==="draft")||[]){
      if(!card.vehicleId&&!card.personId&&!String(card.content||"").trim())continue;
      if(!card.personId)fail("辅助车辆/作业已配置但尚未选择人员，请补齐或清空该卡");
      const p=member(card.personId,T.auxiliaryRoles),v=card.vehicleId?device(card.vehicleId,T.isAuxiliaryVehicle):null;
      push({sourceSlotId:card.id,kind:"auxiliary",groupNumber:null,group:null,regions:null,content:String(card.content||"")},p,v);
    }
    if(!tasks.length)fail("当前没有可发布的人员任务，请先配置生产组或辅助岗位");
    const signature=JSON.stringify({sourceDate,workDate,team,shiftName,times,groups,tasks});
    return {sourceDate,workDate,team,shiftName,times,...windowTime,tasks,groups,warnings,signature};
  }
  function publish(d,m,a,x){
    if(a.applicationRole!=="dispatch")fail("仅调度可发布");
    const prepared=prepare(d,m,x);
    if(x.expectedSignature&&x.expectedSignature!==prepared.signature)fail("配置已变化，请重新打开发布窗口核对");
    if(Date.now()>=Date.parse(prepared.endAt))fail("该任务日期的班次已经结束，请重新选择任务日期");
    const old=d.taskReleases.find(r=>r.status==="published"&&r.workDate===prepared.workDate&&r.shiftName===prepared.shiftName&&r.team===prepared.team);
    if(old?.signature===prepared.signature)return old.id;
    const overlap=r=>Date.parse(r.startAt)<Date.parse(prepared.endAt)&&Date.parse(r.endAt)>Date.parse(prepared.startAt);
    const people=new Set(prepared.tasks.map(t=>t.personId)),vehicles=new Set(prepared.tasks.map(t=>t.vehicleId).filter(Boolean));
    for(const r of d.taskReleases.filter(r=>r.status==="published"&&r.id!==old?.id&&overlap(r)))for(const task of r.tasks)if(people.has(task.personId)||(task.vehicleId&&vehicles.has(task.vehicleId)))fail("与已发布任务存在人员或设备时间冲突："+task.personName+" / "+task.vehicleCode);
    const sameTarget=(task,next)=>next&&task.personId===next.personId&&task.vehicleId===next.vehicleId&&task.role===next.role;
    if(old)for(const task of old.tasks){
      const next=prepared.tasks.find(t=>t.sourceSlotId===task.sourceSlotId),open=d.shifts.find(s=>s.assignmentId===task.assignmentId&&s.status!=="closed");
      if(open&&(prepared.startAt!==old.startAt||prepared.endAt!==old.endAt))fail("已有未收班任务，重新发布不能移动班次时间");
      if(open&&!sameTarget(task,next))fail(task.personName+" 尚未收班，不能在重发时移除或更换其设备");
    }
    for(const task of prepared.tasks){
      const previous=old?.tasks.find(t=>t.sourceSlotId===task.sourceSlotId&&sameTarget(t,task));
      for(const session of d.shifts.filter(s=>s.status!=="closed"&&(s.personId===task.personId||(task.vehicleId&&s.vehicleId===task.vehicleId)))){
        if(session.assignmentId===previous?.assignmentId)continue;
        const currentAssignment=d.assignments.find(r=>r.id===session.assignmentId);
        let busyEnd=currentAssignment?.endAt;
        if(!busyEnd)try{busyEnd=timeWindow(session.workDate,d.shiftTimes[session.shiftName]).endAt;}catch{}
        if(Date.parse(prepared.startAt)<=Date.now()||!busyEnd||Date.parse(busyEnd)>Date.parse(prepared.startAt))fail(task.personName+" 或设备仍有未结束班次，请先收班或处理占用");
      }
      for(const row of d.assignments.filter(r=>r.status==="active"&&r.workDate===prepared.workDate&&r.shiftName===prepared.shiftName&&(r.personId===task.personId||(task.vehicleId&&r.vehicleId===task.vehicleId))))if(!old||row.releaseId!==old.id)fail("人员或设备已有启用排班，请先处理："+task.personName);
    }
    const at=new Date().toISOString(),id=uid(),version=Math.max(0,...d.taskReleases.filter(r=>r.workDate===prepared.workDate&&r.shiftName===prepared.shiftName&&r.team===prepared.team).map(r=>r.version||1))+1;
    const release={...clone(prepared),id,version,status:"published",publishedAt:at,publishedBy:a.id,publisherName:a.name,settingsSnapshot:clone(d.settings)};
    const retained=new Set();
    for(const task of release.tasks){
      task.id=uid();
      if(["driver","excavator"].includes(task.kind)){
        const prior=old?.tasks.find(t=>t.sourceSlotId===task.sourceSlotId&&sameTarget(t,task));
        let row=prior?.assignmentId?d.assignments.find(r=>r.id===prior.assignmentId):null;
        if(!row){row={id:uid(),createdAt:at,status:"active"};d.assignments.unshift(row);}
        const status=row.status==="completed"?"completed":"active";
        Object.assign(row,{personId:task.personId,vehicleId:task.vehicleId,excavatorId:task.kind==="driver"?task.group.excavatorId:"",kind:task.kind,workDate:release.workDate,shiftName:release.shiftName,team:release.team,status,releaseId:id,taskId:task.id,sourceSlotId:task.sourceSlotId,startAt:release.startAt,endAt:release.endAt,regions:clone(task.regions),groupSnapshot:clone(task.group),activatedAt:at});
        task.assignmentId=row.id;retained.add(row.id);
        for(const s of d.shifts.filter(s=>s.assignmentId===row.id&&s.status!=="closed"))s.candidate=null;
      }else task.assignmentId=null;
      d.messages.unshift({id:uid(),target:task.personId,body:"调度已发布 "+release.workDate+" "+release.shiftName+" · "+release.team+" 任务（第"+version+"版），到点自动执行",ref:id,at,readBy:[]});
    }
    if(old){old.status="superseded";old.supersededAt=at;old.supersededBy=id;for(const row of d.assignments.filter(r=>r.releaseId===old.id&&!retained.has(r.id)&&r.status==="active")){row.status="cancelled";row.cancelledAt=at;row.cancelNote="任务重新发布";}for(const task of old.tasks)if(!release.tasks.some(t=>sameTarget(task,t)))d.messages.unshift({id:uid(),target:task.personId,body:"原任务已被调度新版本替代，请查看最新任务看板",ref:old.id,at,readBy:[]});}
    d.taskReleases.unshift(release);
    d.audit.unshift({id:uid(),at,personId:a.id,actor:a.name,role:a.applicationRole,type:"发布班次任务",detail:release.workDate+" "+release.shiftName+" "+release.team+" 第"+version+"版",releaseId:id,version});
    return id;
  }
  function zonesFor(d,assignment,excavatorId){
    if(!assignment?.releaseId)return null;
    const release=d.taskReleases.find(r=>r.id===assignment.releaseId);
    if(!release)return {load:null,unloads:[]};
    if(!excavatorId||excavatorId===assignment.excavatorId||assignment.kind==="excavator")return clone(assignment.regions||{load:null,unloads:[]});
    const group=release.groups.find(g=>g.excavatorId===excavatorId);
    return group?clone(group.regions):{load:null,unloads:[]};
  }
  window.MineTaskEngine=Object.freeze({timeWindow,phase,clockKey,suggestDate,prepare,publish,zonesFor,timeZone:TZ});
})();
