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
  function inspectionData(d,task){
    const sessions=(d.shifts||[]).filter(s=>s.assignmentId===task.assignmentId&&s.personId===task.personId&&s.vehicleId===task.vehicleId);
    const ids=new Set(sessions.map(s=>s.id));
    const reports=(d.inspections||[]).filter(i=>ids.has(i.shiftId)&&i.personId===task.personId&&i.vehicleId===task.vehicleId).slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
    return {sessions,reports,checked:reports.length>0||sessions.some(s=>s.startedWorkAt)};
  }
  function inspection(d,task){
    const value=inspectionData(d,task);
    return !value.checked?"待使用前检查":value.reports[0]?.outcome==="abnormal"?"已检查 · 有异常":"检查已完成";
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
  function teamTrips(d,m,workDate,team,shiftName=null){
    const rows=(d.trips||[]).filter(t=>{
      if(t.status!=="completed"||t.mode!=="gps"||t.workDate!==workDate||(shiftName&&t.shiftName!==shiftName))return false;
      const release=(d.taskReleases||[]).find(v=>v.id===t.releaseId);
      const assignment=(d.assignments||[]).find(a=>a.id===t.assignmentId);
      const tripTeam=release?.team||assignment?.team||m.people.find(p=>p.id===t.personId)?.team;
      return tripTeam===team;
    });
    return [...new Map(rows.map(t=>[t.id,t])).values()];
  }
  function shiftTripSummary(d,m,r){
    const unique=teamTrips(d,m,r.workDate,r.team,r.shiftName);
    return {total:unique.length,materials:Object.fromEntries(["渣","煤","只记车数"].map(name=>[name,unique.filter(t=>t.material===name).length]))};
  }
  function completedTrips(d,r,task){
    const rows=(d.trips||[]).filter(t=>t.status==="completed"&&t.mode==="gps"&&t.workDate===r.workDate&&t.shiftName===r.shiftName);
    const own=task.kind==="driver"?rows.filter(t=>t.personId===task.personId):rows.filter(t=>t.excavatorId===task.vehicleId&&excavatorOperator(d,t)===task.personId);
    return [...new Map(own.map(t=>[t.id,t])).values()].sort((a,b)=>Date.parse(b.completedAt)-Date.parse(a.completedAt));
  }
  const completedCount=(d,r,task)=>completedTrips(d,r,task).length;
  function detailLink(r,task,type,label,className="",title=""){
    return '<button type="button" class="task-detail-link '+className+'" data-task-detail="'+type+'" data-task-release="'+esc(r.id)+'" data-task-id="'+esc(task.id)+'"'+(title?' title="'+esc(title)+'"':"")+'>'+label+'</button>';
  }
  function equipment(d,r,task,kind,code,name,ownId){
    const requiresInspection=task&&["driver","excavator"].includes(task.kind);
    const device=task&&task.vehicleId?detailLink(r,task,"equipment",esc(code||"未绑定设备")):esc(code||"未绑定设备");
    const person=task?detailLink(r,task,"person",esc(name||"未分配人员")):esc(name||"未分配人员");
    const count=requiresInspection?' · '+detailLink(r,task,"trips",(task.kind==="excavator"?"装车 ":"车数 ")+completedCount(d,r,task)+"车","task-driver-count","点击查看本班已完成车次明细"):"";
    const check=requiresInspection?detailLink(r,task,"inspection",esc(inspection(d,task)),"task-inspection-link "+(inspectionData(d,task).checked?"task-inspected":"task-uninspected"),"点击查看使用前检查结果"):"";
    return '<article class="task-equipment task-equipment-'+kind+(task?.personId===ownId?' task-own-equipment':'')+'"><strong>'+device+'</strong><span>'+person+count+'</span>'+check+'</article>';
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
    const haul=shiftTripSummary(d,m,r);
    const ownTasks=dispatch?r.tasks:r.tasks.filter(t=>t.personId===person.id&&t.role===person.applicationRole);
    const groups=r.groups||[];
    const rows=groups.map(g=>{
      const excavator=r.tasks.find(t=>t.kind==="excavator"&&t.group?.sourceGroupId===g.sourceGroupId);
      const trucks=r.tasks.filter(t=>t.kind==="driver"&&t.group?.sourceGroupId===g.sourceGroupId);
      const regions=g.regions||{load:null,unloads:[]};
      return '<section class="task-production-group"><h4>'+esc(groupTitle(g.number))+'</h4><div class="task-equipment-row">'+equipment(d,r,excavator,"excavator",g.excavatorCode,g.excavatorDriverName,person.id)+trucks.map(t=>equipment(d,r,t,"truck",t.vehicleCode,t.personName,person.id)).join("")+'<article class="task-region"><strong>装卸区域</strong><span>装载区：'+esc(regions.load?.name||"未设置")+'</span><span>卸载区：'+esc((regions.unloads||[]).map(z=>z.name+(z.material?" · "+z.material:"")).join("、")||"未设置")+'</span></article></div>'+ownTasks.filter(t=>t.group?.sourceGroupId===g.sourceGroupId).map(t=>workAction(d,r,t,person,dispatch)).join("")+'</section>';
    }).join("");
    const auxiliary=r.tasks.filter(t=>t.kind==="auxiliary");
    const aux=auxiliary.length?'<section class="task-auxiliary"><h4>辅助车辆 / 人员</h4><div class="task-equipment-row">'+auxiliary.map(t=>'<div class="task-auxiliary-item">'+equipment(d,r,t,"auxiliary",t.vehicleCode,t.personName,person.id)+(t.content?'<div class="task-aux-content"><b>作业内容</b><span>'+esc(t.content)+'</span></div>':"")+'</div>').join("")+'</div></section>':"";
    return '<section class="task-release"><header><div><div class="task-release-title"><h3>'+esc(r.workDate+" · "+r.shiftName+" · "+r.team)+'</h3><span class="task-shift-total" title="该班组本班已完成的真实定位车次；包含非卸载区完成，不含未完成、作废及模拟记录">当班总拉运车数：<b>'+haul.total+'</b> 车</span>'+["渣","煤","只记车数"].map(name=>'<span class="task-shift-material">'+esc(name)+'：<b>'+haul.materials[name]+'</b> 车</span>').join("")+'</div><p>'+esc(time(r.startAt)+" — "+time(r.endAt))+' <span>第'+esc(r.version)+'版</span></p></div><span class="task-phase task-'+esc(E().phase(r))+'">'+esc(names[E().phase(r)]||"")+'</span></header>'+releaseStats(d,m,r)+rows+aux+'</section>';
  }
  function render(d,m,person,options={}){
    const dispatch=options.dispatch===true,key=dispatch?"dispatch":person.id+":"+person.applicationRole,mode=modes.get(key)||"current";
    contexts.set(key,{d,m,person,options});
    if(dispatch&&options.history){
      const {workDate,team}=options.history;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(workDate)||!["生产A组","生产B组"].includes(team))return '<p class="task-empty">请选择有效日期和班组。</p>';
      const dayTrips=teamTrips(d,m,workDate,team),linked=new Set(dayTrips.map(t=>t.releaseId)),releases=(d.taskReleases||[]).filter(r=>r.workDate===workDate&&r.team===team&&(r.status==="published"||linked.has(r.id))).slice().sort((a,b)=>Number(b.version)-Number(a.version)||Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
      const rows=["白班","夜班"].map(shift=>releases.find(r=>r.shiftName===shift)).filter(Boolean);
      return '<section class="task-board task-history-board" data-task-board-key="'+esc(key)+'"><div class="task-board-toolbar"><div><strong>'+esc(workDate+" · "+team+" · 当天任务看板")+'</strong><span>白班、夜班按班次开始日期归属</span></div><div class="task-history-actions"><button type="button" class="task-view-button" data-action="backHaulSummary">返回统计</button><button type="button" class="task-view-button" data-action="exitHaulHistory">返回任务看板</button></div></div><div class="task-history-total">当天总拉运车数：<b>'+dayTrips.length+'</b> 车 <button type="button" class="task-view-button" data-task-day-detail="trips">查看当天拉运明细</button></div>'+(rows.length?rows.map(r=>releaseSection(d,m,r,person,true)).join(""):'<p class="task-empty">当天没有已发布的任务看板记录。'+(dayTrips.length?'可通过上方按钮查看已保存的拉运明细。':"")+'</p>')+'</section>';
    }
    const schedule=slots(d),slot=schedule[mode];
    const published=(d.taskReleases||[]).filter(r=>r.status==="published");
    // Never use editable productionGroups or auxiliaryPlans to preview the next shift.
    const rows=slot?published.filter(r=>r.workDate===slot.workDate&&r.shiftName===slot.shiftName&&(mode==="current"?E().phase(r)==="running":E().phase(r)==="scheduled")&&(dispatch||r.team===person.team||r.tasks.some(t=>t.personId===person.id&&t.role===person.applicationRole))):[];
    const hasPublished=slot&&published.some(r=>r.workDate===slot.workDate&&r.shiftName===slot.shiftName&&(dispatch||r.team===person.team));
    const empty=!slot?(mode==="current"?"当前不在班次时间内":"任务未发布"):!hasPublished?"任务未发布":"本班暂无分配给你的任务";
    return '<section class="task-board" data-task-board-key="'+esc(key)+'">'+(options.hideTitle?"":'<h2>'+esc(dispatch?"任务看板":"我的任务看板")+'</h2>')+'<div class="task-board-toolbar"><div><strong>'+esc(mode==="next"?"下一班次排班":"当前班次任务")+'</strong>'+(slot?'<span>'+esc(slot.workDate+" · "+slot.shiftName+" · "+time(slot.startAt)+" — "+time(slot.endAt))+'</span>':"")+'</div><button type="button" class="task-view-button" data-task-board-view="'+(mode==="next"?"current":"next")+'">'+(mode==="next"?"返回当前班次":"下一班次排班")+'</button></div>'+(rows.length?rows.map(r=>releaseSection(d,m,r,person,dispatch)).join(""):'<p class="task-empty">'+esc(empty)+'</p>')+'</section>';
  }
  let detailsDialog=null,detailsToken=0,detailUrls=[];
  const when=value=>value?new Date(value).toLocaleString("zh-CN",{timeZone:"Asia/Ulaanbaatar",hour12:false}):"—";
  const info=fields=>'<dl class="task-detail-fields">'+fields.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value==null||value===""?"—":value)+'</dd></div>').join("")+'</dl>';
  function releaseDetailPhotos(){for(const url of detailUrls)URL.revokeObjectURL(url);detailUrls=[];}
  function ensureDetailsDialog(){
    if(detailsDialog)return detailsDialog;
    detailsDialog=document.createElement("dialog");detailsDialog.className="task-details-dialog";detailsDialog.setAttribute("aria-labelledby","taskDetailsTitle");
    detailsDialog.innerHTML='<header><h2 id="taskDetailsTitle"></h2><button type="button" class="task-details-close" data-task-details-close aria-label="关闭详情">×</button></header><div class="task-details-body"></div>';
    detailsDialog.addEventListener("close",()=>{detailsToken++;releaseDetailPhotos();});
    detailsDialog.addEventListener("click",event=>{if(event.target===detailsDialog)detailsDialog.close();});
    document.body.append(detailsDialog);return detailsDialog;
  }
  function openDetails(title,body){
    const dialog=ensureDetailsDialog();detailsToken++;releaseDetailPhotos();
    dialog.querySelector("h2").textContent=title;dialog.querySelector(".task-details-body").innerHTML=body;
    if(!dialog.open)dialog.showModal();return detailsToken;
  }
  function photoMarkup(files){
    return files.length?'<div class="task-detail-photos">'+files.map((file,index)=>'<figure data-task-photo="'+index+'"><figcaption>'+esc(file.label||file.name||"照片")+'</figcaption><span class="task-photo-message">正在读取附件…</span></figure>').join("")+'</div>':"";
  }
  async function loadDetailPhotos(files,token){
    for(const [index,file] of files.entries()){
      if(token!==detailsToken||!detailsDialog?.open)return;
      const host=detailsDialog.querySelector('[data-task-photo="'+index+'"]');if(!host)continue;
      try{
        let url="",imageFile=false;
        if(file.id&&window.MineAttachmentStore){
          const record=await MineAttachmentStore.get(file.id);
          if(token!==detailsToken||!detailsDialog.open)return;
          if(record?.blob){url=URL.createObjectURL(record.blob);detailUrls.push(url);imageFile=String(record.type||record.blob.type||file.type).startsWith("image/");}
        }else if(/^data:image\//.test(file.data||"")){url=file.data;imageFile=true;}
        host.querySelector(".task-photo-message")?.remove();
        if(!url){const span=document.createElement("span");span.textContent="当前浏览器未找到此附件";host.append(span);continue;}
        const link=document.createElement("a");link.href=url;link.target="_blank";link.rel="noopener";link.textContent=imageFile?"查看原图":"打开附件";
        if(imageFile){const img=document.createElement("img");img.src=url;img.alt=file.label||file.name||"检查照片";host.append(img);}
        host.append(link);
      }catch(error){if(token===detailsToken&&detailsDialog.open){const span=host.querySelector(".task-photo-message");if(span)span.textContent="附件读取失败："+error.message;}}
    }
  }
  function deviceDetails(d,m,task){
    const v=m.vehicles.find(v=>v.id===task.vehicleId),state=v?window.MineTransport.equipmentState(d,m,v.id):"missing";
    const stateNames={working:"可作业",paused:"暂停",repair:"维修",maintenance:"保养",disabled:"停用",missing:"档案未找到"};
    const pause=(d.devices||[]).find(v=>v.vehicleId===task.vehicleId);
    const fields=[["设备编号",v?.code||task.vehicleCode],["设备名称",v?.name||task.vehicleName],["设备类别",v?.category||v?.model||task.vehicleCategory],["当前状态",stateNames[state]||state],["档案状态",v?.status],["所属公司 / 车队",v?.team],["车牌号",v?.plate],["车架号",v?.vin],["发动机号",v?.engineNumber],["载重 / 斗容",v?.capacity],["燃油类型",v?.fuelType],["入场日期",v?.entryDate],["暂停 / 维修说明",pause?.reason],["备注",v?.note]];
    const files=[["合格证照片",v?.attachments?.certificatePhoto],["进场照片",v?.attachments?.entryPhoto]].filter(([,f])=>f).map(([label,file])=>({...file,label}));
    const token=openDetails("设备信息 · "+(v?.code||task.vehicleCode),info(fields)+photoMarkup(files));return loadDetailPhotos(files,token);
  }
  function personDetails(d,m,task){
    const p=m.people.find(p=>p.id===task.personId);
    const fields=[["姓名",p?.name||task.personName],["人员编号",task.personId],["申请岗位",p?.role||task.role],["所属班组",p?.team||task.personTeam],["人员状态",p?.status],["手机号码",p?.phone],["入职日期",p?.joinDate]];
    const files=p?.attachments?.selfie?[{...p.attachments.selfie,label:"本人照片"}]:[];
    const token=openDetails("人员信息 · "+(p?.name||task.personName),info(fields)+photoMarkup(files));return loadDetailPhotos(files,token);
  }
  const distanceText=metres=>metres>=1000?(metres/1000).toFixed(3)+" 公里":Math.round(metres)+" 米";
  function tripDistance(t){
    const h=t.haulDistance;
    if(h?.version===1&&Number.isFinite(h.metres)&&h.metres>=0){
      const gapReasons=[...new Set((h.gaps||[]).map(g=>g.reason))].join("；");
      return {label:h.complete&&h.finishedAt?distanceText(h.metres):"已记录 "+distanceText(h.metres)+"（轨迹不完整）",basis:"GPS有效轨迹估算，已过滤定位抖动",note:(!h.finishedAt?"未记录完整的卸料终点。":"")+(gapReasons?"定位缺失原因："+gapReasons+"。":"")+(h.endSource==="outside-last-fix"?"非卸载区卸料：距离截至最后有效定位。":"")+"不含空车返程。",samples:h.samples||0};
    }
    const usable=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Number.isFinite(p.accuracy)&&p.accuracy<=(t.settings?.maxAccuracy??50);
    if(usable(t.loadPoint)&&usable(t.unloadPoint)){
      const metres=window.MineTransport.distance(t.loadPoint,t.unloadPoint);
      return {label:distanceText(metres)+"（直线距离）",basis:"起终点直线距离，并非实际行驶运距",note:"此旧车次未保存完整轨迹，不能还原实际行驶距离。"};
    }
    return {label:"未记录运距",basis:"缺少完整轨迹或有效起终点定位",note:"不按区域中心或当前地图位置补算历史运距。"};
  }
  function tripDuration(t){
    const start=Date.parse(t.loadedAt),end=Date.parse(t.completedAt);if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return "未记录";
    const seconds=Math.round((end-start)/1000),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60);
    return (hours?hours+"小时 ":"")+(minutes?minutes+"分 ":"")+(seconds%60)+"秒";
  }
  function tripsDetails(d,m,r,task,selectedTrips=null){
    const trips=(selectedTrips||completedTrips(d,r,task)).slice().sort((a,b)=>Date.parse(a.loadedAt)-Date.parse(b.loadedAt)||String(a.id).localeCompare(String(b.id))),materials={};
    for(const t of trips){const name=t.material||"未分类";materials[name]=(materials[name]||0)+1;}
    const summary=info([["任务班次",r.workDate+" "+r.shiftName],[selectedTrips?"统计范围":"人员",task.personName],["有效车数",trips.length+"车"],["物料分类",Object.entries(materials).map(([name,n])=>name+" "+n+"车").join("、")||"暂无"]]);
    const rows=trips.length?'<div class="task-trip-list">'+trips.map((t,index)=>{
      const haul=tripDistance(t),source=(d.taskReleases||[]).find(v=>v.id===t.releaseId),operatorId=excavatorOperator(d,t),operator=m.people.find(p=>p.id===operatorId)?.name||source?.groups?.find(g=>g.excavatorId===t.excavatorId)?.excavatorDriverName||"未记录";
      const fields=[["车次所属班次",t.workDate+" "+t.shiftName],["汽车编号",t.vehicleCode],["汽车司机",t.personName],["实际装载挖机",t.excavatorCode],["挖机司机",operator],["装载类型",t.isTemporary?"临时非绑定挖机装车":"绑定挖机装车"],["物料类型",t.material||"未分类"],["装载区",t.loadZone?.name],["卸载位置",t.method==="outside"?"非卸载区卸料":t.unloadZone?.name],["装载时间",when(t.loadedAt)],["离开装载区时间",when(t.departedAt)],["卸料完成时间",when(t.completedAt)],["本趟用时（含等待）",tripDuration(t)],["运距",haul.label],["距离口径",haul.basis],...(haul.samples?[["有效定位采样",haul.samples+"次"]]:[]),["卸料方式",t.method==="outside"?"非卸载区卸料":"GPS卸载区自动识别"],["卸料说明",t.outsideNote||"未填写"],["车次编号",t.id]];
      const events=(t.events||[]).length?'<details class="task-trip-events"><summary>查看本趟过程记录</summary><ol>'+t.events.map(event=>'<li><time>'+esc(when(event.at))+'</time> '+esc(event.type)+(event.reason?' · '+esc(event.reason):"")+'</li>').join("")+'</ol></details>':"";
      return '<article class="task-trip-detail"><header><h3>第'+(index+1)+'趟 · '+esc(t.vehicleCode)+'</h3><strong class="task-trip-distance">'+esc(haul.label)+'</strong></header>'+info(fields)+'<p class="task-trip-distance-note">'+esc(haul.note)+'</p>'+events+'</article>';
    }).join("")+'</div>':'<p class="task-detail-note">'+(selectedTrips?'当天该班组暂无已完成的有效拉运车次。':'本班暂无计入该人员数量的已完成车次。')+'</p>';
    openDetails((selectedTrips?"当天逐趟拉运明细":task.kind==="excavator"?"逐趟装车明细":"逐趟拉运明细")+" · "+task.personName,summary+rows);
  }
  function inspectionDetails(d,r,task){
    const result=inspectionData(d,task),files=[];
    const heading=info([["任务班次",r.workDate+" "+r.shiftName],["检查人员",task.personName],["设备",task.vehicleCode],["检查状态",inspection(d,task)]]);
    const reports=result.reports.length?result.reports.map(report=>{
      const fault=(d.faults||[]).find(f=>f.id===report.faultId);
      const images=(report.attachments||[]).map(file=>{const index=files.length;files.push({...file,label:(file.name||"异常照片")+" · "+when(report.at)});return '<figure data-task-photo="'+index+'"><figcaption>'+esc(file.name||"异常照片")+'</figcaption><span class="task-photo-message">正在读取附件…</span></figure>';}).join("");
      return '<section class="task-inspection-report"><h3 class="'+(report.outcome==="abnormal"?"task-report-abnormal":"task-inspected")+'">'+(report.outcome==="abnormal"?"检查结果：发现异常":"检查结果：无异常")+'</h3>'+info([["检查时间",when(report.at)],["检查人",report.personName],["检查说明",report.note||"未填写"],...(report.outcome==="abnormal"?[["关联上一班驾驶员",report.responsibleName||"未记录"],["异常处理状态",fault?.status==="resolved"?"已处理":"待处理"],["处理说明",fault?.resolution]]:[])])+(images?'<div class="task-detail-photos">'+images+'</div>':"")+'</section>';
    }).join(""):'<p class="task-detail-note '+(result.checked?"":"task-uninspected")+'">'+(result.checked?"该班次已有开工记录，但未找到对应的检查结果明细。":"尚未提交使用前检查记录。")+'</p>';
    const token=openDetails("使用前检查结果 · "+task.vehicleCode,heading+reports);return loadDetailPhotos(files,token);
  }
  async function showTaskDetail(context,releaseId,taskId,type){
    const L=window.MineLogistics,T=window.MineTransport,current=L.context(context.person.applicationRole);
    if(current.id!==context.person.id||!L.active(current))throw new Error("当前人员状态或本人登记已变化，请重新进入工作台");
    await T.sync();
    const d=T.get(),m=L.main(),r=d.taskReleases.find(r=>r.id===releaseId),task=r?.tasks.find(t=>t.id===taskId);
    if(!r||!task)throw new Error("任务记录已变化，请刷新看板后重试");
    if(type==="equipment")return deviceDetails(d,m,task);
    if(type==="person")return personDetails(d,m,task);
    if(type==="trips"&&["driver","excavator"].includes(task.kind))return tripsDetails(d,m,r,task);
    if(type==="inspection"&&["driver","excavator"].includes(task.kind))return inspectionDetails(d,r,task);
  }
  if(typeof document!=="undefined")document.addEventListener("click",async event=>{
    if(event.target.closest("[data-task-details-close]")){detailsDialog?.close();return;}
    const button=event.target.closest("[data-task-board-view],[data-task-detail],[data-task-day-detail]");if(!button)return;
    const board=button.closest("[data-task-board-key]"),key=board?.dataset.taskBoardKey,context=contexts.get(key);if(!context)return;
    if(button.dataset.taskDayDetail){
      try{
        const T=window.MineTransport,L=window.MineLogistics,current=T.context("dispatch");
        if(!context.options.dispatch||!context.options.history||current.id!==context.person.id)throw new Error("当前账号不能查看此统计明细");
        await T.sync();const d=T.get(),m=L.main(),{workDate,team}=context.options.history;
        tripsDetails(d,m,{workDate,shiftName:"白班 / 夜班"},{kind:"driver",personName:team},teamTrips(d,m,workDate,team));
      }catch(error){openDetails("无法读取详情",'<p class="task-detail-note">'+esc(error.message)+'</p>');}return;
    }
    if(button.dataset.taskDetail){try{await showTaskDetail(context,button.dataset.taskRelease,button.dataset.taskId,button.dataset.taskDetail);}catch(error){openDetails("无法读取详情",'<p class="task-detail-note">'+esc(error.message)+'</p>');}return;}
    const mode=button.dataset.taskBoardView;if(!["current","next"].includes(mode))return;
    modes.set(key,mode);board.outerHTML=render(context.d,context.m,context.person,context.options);
  });
  window.MineTaskBoard=Object.freeze({render,clockKey,slots,excavatorOperator});
})();
