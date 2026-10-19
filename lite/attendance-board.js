/* Daily task attendance and monthly roll-up. Does not rewrite task or attendance records. */
(() => {
"use strict";
const STANDARD_HOURS=12,TEAMS=["生产A组","生产B组"],esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v))&&Number.isFinite(Date.parse(v+"T00:00:00Z"))&&new Date(v+"T00:00:00Z").toISOString().slice(0,10)===v;
const addDays=(v,n)=>new Date(Date.parse(v+"T00:00:00Z")+n*86400000).toISOString().slice(0,10);
const time=v=>Number.isFinite(Date.parse(v))?new Date(v).toLocaleString("zh-CN",{timeZone:"Asia/Ulaanbaatar",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}):"未记录";
const fmt=n=>Number.isFinite(Number(n??0))?Number(n||0).toLocaleString("zh-CN",{maximumFractionDigits:2}):"—";
function unitsFor(hours){return Number.isFinite(hours)&&hours>0?(hours<=STANDARD_HOURS/2?0.5:1):0;}
function monthRange(month){if(!/^\d{4}-\d{2}$/.test(String(month))||!validDate(month+"-01"))throw Error("请选择有效月份");const startDate=month+"-01",n=new Date(startDate+"T00:00:00Z"),endDate=new Date(Date.UTC(n.getUTCFullYear(),n.getUTCMonth()+1,0)).toISOString().slice(0,10);return {startDate,endDate};}
const localDay=at=>new Date(at).toLocaleDateString("sv-SE",{timeZone:"Asia/Ulaanbaatar"});
// Historical attendance uses the actual approved leave window, never today's scheduling clamp.
function leaveOnDay(id,date){
 const S=window.MineLeave;if(!S?.get||!S?.leaveWindow)throw Error("请假记录尚未加载，请刷新后重试");
 const start=Date.parse(date+"T00:00:00+08:00"),end=start+86400000;
 return S.get().requests.some(r=>r.personId===id&&r.status==="approved"&&(()=>{const w=S.leaveWindow(r);return w.startAt<end&&w.endAt>start;})());
}
function unscheduledState(d,id,team,date,at=Date.now()){
 const none=scheduleFor(d,team,date,at).kind==="none",past=validDate(date)&&date<localDay(at);
 if(!none||!past)return {ready:false,onLeave:false};
 try{return {ready:true,onLeave:leaveOnDay(id,date)};}catch(e){return {ready:false,onLeave:false,error:e.message};}
}
function assertUnscheduled(d,id,team,date,units,note){
 const state=unscheduledState(d,id,team,date);
 if(!state.ready)throw Error(state.error||"仅可在次日确认未排班考勤；排班已变化时请重新打开");
 if(![0,1].includes(units))throw Error("未排班请选择0或1个考勤");
 if(state.onLeave&&units>0)throw Error("当日请假，不记考勤");
 if(units>0&&!String(note||"").trim())throw Error("请填写下雨、检查等非司机原因");
}
function scheduleFor(d,team,date,at=Date.now()){
 const latest=new Map();
 for(const r of d.taskReleases||[]){if(r.status!=="published"||r.team!==team||r.workDate!==date||!["白班","夜班"].includes(r.shiftName))continue;const old=latest.get(r.shiftName);if(!old||Number(r.version||1)>Number(old.version||1)||(Number(r.version||1)===Number(old.version||1)&&String(r.publishedAt||"")>String(old.publishedAt||"")))latest.set(r.shiftName,r);}
 const releases=[...latest.values()].sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt)),units={},limits={};
 if(!releases.length)return {kind:"none",label:team?"未排班":"请选择班组",releases,units,limits,ready:false,message:team?"未排班：次日由调度判断非司机原因正常记考勤；请假除外。":"请选择班组，自动读取当天排班。"};
 const valid=releases.every(r=>{const start=Date.parse(r.startAt),end=Date.parse(r.endAt);return Number.isFinite(start)&&Number.isFinite(end)&&end>start&&localDay(start)===date;})&&releases.every((r,i)=>!i||Date.parse(releases[i-1].endAt)<=Date.parse(r.startAt));
 if(!valid)return {kind:"invalid",label:"排班时间待核对",releases,units,limits,ready:false,message:"排班时间无效或重叠，请核对排班记录后确认考勤。"};
 let kind,label;
 if(releases.length===2&&releases[0].shiftName==="白班"&&releases[1].shiftName==="夜班"){
  kind="dayToNight";label="白班转夜班（上满1.5个考勤）";units["白班"]=0.5;units["夜班"]=1;limits["白班"]=0.5;limits["夜班"]=1;
 }else if(releases.length===1){
  const r=releases[0],hours=(Date.parse(r.endAt)-Date.parse(r.startAt))/3600000,hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Ulaanbaatar",hour:"2-digit",hourCycle:"h23"}).format(new Date(r.startAt)));
  const afternoon=localDay(Date.parse(r.endAt))===date&&hour>=12&&hours<=6;
  kind=afternoon?"nightToDay":r.shiftName==="白班"?"day":"night";label=afternoon?"夜班转白班（上满0.5个考勤）":r.shiftName;units[r.shiftName]=afternoon?0.5:unitsFor(hours);limits[r.shiftName]=afternoon?0.5:1;
 }else return {kind:"invalid",label:"排班时间待核对",releases,units,limits,ready:false,message:"同日排班顺序待核对，暂不生成考勤。"};
 const ended=releases.every(r=>at>=Date.parse(r.endAt)),nextDay=date<localDay(at),ready=ended&&nextDay;
 const message=ready?"排班已结束，可确认前一天考勤。":!ended?"当天排班尚未全部结束，结束后于次日确认考勤。":"当天排班已结束，请于次日确认考勤。";
 return {kind,label,releases,units,limits,ready,message};
}
function shiftState(d,team,date,shiftName,at=Date.now()){
 const schedule=scheduleFor(d,team,date,at),release=schedule.releases.find(r=>r.shiftName===shiftName)||null;
 if(!release)return {ready:false,phase:"missing",release:null,message:schedule.message};
 if(schedule.kind==="invalid")return {ready:false,phase:"invalid",release,message:schedule.message};
 const phase=at<Date.parse(release.startAt)?"scheduled":at<Date.parse(release.endAt)?"running":schedule.ready?"ended":"awaitingConfirmationDay";
 return {ready:schedule.ready,phase,release,message:schedule.message};
}
function assertDecision(d,personId,date,team,next,previous={}){
 const states=[shiftState(d,team,date,"白班"),shiftState(d,team,date,"夜班")];
 if(!states.some(s=>s.ready))throw Error("当天排班尚未全部结束、未到次日或未发布，不能提前确认考勤");
 for(const [i,key] of ["dayUnits","nightUnits"].entries()){
  const name=i===0?"白班":"夜班";
  if(!states[i].ready&&next[key]!==((previous||{})[key]??null))throw Error(name+"排班未结束或未到次日，不能提前确认考勤");
  const max=scheduleFor(d,team,date).limits[name];if(states[i].ready&&next[key]!=null&&next[key]>max)throw Error(name+"按本日排班上满最多记"+max+"个考勤");
 }
}
// Transport evidence is per person and phase; only completed real trips count.
function tripEvidence(d,entry){
 if(!["driver","excavator"].includes(entry.kind))return {required:false,count:0};
 const start=Date.parse(entry.startAt),end=Date.parse(entry.endAt),unique=new Map();
 for(const t of d.trips||[]){
  if(!t.id||t.status!=="completed"||t.mode!=="gps"||t.workDate!==entry.workDate||t.shiftName!==entry.shiftName)continue;
  const at=Date.parse(entry.kind==="driver"?t.completedAt:t.loadedAt);
  if(!Number.isFinite(at)||at<start||at>end)continue;
  const own=entry.kind==="driver"?t.personId===entry.personId:t.excavatorId===entry.vehicleId&&window.MineTaskBoard?.excavatorOperator(d,t)===entry.personId;
  if(own)unique.set(t.id,t);
 }
 return {required:true,count:unique.size};
}
function build(d,m,startDate,endDate,at=Date.now(),team=""){
 if(!validDate(startDate)||!validDate(endDate)||startDate>endDate)throw Error("请选择有效的考勤日期");
 const people=new Map(),cells=new Map(),latest=new Map();
 const active=p=>window.MineLogistics?window.MineLogistics.active(p):["在岗","已通过"].includes(p.status);
 const addPerson=(p,prefer=false)=>{if(p?.id&&(prefer||!people.has(p.id)))people.set(p.id,{id:p.id,name:p.name||p.id,team:p.team||""});};
 for(const p of m.people||[])if(TEAMS.includes(p.team)&&(!team||p.team===team)&&active(p))addPerson(p);
 const getCell=(p,date)=>{const key=JSON.stringify([p.id,date]);if(!cells.has(key))cells.set(key,{personId:p.id,workDate:date,name:p.name,team:p.team,entries:[],manual:null,dayReady:shiftState(d,p.team,date,"白班",at).ready,nightReady:shiftState(d,p.team,date,"夜班",at).ready,maxDay:scheduleFor(d,p.team,date,at).limits["白班"],maxNight:scheduleFor(d,p.team,date,at).limits["夜班"],units:0,plannedUnits:0,running:0,scheduled:0,issues:0,source:"none"});return cells.get(key);};
 for(const r of d.taskReleases||[]){
  if(r.status!=="published"||!TEAMS.includes(r.team)||(team&&r.team!==team)||!validDate(r.workDate)||r.workDate<startDate||r.workDate>endDate)continue;
  const key=JSON.stringify([r.workDate,r.shiftName,r.team]),old=latest.get(key);
  if(!old||Number(r.version||1)>Number(old.version||1)||(Number(r.version||1)===Number(old.version||1)&&String(r.publishedAt||"")>String(old.publishedAt||"")))latest.set(key,r);
 }
 const releases=[...latest.values()].sort((a,b)=>a.workDate.localeCompare(b.workDate)||a.team.localeCompare(b.team,"zh-CN")||String(a.startAt).localeCompare(String(b.startAt)));
 for(const r of releases){
  if(!shiftState(d,r.team,r.workDate,r.shiftName,at).ready)continue;
  const seen=new Map();
  for(const task of r.tasks||[]){
   if(!task.personId)continue;
   const profile=(m.people||[]).find(p=>p.id===task.personId),p={id:task.personId,name:task.personName||profile?.name||task.personId,team:r.team};
   addPerson(p,true);const cell=getCell(p,r.workDate),start=Date.parse(r.startAt),end=Date.parse(r.endAt),hours=(end-start)/3600000;
   if(seen.has(p.id)){seen.get(p.id).conflict=true;continue;}
   const entry={id:task.id||r.id+":"+p.id,releaseId:r.id,personId:p.id,personName:p.name,team:r.team,workDate:r.workDate,shiftName:r.shiftName,kind:task.kind||task.role||"auxiliary",vehicleCode:task.vehicleCode||"",vehicleId:task.vehicleId||"",content:task.content||"",groupNumber:task.groupNumber,startAt:r.startAt,endAt:r.endAt,hours,expectedUnits:scheduleFor(d,r.team,r.workDate,at).units[r.shiftName]??unitsFor(hours),phase:!Number.isFinite(start)||!Number.isFinite(end)||end<=start?"invalid":at<start?"scheduled":at<end?"running":"ended",version:r.version||1,conflict:false};
   const evidence=tripEvidence(d,entry);entry.requiresTrips=evidence.required;entry.tripCount=evidence.count;entry.tripAnomaly=evidence.required&&evidence.count===0;
   seen.set(p.id,entry);cell.entries.push(entry);cell.source="tasks";
  }
 }
 for(const record of (d.attendanceRecords||[]).slice().sort((a,b)=>String(a.updatedAt||a.createdAt||"").localeCompare(String(b.updatedAt||b.createdAt||"")))){
  if(record.workDate<startDate||record.workDate>endDate||!validDate(record.workDate))continue;
  const p=(m.people||[]).find(p=>p.id===record.personId),recordTeam=record.team||p?.team||"";if(!TEAMS.includes(recordTeam)||(team&&recordTeam!==team))continue;
  const person={id:record.personId,name:record.personName||p?.name||record.personId,team:recordTeam};
  const dayReady=shiftState(d,recordTeam,record.workDate,"白班",at).ready,nightReady=shiftState(d,recordTeam,record.workDate,"夜班",at).ready;
  const today=new Date(at).toLocaleDateString("sv-SE",{timeZone:"Asia/Ulaanbaatar"}),legacy=!record.attendanceDecision&&record.workDate<today;
  const unscheduled=scheduleFor(d,recordTeam,record.workDate,at).kind==="none"&&record.workDate<today;
  if(!dayReady&&!nightReady&&!legacy&&!(unscheduled&&record.unscheduledDecision))continue;
  addPerson(person);const cell=getCell(person,record.workDate);cell.manual=record;if(legacy)cell.dayReady=true;
  if(unscheduled){const state=unscheduledState(d,record.personId,recordTeam,record.workDate,at);cell.unscheduled=true;cell.leaveBlocked=!state.ready||state.onLeave;cell.unscheduledReady=state.ready;}
 }
 for(const cell of cells.values()){
  for(let i=0;i<cell.entries.length;i++)for(let j=i+1;j<cell.entries.length;j++){
   const a=cell.entries[i],b=cell.entries[j];if(Date.parse(a.startAt)<Date.parse(b.endAt)&&Date.parse(b.startAt)<Date.parse(a.endAt)){a.conflict=true;b.conflict=true;}
  }
  for(const entry of cell.entries){
   if(entry.phase==="invalid"||entry.conflict){cell.issues++;entry.units=0;continue;}
   entry.units=entry.phase==="ended"&&!entry.tripAnomaly?entry.expectedUnits:0;cell.units+=entry.units;
   if(entry.phase==="running")cell.running++;if(entry.phase==="scheduled")cell.scheduled++;
   if(entry.phase!=="ended")cell.plannedUnits+=entry.expectedUnits;
  }
  Object.assign(cell,resolveUnits(cell));
 }
 return {people:[...people.values()].sort((a,b)=>a.team.localeCompare(b.team,"zh-CN")||a.name.localeCompare(b.name,"zh-CN")||a.id.localeCompare(b.id)),cells,releases,startDate,endDate,at};
}
function resolveUnits(cell,decision=cell?.manual?.attendanceDecision){
 if(cell?.unscheduled){const decision=cell.manual?.unscheduledDecision,units=cell.leaveBlocked?0:decision?(decision.units===1&&String(decision.note||"").trim()?1:0):cell.manual?.status==="出勤"?1:0;return {dayUnits:units,nightUnits:0,units,autoDay:0,autoNight:0,confirmed:!!decision,dayConfirmed:!!decision,nightConfirmed:false,source:"unscheduled",issues:0,running:0,scheduled:0};}
 const entries=cell?.entries||[],hasDay=cell?.dayReady!==false&&[0,0.5,1].includes(decision?.dayUnits),hasNight=cell?.nightReady!==false&&[0,0.5,1].includes(decision?.nightUnits),confirmed=hasDay||hasNight;
 let autoDay=entries.filter(e=>e.shiftName==="白班").reduce((n,e)=>n+(e.units||0),0),autoNight=entries.filter(e=>e.shiftName==="夜班").reduce((n,e)=>n+(e.units||0),0);
 if(!entries.length&&!confirmed&&cell?.dayReady!==false&&cell?.manual?.status==="出勤")autoDay=Math.min(1,cell?.maxDay??1);
 const dayUnits=hasDay?Math.min(decision.dayUnits,cell?.maxDay??1):autoDay,nightUnits=hasNight?Math.min(decision.nightUnits,cell?.maxNight??1):autoNight;
 const unresolved=e=>!(e.shiftName==="白班"?hasDay:e.shiftName==="夜班"?hasNight:false);
 return {dayUnits,nightUnits,units:dayUnits+nightUnits,autoDay,autoNight,confirmed,dayConfirmed:hasDay,nightConfirmed:hasNight,source:confirmed?"confirmed":entries.length?"tasks":cell?.manual?"manual":"none",issues:entries.filter(e=>(e.conflict||e.phase==="invalid"||e.tripAnomaly)&&unresolved(e)).length,running:entries.filter(e=>e.phase==="running"&&unresolved(e)).length,scheduled:entries.filter(e=>e.phase==="scheduled"&&unresolved(e)).length};
}
function sourceStamp(d,id,date){const team=window.MineLogistics?.main().people.find(p=>p.id===id)?.team||(d.attendanceRecords||[]).find(r=>r.personId===id&&r.workDate===date)?.team;return JSON.stringify([window.MineLeave?.stamp?.()||"leave-unavailable",(d.trips||[]).filter(t=>t.workDate===date).map(t=>[t.id,t.status,t.mode,t.personId,t.excavatorId,t.shiftName,t.loadedAt,t.completedAt,t.releaseId]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),(d.shifts||[]).filter(s=>s.kind==="excavator"&&s.workDate===date).map(s=>[s.id,s.personId,s.vehicleId,s.shiftName,s.startedWorkAt,s.closedAt]),(d.taskReleases||[]).filter(r=>r.status==="published"&&r.workDate===date&&(!team||r.team===team)).map(r=>[r.id,r.team,r.shiftName,r.version,r.startAt,r.endAt,shiftState(d,r.team,date,r.shiftName).phase,(r.tasks||[]).map(t=>[t.id,t.personId,t.groupNumber,t.vehicleCode,t.vehicleId,t.kind]),(r.groups||[]).map(g=>[g.excavatorId,g.excavatorDriverId])]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);}
const cellAt=(model,id,date)=>model.cells.get(JSON.stringify([id,date]));
const rule='<p class="att2-rule">选择日期、班组后按当天已发布排班记录自动带出班次，不比较前后两天的班别。第二天确认前一天：上午半班加傍晚至次晨夜班为白班转夜班，上满合计1.5个考勤（白0.5＋夜1）；只有下午半班为夜班转白班，上满0.5个考勤。普通白/夜班沿用排班时长计算；未排班在次日由调度判断，下雨、检查等非司机原因可记1个考勤并填写原因，请假不记。当天所有排班结束且进入次日后才生成并开放确认，跨午夜夜班仍归开始日；汽车/挖机司机在本班时间段内有已完成真实车数才默认计考勤并显示✓，无车数标异常待核对，默认不计；调度可根据下雨、检查等情况人工确认，辅助及未分任务人员仍由调度判断，日月汇总同源，历史记录保留。</p>';
function tabs(mode){return '<div class="actions att2-tabs"><button type="button" class="'+(mode==="daily"?"":"soft")+'" data-view="attendanceDaily">按日考勤</button><button type="button" class="'+(mode==="monthly"?"":"soft")+'" data-view="attendance">汇总考勤表</button></div>';}
function teamSelect(team,all=true){return '<label>班组<select name="att2Team"><option value="">'+(all?'全部生产班组':'请选择班组')+'</option>'+TEAMS.map(t=>'<option'+(team===t?' selected':"")+'>'+esc(t)+'</option>').join("")+'</select></label>';}
function daily(d,m,filters,today){
 const date=filters.date||addDays(today,-1),team=filters.team||"",schedule=scheduleFor(d,team,date),shifts=schedule.releases.map(r=>r.shiftName),shift=shifts.length===2?"全部班次":shifts[0]||"",model=build(d,m,date,date,Date.now(),team),selected=model.people.filter(p=>!team||p.team===team),cells=selected.map(p=>cellAt(model,p.id,date)).filter(Boolean),entries=cells.flatMap(c=>c.entries);
 const controls='<div class="att2-filters"><label>考勤日期<input type="date" name="att2Date" value="'+esc(date)+'"></label>'+teamSelect(team,false)+'<label class="att2-auto-shift">班次（根据排班自动带出）<input type="text" name="att3AutoShift" readonly value="'+esc(schedule.label)+'" title="'+esc(schedule.label)+'"></label></div>';
 if(team&&schedule.kind==="none"){
  const cards=selected.map(p=>{const state=unscheduledState(d,p.id,team,date),c=cellAt(model,p.id,date),decision=c?.manual?.unscheduledDecision,status=state.error?state.error:!state.ready?"次日开始确认":state.onLeave?"请假 · 不记考勤":decision?(decision.units?"已确认正常考勤":"已确认不记考勤"):"待调度判断";return '<button type="button" class="att3-person-card '+(decision?(c?.units>0?"confirmed-present":"confirmed-zero"):"unconfirmed")+'" data-action="att3Unscheduled" data-id="'+esc(p.id+"|"+date)+'" '+(!state.ready?'disabled':'')+'><strong>'+esc(p.name)+'</strong><span>未排班</span><b>'+fmt(c?.units)+'个考勤</b><small>'+esc(status)+'</small><small>'+esc(decision?.note?String(decision.note).slice(0,32):c?.manual?.status?"原人工记录（保留）":"点击判断 / 留原因")+'</small></button>';}).join("");
  return tabs("daily")+controls+'<section class="panel att3-scene"><h2>未排班人员 · '+esc(team)+'</h2><p class="help">下雨、检查等非司机原因，可正常记1个考勤并留原因；未判断不自动计入。当日有已批准请假不记考勤，未销假持续按请假处理。</p><div class="att3-card-list">'+(cards||'<p>暂无在岗人员。</p>')+'</div></section>'+rule;
 }
 if(!team||!shifts.length||schedule.kind==="invalid")return tabs("daily")+controls+'<section class="panel"><p class="muted">'+esc(schedule.message)+'</p></section>'+rule;

 const generated=selected.filter(p=>(shift==="全部班次"?["白班","夜班"]:[shift]).some(name=>shiftState(d,p.team,date,name).ready));
 const total=cells.reduce((n,c)=>n+c.units,0),strip='<div class="attendance-strip"><span>人员 <b>'+generated.length+'</b> 人</span><span>当日合计 <b>'+fmt(total)+'</b> 班</span><span>调度已确认 <b>'+cells.filter(c=>c.confirmed).length+'</b> 人</span><span>待核对 <b>'+cells.reduce((n,c)=>n+c.issues,0)+'</b> 项</span></div>';
 const profile=id=>(m.people||[]).find(p=>p.id===id);
 const roleName=p=>({"driver":"汽车司机","excavator":"挖机司机"}[profile(p.id)?.applicationRole]||profile(p.id)?.role||"人员");
 function card(p,entry,shiftName){
  const c=cellAt(model,p.id,date),isDay=shiftName==="白班",units=c?.[isDay?"dayUnits":"nightUnits"]||0,confirmed=!!c?.[isDay?"dayConfirmed":"nightConfirmed"];
  const status=entry?.tripAnomaly?(confirmed?"":"无车数，待核对"):confirmed?"调度已确认":entry?.requiresTrips?"✓ 本时段"+entry.tripCount+"车":entry?(entry.conflict||entry.phase==="invalid"?"任务待核对":entry.phase==="ended"?"按任务计算":entry.phase==="running"?"任务进行中":"任务待开始"):c?.source==="manual"?"原人工记录":"待调度判断";
  return '<button type="button" class="att3-person-card '+(entry?.tripAnomaly?"att3-trip-anomaly":entry?.requiresTrips&&units>0?"att3-trip-present":confirmed?(units>0?"confirmed-present":"confirmed-zero"):"unconfirmed")+'" data-action="att3Confirm" data-id="'+esc(p.id+"|"+date+"|"+shiftName)+'">'+(entry?'<strong>'+esc(entry.vehicleCode||(["driver","excavator"].includes(entry.kind)?"未绑定设备":"辅助作业"))+'</strong><span class="att3-person-name">'+esc(p.name)+'</span>':'<strong>'+esc(p.name)+'</strong><span>'+esc(roleName(p))+'</span>')+'<b>'+esc(entry?.tripAnomaly?'异常 · '+shiftName:(entry?.requiresTrips&&units>0?'✓ ':'')+shiftName+' · '+fmt(units)+'个')+'</b>'+(status?'<small>'+esc(status)+'</small>':"")+(entry?'<small>'+esc(time(entry.startAt)+" — "+time(entry.endAt))+'</small>':"")+'<small>点击确认 / 调整</small></button>';
 }
 const teams=[team];
 const scenes=teams.flatMap(t=>shifts.map(shiftName=>{
  const state=shiftState(d,t,date,shiftName),release=state.release;
  if(!state.ready)return '<section class="panel att3-waiting"><header class="att2-board-head"><h2>'+esc(date+" · "+t+" · "+shiftName)+'</h2></header><p class="muted">'+esc(state.message)+(release?" 本班结束："+esc(time(release.endAt)):"")+'</p></section>';
  const own=entries.filter(e=>e.team===t&&e.shiftName===shiftName),assigned=new Set(own.map(e=>e.personId)),candidates=selected.filter(p=>p.team===t),groups=new Map();
  for(const e of own.filter(e=>["driver","excavator"].includes(e.kind))){const number=e.groupNumber||"未分组";if(!groups.has(number))groups.set(number,[]);groups.get(number).push(e);}
  const row=(label,body,kind="")=>'<div class="att3-scene-row '+kind+'"><h3>'+esc(label)+'</h3><div class="att3-row-body">'+body+'</div></div>';
  const cards=rows=>'<div class="att3-card-list">'+rows.map(e=>card({id:e.personId,name:e.personName,team:e.team},e,shiftName)).join("")+'</div>';
  const production=[...groups.entries()].sort((a,b)=>Number(a[0])-Number(b[0])).map(([number,rows])=>row(number==="未分组"?"未分组任务":"第"+number+"组",cards(rows.sort((a,b)=>(a.kind==="excavator"?0:1)-(b.kind==="excavator"?0:1))))).join("")||row("生产设备组",'<p class="muted">本班暂无已发布的挖机、汽车任务。</p>');
  const auxiliary=own.filter(e=>!["driver","excavator"].includes(e.kind)),unassigned=candidates.filter(p=>!assigned.has(p.id));
  return '<section class="panel att3-scene"><header class="att2-board-head"><h2>'+esc(date+" · "+t+" · "+shiftName)+'</h2><span>'+esc(release?time(release.startAt)+" — "+time(release.endAt):"本班尚无已发布任务")+'</span></header>'+production+row("辅助人员",auxiliary.length?cards(auxiliary):'<p class="muted">本班暂无已发布的辅助任务。</p>',"att3-aux-row")+row("未进入分配的人员",'<p class="help">没有分配本班任务，也可以由调度确认考勤。</p><div class="att3-card-list">'+(unassigned.map(p=>card(p,null,shiftName)).join("")||'<p class="muted">暂无未分配人员。</p>')+'</div>',"att3-unassigned-row")+'</section>';
 })).join("");
 const peopleTable='<details class="panel att3-total-details"><summary>当日人员合计（'+generated.length+'人）</summary><div class="table-wrap"><table class="att2-day-totals"><thead><tr><th>姓名</th><th>班组</th><th>白班</th><th>夜班</th><th>当日合计（班）</th><th>来源</th></tr></thead><tbody>'+generated.map(p=>{
  const c=cellAt(model,p.id,date),status=!c?"未登记":c.confirmed?"调度确认":c.source==="manual"?"原人工记录":c.issues?"异常待核对":c.running?"进行中，结束后补计":"按任务计算";
  return '<tr><td><button type="button" class="soft" data-action="att3Confirm" data-id="'+esc(p.id+"|"+date+"|"+(shift==="夜班"||!shiftState(d,p.team,date,"白班").ready?"夜班":"白班"))+'">'+esc(p.name)+'</button></td><td>'+esc(p.team)+'</td><td>'+fmt(c?.dayUnits)+'</td><td>'+fmt(c?.nightUnits)+'</td><td><strong>'+fmt(c?.units)+'</strong></td><td>'+esc(status)+'</td></tr>';
 }).join("")+'</tbody><tfoot><tr><th colspan="4">当日合计</th><th>'+fmt(total)+'</th><th>确认后同步汇总</th></tr></tfoot></table></div></details>';
 return tabs("daily")+controls+(generated.length?strip:"")+scenes+(generated.length?peopleTable:"")+rule+'<p class="help">第二天按前一天的实际排班时段确认；白班转夜班须等夜班次晨结束，两个时段一起开放。调度确认优先于排班默认计算，白0.5＋夜1＝1.5个考勤。点击卡片可将未上班人员设为0，也可为未分任务人员补记考勤；恢复“跟随任务 / 原规则”会保留调整历史。</p>';
}
function monthly(d,m,filters,today){
 const month=filters.month||today.slice(0,7),team=filters.team||"",range=monthRange(month),model=build(d,m,range.startDate,range.endDate,Date.now(),team),people=model.people.filter(p=>!team||p.team===team),count=Number(range.endDate.slice(8)),days=Array.from({length:count},(_,i)=>addDays(range.startDate,i)),total=people.reduce((sum,p)=>sum+days.reduce((n,day)=>n+(cellAt(model,p.id,day)?.units||0),0),0);
 const rows=people.map(p=>{
  const own=days.map(day=>cellAt(model,p.id,day)),sum=own.reduce((n,c)=>n+(c?.units||0),0);
  return '<tr><th class="att2-sticky-name">'+esc(p.name)+'<small>'+esc(p.team)+'</small></th>'+days.map((day,i)=>{const c=own[i],state=c?.unscheduled&&c.leaveBlocked?"请假 / 不计":c?.issues?"异常 / "+fmt(c.units):!c?"—":c.issues?"待核对":c.running?fmt(c.units)+" / 进行中":c.scheduled?fmt(c.units)+" / 待开始":c.source==="manual"&&c.manual.status!=="出勤"?(c.manual.status||"—"):fmt(c.units);return '<td><button title="'+esc(c?.issues?"无车数或任务异常，待调度核对":c?.unscheduled?(c.leaveBlocked?"当日请假，不记考勤":c.manual?.unscheduledDecision?.note||"未排班待判断"):c?.confirmed?"调度确认":c?.source==="manual"?"原人工记录":"按任务计算")+'" type="button" class="att2-month-cell'+(c?.units?" has-units":"")+'" data-action="att2MonthDay" data-id="'+esc(day+"|"+p.team)+'" aria-label="'+esc(p.name+" "+day+" "+state+"，查看按日考勤")+'">'+esc(state)+'</button></td>';}).join("")+'<td class="att2-sticky-total"><strong>'+fmt(sum)+'</strong></td></tr>';
 }).join("");
 return tabs("monthly")+'<div class="att2-filters"><label>统计月份<input type="month" name="att2Month" value="'+esc(month)+'"></label>'+teamSelect(team)+'</div><div class="attendance-strip"><span>人员 <b>'+people.length+'</b> 人</span><span>本月已计考勤 <b>'+fmt(total)+'</b> 班</span><span>由按日考勤自动汇总</span></div><section class="panel"><div class="table-wrap att2-month-wrap"><table class="att2-month-table" aria-label="按月考勤汇总表"><thead><tr><th class="att2-sticky-name">姓名 / 班组</th>'+days.map(day=>'<th>'+esc(day.slice(5).replace("-","/"))+'</th>').join("")+'<th class="att2-sticky-total">合计（班）</th></tr></thead><tbody>'+rows+'</tbody><tfoot><tr><th class="att2-sticky-name">每日合计</th>'+days.map(day=>'<td>'+fmt(people.reduce((n,p)=>n+(cellAt(model,p.id,day)?.units||0),0))+'</td>').join("")+'<th class="att2-sticky-total">'+fmt(total)+'</th></tr></tfoot></table></div></section>'+rule+'<p class="help">点击日期格跳转当日任务式考勤面板。每日及月合计均以“班”为单位，不将1.5班截成1天；进行中、待开始和时段冲突尚未计入。调度确认优先，原人工记录在无任务日补充，未来无记录显示“—”。</p>';
}
function details(d,m,id,date){
 const model=build(d,m,date,date),p=model.people.find(p=>p.id===id),c=cellAt(model,id,date);
 if(!p)throw Error("人员记录不存在，请刷新后重试");
 const rows=c?.entries||[],legacy=c?.manual;
 return '<h3>'+esc(p.name+" · "+p.team+" · "+date)+'</h3><p>当日已计 <strong>'+fmt(c?.units)+' 班</strong></p>'+rows.map(e=>'<section class="att2-detail"><h3>'+esc(e.shiftName+" · "+(e.vehicleCode||"人员任务"))+'</h3><p>任务开始：'+esc(time(e.startAt))+'</p><p>任务结束：'+esc(time(e.endAt))+'</p><p>时长 '+fmt(e.hours)+' 小时；默认考勤 '+fmt(e.units)+' 个；'+(e.requiresTrips?esc("本时段"+e.tripCount+"车；"+(e.tripAnomaly?"异常，无车数待核对":"✓ 有考勤")):"")+'；'+esc(e.conflict?"时段重叠，暂不计":e.phase==="ended"?"已结束":e.phase==="running"?"进行中":"待开始")+'</p><small>来源：任务版本 '+esc(e.version)+' · '+esc(e.releaseId)+'</small></section>').join("")+(!rows.length?'<p>当天没有已发布人员任务。</p>':"")+(legacy?.attendanceDecision?'<section class="att2-detail"><h3>调度确认</h3><p>白班 '+esc(legacy.attendanceDecision.dayUnits==null?"跟随任务 / 原规则":fmt(legacy.attendanceDecision.dayUnits)+"班")+'；夜班 '+esc(legacy.attendanceDecision.nightUnits==null?"跟随任务 / 原规则":fmt(legacy.attendanceDecision.nightUnits)+"班")+'</p><p>'+esc(legacy.attendanceDecision.note||"无备注")+'</p><small>'+esc(time(legacy.attendanceDecision.at)+" · "+(legacy.attendanceDecision.name||"调度"))+'</small></section>':"")+(legacy&&(legacy.status||legacy.note)?'<section class="att2-detail"><h3>原人工记录（保留）</h3><p>'+esc(legacy.status||"未登记")+' · '+esc(legacy.note||"无备注")+'</p><small>'+esc(c.confirmed?"已由调度确认，原记录不重复累加。":rows.length?"同日已有任务，本条不重复累加。":"无任务，人工出勤按1班补充。")+'</small></section>':"")+'<button type="button" class="soft" data-action="att3Confirm" data-id="'+esc(id+"|"+date+"|白班")+'">确认 / 调整考勤</button> <button type="button" class="soft" data-action="attendanceDay" data-id="'+esc(id+"|"+date)+'">查看 / 登记原人工考勤</button>'+rule;
}
window.MineAttendanceBoard=Object.freeze({STANDARD_HOURS,unitsFor,monthRange,addDays,build,cellAt,resolveUnits,shiftState,scheduleFor,tripEvidence,unscheduledState,assertUnscheduled,leaveOnDay,assertDecision,sourceStamp,daily,monthly,details});
})();