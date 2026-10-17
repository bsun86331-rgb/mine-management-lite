/* Compact, published-only shift boards shared by work ports. */
(() => {
  "use strict";
  const E=()=>window.MineTaskEngine,esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const modes=new Map(),contexts=new Map();
  const time=v=>new Date(v).toLocaleString("zh-CN",{timeZone:"Asia/Ulaanbaatar",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
  const names={scheduled:"待开始",running:"执行中",ended:"班次时间已结束",completed:"已收班",cancelled:"已取消"};
  const dayOffset=(day,n)=>new Date(Date.parse(day+"T00:00:00Z")+n*86400000).toISOString().slice(0,10);
  function slots(d,at=Date.now()){
    const p=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Ulaanbaatar",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(at)).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
    const today=p.year+"-"+p.month+"-"+p.day,list=new Map();
    for(const offset of [-1,0,1,2])for(const shiftName of ["白班","夜班"]){
      const workDate=dayOffset(today,offset);try{list.set(workDate+shiftName,{workDate,shiftName,...E().timeWindow(workDate,d.shiftTimes[shiftName])});}catch{}
    }
    // Published times are immutable snapshots; they take precedence over later settings.
    const seen=new Set();
    for(const r of (d.taskReleases||[]).filter(r=>r.status==="published").slice().sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))){
      const key=r.workDate+r.shiftName;if(list.has(key)&&!seen.has(key)){list.set(key,{workDate:r.workDate,shiftName:r.shiftName,startAt:r.startAt,endAt:r.endAt});seen.add(key);}
    }
    const ordered=[...list.values()].sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt));
    const current=ordered.filter(s=>Date.parse(s.startAt)<=at&&at<Date.parse(s.endAt)).pop()||null;
    const next=ordered.find(s=>Date.parse(s.startAt)>at&&(!current||Date.parse(s.startAt)>=Date.parse(current.endAt)))||null;
    return {current,next};
  }
  function clockKey(d,at=Date.now()){const s=slots(d,at);return E().clockKey(d,at)+"|"+[s.current,s.next].map(v=>v?v.workDate+v.shiftName+v.startAt:"gap").join("|");}
  function inspection(d,task){
    if(!["driver","excavator"].includes(task.kind))return "";
    const s=(d.shifts||[]).find(s=>s.assignmentId===task.assignmentId);
    return s?.status==="closed"?"已收班":s?.startedWorkAt||s?.status==="working"?"检查已完成":s?.status==="checked"?"异常待处理":"待使用前检查";
  }
  function workAction(d,r,task,person,dispatch){
    if(dispatch||!task||!["driver","excavator"].includes(task.kind)||task.personId!==person.id||task.role!==person.applicationRole||E().phase(r)!=="running")return "";
    const assignment=(d.assignments||[]).find(a=>a.id===task.assignmentId);if(assignment?.status!=="active")return "";
    const own=(d.shifts||[]).find(s=>s.personId===person.id&&s.status!=="closed");
    return own?'<button type="button" data-action="go-work" class="task-work-button">进入本班作业 / 检查</button>':'<button type="button" data-action="taskInspection" data-id="'+esc(task.assignmentId)+'" class="task-work-button">进行使用前检查</button>';
  }
  function excavatorOperator(d,trip){
    const at=Date.parse(trip.loadedAt);
    const actual=(d.shifts||[]).filter(s=>s.kind==="excavator"&&s.vehicleId===trip.excavatorId&&s.workDate===trip.workDate&&s.shiftName===trip.shiftName&&s.startedWorkAt&&Date.parse(s.startedWorkAt)<=at&&(!s.closedAt||at<=Date.parse(s.closedAt))).sort((a,b)=>Date.parse(b.startedWorkAt)-Date.parse(a.startedWorkAt))[0];
    if(actual)return actual.personId;
    // Use the release recorded on the trip, including its actual temporary excavator.
    const published=(d.taskReleases||[]).find(r=>r.id===trip.releaseId);
    const group=published?.groups?.find(g=>g.excavatorId===trip.excavatorId);
    if(group?.excavatorDriverId)return group.excavatorDriverId;
    if(published)return null;
    const legacy=[...new Set((d.assignments||[]).filter(a=>a.kind==="excavator"&&a.vehicleId===trip.excavatorId&&a.workDate===trip.workDate&&a.shiftName===trip.shiftName).map(a=>a.personId))];
    return legacy.length===1?legacy[0]:null;
  }
  function completedCount(d,r,task){
    const rows=(d.trips||[]).filter(t=>t.status==="completed"&&t.mode==="gps"&&t.workDate===r.workDate&&t.shiftName===r.shiftName);
    const own=task.kind==="driver"?rows.filter(t=>t.personId===task.personId):rows.filter(t=>t.excavatorId===task.vehicleId&&excavatorOperator(d,t)===task.personId);
    return new Set(own.map(t=>t.id)).size;
  }
  function equipment(d,r,task,kind,code,name,ownId){
    return '<article class="task-equipment task-equipment-'+kind+(task?.personId===ownId?' task-own-equipment':'')+'"><strong>'+esc(code||"未绑定设备")+'</strong><span>'+esc(name||"未分配人员")+(task&&["driver","excavator"].includes(task.kind)?'<b class="task-driver-count" title="本班已完成的真实定位车次；不含未完成、作废与模拟记录"> · '+(task.kind==="excavator"?'装车 ':'车数 ')+completedCount(d,r,task)+'车</b>':"")+'</span>'+(task?'<small>'+esc(inspection(d,task))+'</small>':"")+'</article>';
  }
  function groupTitle(n){const v=["","一","二","三","四","五","六","七","八","九","十"];return "第"+(v[n]||n)+"组生产设备";}
  function releaseStats(d,m,r){
    const T=window.MineTransport,roles=new Set(["driver","excavator",...(T.auxiliaryRoles||[])]);
    const people=m.people.filter(p=>p.team===r.team&&roles.has(p.applicationRole)&&["在岗","已通过","休假","请假"].includes(p.status));
    const allocatedPeople=new Set(r.tasks.map(t=>t.personId));
    const leave=p=>["休假","请假"].includes(p.status);
    const attending=people.filter(p=>!leave(p)&&allocatedPeople.has(p.id)).length,leaveCount=people.filter(leave).length;
    const shiftReleases=(d.taskReleases||[]).filter(v=>v.status==="published"&&v.workDate===r.workDate&&v.shiftName===r.shiftName);
    const assignedDevices=new Set(shiftReleases.flatMap(v=>v.tasks.map(t=>t.vehicleId)).filter(Boolean));
    const devices=predicate=>{
      const pool=m.vehicles.filter(predicate);let attending=0,repair=0,idle=0;
      for(const v of pool){const state=T.equipmentState(d,m,v.id);if(["repair","maintenance"].includes(state))repair++;else if(state==="working"&&assignedDevices.has(v.id))attending++;else idle++;}
      return {total:pool.length,attending,repair,idle};
    };
    const excavators=devices(T.isExcavator),trucks=devices(T.isHaulTruck);
    const count=(label,n)=>'<span>'+label+' <b>'+n+'</b></span>';
    const equipment=(label,v)=>'<div class="task-stat-group" title="共享设备池；出勤按本班次各班组已发布分配统计，维修含保养，停滞含未分配、暂停与停用"><strong>'+label+'</strong>'+count("总数",v.total)+count("出勤",v.attending)+count("维修",v.repair)+count("停滞",v.idle)+'</div>';
    return '<div class="task-shift-stats" aria-label="班次人员与设备统计"><div class="task-stat-group" title="本班组已审核的一线人员；出勤按已发布分配统计，不代表已完成使用前检查；请假读取档案休假状态"><strong>人员·本班组</strong>'+count("总数",people.length)+count("出勤",attending)+count("请假",leaveCount)+'</div>'+equipment("挖机·共享",excavators)+equipment("汽车·共享",trucks)+'</div>';
  }
  function releaseSection(d,m,r,person,dispatch){
    const ownTasks=dispatch?r.tasks:r.tasks.filter(t=>t.personId===person.id&&t.role===person.applicationRole),taskIds=new Set(ownTasks.map(t=>t.id));
    const groups=(r.groups||[]).filter(g=>ownTasks.some(t=>t.group?.sourceGroupId===g.sourceGroupId));
    const rows=groups.map(g=>{
      const excavator=r.tasks.find(t=>t.kind==="excavator"&&t.group?.sourceGroupId===g.sourceGroupId);
      const trucks=r.tasks.filter(t=>t.kind==="driver"&&t.group?.sourceGroupId===g.sourceGroupId&&(dispatch||taskIds.has(t.id)||ownTasks.some(t=>t.id===excavator?.id)));
      const regions=g.regions||{load:null,unloads:[]};
      return '<section class="task-production-group"><h4>'+esc(groupTitle(g.number))+'</h4><div class="task-equipment-row">'+equipment(d,r,excavator,"excavator",g.excavatorCode,g.excavatorDriverName,person.id)+trucks.map(t=>equipment(d,r,t,"truck",t.vehicleCode,t.personName,person.id)).join("")+'<article class="task-region"><strong>装卸区域</strong><span>装载区：'+esc(regions.load?.name||"未设置")+'</span><span>卸载区：'+esc((regions.unloads||[]).map(z=>z.name+(z.material?" · "+z.material:"")).join("、")||"未设置")+'</span></article></div>'+ownTasks.filter(t=>t.group?.sourceGroupId===g.sourceGroupId).map(t=>workAction(d,r,t,person,dispatch)).join("")+'</section>';
    }).join("");
    const auxiliary=ownTasks.filter(t=>t.kind==="auxiliary");
    const aux=auxiliary.length?'<section class="task-auxiliary"><h4>辅助车辆 / 人员</h4><div class="task-equipment-row">'+auxiliary.map(t=>'<div class="task-auxiliary-item">'+equipment(d,r,t,"auxiliary",t.vehicleCode,t.personName,person.id)+(t.content?'<div class="task-aux-content"><b>作业内容</b><span>'+esc(t.content)+'</span></div>':"")+'</div>').join("")+'</div></section>':"";
    return '<section class="task-release"><header><div><h3>'+esc(r.workDate+" · "+r.shiftName+" · "+r.team)+'</h3><p>'+esc(time(r.startAt)+" — "+time(r.endAt))+' <span>第'+esc(r.version)+'版</span></p></div><span class="task-phase task-'+esc(E().phase(r))+'">'+esc(names[E().phase(r)]||"")+'</span></header>'+releaseStats(d,m,r)+rows+aux+'</section>';
  }
  function render(d,m,person,options={}){
    const dispatch=options.dispatch===true,key=dispatch?"dispatch":person.id+":"+person.applicationRole,mode=modes.get(key)||"current";
    contexts.set(key,{d,m,person,options});
    const schedule=slots(d),slot=schedule[mode];
    const published=(d.taskReleases||[]).filter(r=>r.status==="published");
    // Never use editable productionGroups or auxiliaryPlans to preview the next shift.
    const rows=slot?published.filter(r=>r.workDate===slot.workDate&&r.shiftName===slot.shiftName&&(mode==="current"?E().phase(r)==="running":E().phase(r)==="scheduled")&&(dispatch||r.tasks.some(t=>t.personId===person.id&&t.role===person.applicationRole))):[];
    const hasPublished=slot&&published.some(r=>r.workDate===slot.workDate&&r.shiftName===slot.shiftName&&(dispatch||r.team===person.team));
    const empty=!slot?(mode==="current"?"当前不在班次时间内":"任务未发布"):!hasPublished?"任务未发布":"本班暂无分配给你的任务";
    return '<section class="task-board" data-task-board-key="'+esc(key)+'">'+(options.hideTitle?"":'<h2>'+esc(dispatch?"任务看板":"我的任务看板")+'</h2>')+'<div class="task-board-toolbar"><div><strong>'+esc(mode==="next"?"下一班次排班":"当前班次任务")+'</strong>'+(slot?'<span>'+esc(slot.workDate+" · "+slot.shiftName+" · "+time(slot.startAt)+" — "+time(slot.endAt))+'</span>':"")+'</div><button type="button" class="task-view-button" data-task-board-view="'+(mode==="next"?"current":"next")+'">'+(mode==="next"?"返回当前班次":"下一班次排班")+'</button></div>'+(rows.length?rows.map(r=>releaseSection(d,m,r,person,dispatch)).join(""):'<p class="task-empty">'+esc(empty)+'</p>')+'</section>';
  }
  if(typeof document!=="undefined")document.addEventListener("click",event=>{
    const button=event.target.closest("[data-task-board-view]");if(!button)return;
    const board=button.closest("[data-task-board-key]"),key=board?.dataset.taskBoardKey,context=contexts.get(key);if(!context)return;
    const mode=button.dataset.taskBoardView;if(!["current","next"].includes(mode))return;
    modes.set(key,mode);board.outerHTML=render(context.d,context.m,context.person,context.options);
  });
  window.MineTaskBoard=Object.freeze({render,clockKey,slots});
})();
