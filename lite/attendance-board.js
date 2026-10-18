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
function build(d,m,startDate,endDate,at=Date.now(),team=""){
 if(!validDate(startDate)||!validDate(endDate)||startDate>endDate)throw Error("请选择有效的考勤日期");
 const people=new Map(),cells=new Map(),latest=new Map();
 const active=p=>window.MineLogistics?window.MineLogistics.active(p):["在岗","已通过"].includes(p.status);
 const addPerson=(p,prefer=false)=>{if(p?.id&&(prefer||!people.has(p.id)))people.set(p.id,{id:p.id,name:p.name||p.id,team:p.team||""});};
 for(const p of m.people||[])if(TEAMS.includes(p.team)&&(!team||p.team===team)&&active(p))addPerson(p);
 const getCell=(p,date)=>{const key=JSON.stringify([p.id,date]);if(!cells.has(key))cells.set(key,{personId:p.id,workDate:date,name:p.name,team:p.team,entries:[],manual:null,units:0,plannedUnits:0,running:0,scheduled:0,issues:0,source:"none"});return cells.get(key);};
 for(const r of d.taskReleases||[]){
  if(r.status!=="published"||!TEAMS.includes(r.team)||(team&&r.team!==team)||!validDate(r.workDate)||r.workDate<startDate||r.workDate>endDate)continue;
  const key=JSON.stringify([r.workDate,r.shiftName,r.team]),old=latest.get(key);
  if(!old||Number(r.version||1)>Number(old.version||1)||(Number(r.version||1)===Number(old.version||1)&&String(r.publishedAt||"")>String(old.publishedAt||"")))latest.set(key,r);
 }
 const releases=[...latest.values()].sort((a,b)=>a.workDate.localeCompare(b.workDate)||a.team.localeCompare(b.team,"zh-CN")||String(a.startAt).localeCompare(String(b.startAt)));
 for(const r of releases){
  const seen=new Map();
  for(const task of r.tasks||[]){
   if(!task.personId)continue;
   const profile=(m.people||[]).find(p=>p.id===task.personId),p={id:task.personId,name:task.personName||profile?.name||task.personId,team:r.team};
   addPerson(p,true);const cell=getCell(p,r.workDate),start=Date.parse(r.startAt),end=Date.parse(r.endAt),hours=(end-start)/3600000;
   if(seen.has(p.id)){seen.get(p.id).conflict=true;continue;}
   const entry={id:task.id||r.id+":"+p.id,releaseId:r.id,personId:p.id,personName:p.name,team:r.team,workDate:r.workDate,shiftName:r.shiftName,kind:task.kind||task.role||"auxiliary",vehicleCode:task.vehicleCode||"",content:task.content||"",groupNumber:task.groupNumber,startAt:r.startAt,endAt:r.endAt,hours,expectedUnits:unitsFor(hours),phase:!Number.isFinite(start)||!Number.isFinite(end)||end<=start?"invalid":at<start?"scheduled":at<end?"running":"ended",version:r.version||1,conflict:false};
   seen.set(p.id,entry);cell.entries.push(entry);cell.source="tasks";
  }
 }
 for(const record of (d.attendanceRecords||[]).slice().sort((a,b)=>String(a.updatedAt||a.createdAt||"").localeCompare(String(b.updatedAt||b.createdAt||"")))){
  if(record.workDate<startDate||record.workDate>endDate||!validDate(record.workDate))continue;
  const p=(m.people||[]).find(p=>p.id===record.personId),recordTeam=record.team||p?.team||"";if(!TEAMS.includes(recordTeam)||(team&&recordTeam!==team))continue;
  const person={id:record.personId,name:record.personName||p?.name||record.personId,team:recordTeam};addPerson(person);getCell(person,record.workDate).manual=record;
 }
 for(const cell of cells.values()){
  for(let i=0;i<cell.entries.length;i++)for(let j=i+1;j<cell.entries.length;j++){
   const a=cell.entries[i],b=cell.entries[j];if(Date.parse(a.startAt)<Date.parse(b.endAt)&&Date.parse(b.startAt)<Date.parse(a.endAt)){a.conflict=true;b.conflict=true;}
  }
  for(const entry of cell.entries){
   if(entry.phase==="invalid"||entry.conflict){cell.issues++;entry.units=0;continue;}
   entry.units=entry.phase==="ended"?entry.expectedUnits:0;cell.units+=entry.units;
   if(entry.phase==="running")cell.running++;if(entry.phase==="scheduled")cell.scheduled++;
   if(entry.phase!=="ended")cell.plannedUnits+=entry.expectedUnits;
  }
  Object.assign(cell,resolveUnits(cell));
 }
 return {people:[...people.values()].sort((a,b)=>a.team.localeCompare(b.team,"zh-CN")||a.name.localeCompare(b.name,"zh-CN")||a.id.localeCompare(b.id)),cells,releases,startDate,endDate,at};
}
function resolveUnits(cell,decision=cell?.manual?.attendanceDecision){
 const entries=cell?.entries||[],hasDay=[0,0.5,1].includes(decision?.dayUnits),hasNight=[0,0.5,1].includes(decision?.nightUnits),confirmed=hasDay||hasNight;
 let autoDay=entries.filter(e=>e.shiftName==="白班").reduce((n,e)=>n+(e.units||0),0),autoNight=entries.filter(e=>e.shiftName==="夜班").reduce((n,e)=>n+(e.units||0),0);
 if(!entries.length&&!confirmed&&cell?.manual?.status==="出勤")autoDay=1;
 const dayUnits=hasDay?decision.dayUnits:autoDay,nightUnits=hasNight?decision.nightUnits:autoNight;
 const unresolved=e=>!(e.shiftName==="白班"?hasDay:e.shiftName==="夜班"?hasNight:false);
 return {dayUnits,nightUnits,units:dayUnits+nightUnits,autoDay,autoNight,confirmed,dayConfirmed:hasDay,nightConfirmed:hasNight,source:confirmed?"confirmed":entries.length?"tasks":cell?.manual?"manual":"none",issues:entries.filter(e=>(e.conflict||e.phase==="invalid")&&unresolved(e)).length,running:entries.filter(e=>e.phase==="running"&&unresolved(e)).length,scheduled:entries.filter(e=>e.phase==="scheduled"&&unresolved(e)).length};
}
function sourceStamp(d,id,date){return JSON.stringify((d.taskReleases||[]).filter(r=>r.status==="published"&&r.workDate===date&&(r.tasks||[]).some(t=>t.personId===id)).map(r=>[r.id,r.version,r.startAt,r.endAt,Date.now()>=Date.parse(r.endAt)?"ended":Date.now()>=Date.parse(r.startAt)?"running":"scheduled",(r.tasks||[]).filter(t=>t.personId===id).map(t=>[t.id,t.groupNumber,t.vehicleCode])]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));}
const cellAt=(model,id,date)=>model.cells.get(JSON.stringify([id,date]));
const rule='<p class="att2-rule">可由调度按现场情况确认白、夜班考勤，未分任务人员同样可记。未作调度确认时，按任务看板已发布的开始、结束时间计算，暂按12小时为标准班：大于0且不超过6小时记0.5班，超过6小时记1班；零时长或无效时间不计。白、夜班分别累计，同日可为1.5班；跨午夜归开始日，任务时段结束后入账，进行中及待开始暂不计。单段超过12小时仍按1班并提示核对，后续按你的规则调整。</p>';
function tabs(mode){return '<div class="actions att2-tabs"><button type="button" class="'+(mode==="daily"?"":"soft")+'" data-view="attendanceDaily">按日考勤</button><button type="button" class="'+(mode==="monthly"?"":"soft")+'" data-view="attendance">汇总考勤表</button></div>';}
function teamSelect(team){return '<label>班组<select name="att2Team"><option value="">全部生产班组</option>'+TEAMS.map(t=>'<option'+(team===t?' selected':"")+'>'+esc(t)+'</option>').join("")+'</select></label>';}
function daily(d,m,filters,today){
 const date=filters.date||today,team=filters.team||"",shift=filters.shiftName||"白班",model=build(d,m,date,date,Date.now(),team),selected=model.people.filter(p=>!team||p.team===team),cells=selected.map(p=>cellAt(model,p.id,date)).filter(Boolean),entries=cells.flatMap(c=>c.entries);
 const controls='<div class="att2-filters"><label>考勤日期<input type="date" name="att2Date" value="'+esc(date)+'"></label>'+teamSelect(team)+'<label>班次<select name="att3Shift">'+["白班","夜班","全部班次"].map(v=>'<option'+(v===shift?' selected':"")+'>'+v+'</option>').join("")+'</select></label><div class="actions"><button type="button" class="soft" data-action="att2Previous">前一天</button><button type="button" class="soft" data-action="att2Today">今天</button><button type="button" class="soft" data-action="att2Next">后一天</button></div></div>';
 const total=cells.reduce((n,c)=>n+c.units,0),strip='<div class="attendance-strip"><span>人员 <b>'+selected.length+'</b> 人</span><span>当日合计 <b>'+fmt(total)+'</b> 班</span><span>调度已确认 <b>'+cells.filter(c=>c.confirmed).length+'</b> 人</span><span>待核对 <b>'+cells.reduce((n,c)=>n+c.issues,0)+'</b> 项</span></div>';
 const profile=id=>(m.people||[]).find(p=>p.id===id);
 const roleName=p=>({"driver":"汽车司机","excavator":"挖机司机"}[profile(p.id)?.applicationRole]||profile(p.id)?.role||"人员");
 function card(p,entry,shiftName){
  const c=cellAt(model,p.id,date),isDay=shiftName==="白班",units=c?.[isDay?"dayUnits":"nightUnits"]||0,confirmed=!!c?.[isDay?"dayConfirmed":"nightConfirmed"];
  const status=confirmed?"调度已确认":entry?(entry.conflict||entry.phase==="invalid"?"任务待核对":entry.phase==="ended"?"按任务计算":entry.phase==="running"?"任务进行中":"任务待开始"):c?.source==="manual"?"原人工记录":"待调度判断";
  return '<button type="button" class="att3-person-card '+(confirmed?(units>0?"confirmed-present":"confirmed-zero"):"unconfirmed")+'" data-action="att3Confirm" data-id="'+esc(p.id+"|"+date+"|"+shiftName)+'">'+(entry?'<strong>'+esc(entry.vehicleCode||(["driver","excavator"].includes(entry.kind)?"未绑定设备":"辅助作业"))+'</strong><span class="att3-person-name">'+esc(p.name)+'</span>':'<strong>'+esc(p.name)+'</strong><span>'+esc(roleName(p))+'</span>')+'<b>'+esc(shiftName)+' '+fmt(units)+'班</b><small>'+esc(status)+'</small>'+(entry?'<small>'+esc(time(entry.startAt)+" — "+time(entry.endAt))+'</small>':"")+'<small>点击确认 / 调整</small></button>';
 }
 const shifts=shift==="全部班次"?["白班","夜班"]:[shift],teams=team?[team]:TEAMS;
 const scenes=teams.flatMap(t=>shifts.map(shiftName=>{
  const release=model.releases.find(r=>r.team===t&&r.shiftName===shiftName),own=entries.filter(e=>e.team===t&&e.shiftName===shiftName),assigned=new Set(own.map(e=>e.personId)),candidates=selected.filter(p=>p.team===t),groups=new Map();
  for(const e of own.filter(e=>["driver","excavator"].includes(e.kind))){const number=e.groupNumber||"未分组";if(!groups.has(number))groups.set(number,[]);groups.get(number).push(e);}
  const row=(label,body,kind="")=>'<div class="att3-scene-row '+kind+'"><h3>'+esc(label)+'</h3><div class="att3-row-body">'+body+'</div></div>';
  const cards=rows=>'<div class="att3-card-list">'+rows.map(e=>card({id:e.personId,name:e.personName,team:e.team},e,shiftName)).join("")+'</div>';
  const production=[...groups.entries()].sort((a,b)=>Number(a[0])-Number(b[0])).map(([number,rows])=>row(number==="未分组"?"未分组任务":"第"+number+"组",cards(rows.sort((a,b)=>(a.kind==="excavator"?0:1)-(b.kind==="excavator"?0:1))))).join("")||row("生产设备组",'<p class="muted">本班暂无已发布的挖机、汽车任务。</p>');
  const auxiliary=own.filter(e=>!["driver","excavator"].includes(e.kind)),unassigned=candidates.filter(p=>!assigned.has(p.id));
  return '<section class="panel att3-scene"><header class="att2-board-head"><h2>'+esc(date+" · "+t+" · "+shiftName)+'</h2><span>'+esc(release?time(release.startAt)+" — "+time(release.endAt):"本班尚无已发布任务")+'</span></header>'+production+row("辅助人员",auxiliary.length?cards(auxiliary):'<p class="muted">本班暂无已发布的辅助任务。</p>',"att3-aux-row")+row("未进入分配的人员",'<p class="help">没有分配本班任务，也可以由调度确认考勤。</p><div class="att3-card-list">'+(unassigned.map(p=>card(p,null,shiftName)).join("")||'<p class="muted">暂无未分配人员。</p>')+'</div>',"att3-unassigned-row")+'</section>';
 })).join("");
 const peopleTable='<details class="panel att3-total-details"><summary>当日人员合计（'+selected.length+'人）</summary><div class="table-wrap"><table class="att2-day-totals"><thead><tr><th>姓名</th><th>班组</th><th>白班</th><th>夜班</th><th>当日合计（班）</th><th>来源</th></tr></thead><tbody>'+selected.map(p=>{
  const c=cellAt(model,p.id,date),status=!c?"未登记":c.confirmed?"调度确认":c.source==="manual"?"原人工记录":c.issues?"存在待核对任务":c.running?"进行中，结束后补计":"按任务计算";
  return '<tr><td><button type="button" class="soft" data-action="att3Confirm" data-id="'+esc(p.id+"|"+date+"|"+(shift==="夜班"?"夜班":"白班"))+'">'+esc(p.name)+'</button></td><td>'+esc(p.team)+'</td><td>'+fmt(c?.dayUnits)+'</td><td>'+fmt(c?.nightUnits)+'</td><td><strong>'+fmt(c?.units)+'</strong></td><td>'+esc(status)+'</td></tr>';
 }).join("")+'</tbody><tfoot><tr><th colspan="4">当日合计</th><th>'+fmt(total)+'</th><th>确认后同步汇总</th></tr></tfoot></table></div></details>';
 return tabs("daily")+controls+strip+scenes+peopleTable+rule+'<p class="help">调度确认优先于对应白班或夜班的自动计算，另一班仍可跟随任务。同一人白班0.5＋夜班1＝1.5班。点击卡片可将未上班人员设为0，也可为未分任务人员补记考勤；恢复“跟随任务 / 原规则”会保留调整历史。</p>';
}
function monthly(d,m,filters,today){
 const month=filters.month||today.slice(0,7),team=filters.team||"",range=monthRange(month),model=build(d,m,range.startDate,range.endDate,Date.now(),team),people=model.people.filter(p=>!team||p.team===team),count=Number(range.endDate.slice(8)),days=Array.from({length:count},(_,i)=>addDays(range.startDate,i)),total=people.reduce((sum,p)=>sum+days.reduce((n,day)=>n+(cellAt(model,p.id,day)?.units||0),0),0);
 const rows=people.map(p=>{
  const own=days.map(day=>cellAt(model,p.id,day)),sum=own.reduce((n,c)=>n+(c?.units||0),0);
  return '<tr><th class="att2-sticky-name">'+esc(p.name)+'<small>'+esc(p.team)+'</small></th>'+days.map((day,i)=>{const c=own[i],state=!c?"—":c.issues?"待核对":c.running?fmt(c.units)+" / 进行中":c.scheduled?fmt(c.units)+" / 待开始":c.source==="manual"&&c.manual.status!=="出勤"?(c.manual.status||"—"):fmt(c.units);return '<td><button title="'+esc(c?.confirmed?"调度确认":c?.source==="manual"?"原人工记录":"按任务计算")+'" type="button" class="att2-month-cell'+(c?.units?" has-units":"")+'" data-action="att2MonthDay" data-id="'+esc(day+"|"+p.team)+'" aria-label="'+esc(p.name+" "+day+" "+state+"，查看按日考勤")+'">'+esc(state)+'</button></td>';}).join("")+'<td class="att2-sticky-total"><strong>'+fmt(sum)+'</strong></td></tr>';
 }).join("");
 return tabs("monthly")+'<div class="att2-filters"><label>统计月份<input type="month" name="att2Month" value="'+esc(month)+'"></label>'+teamSelect(team)+'</div><div class="attendance-strip"><span>人员 <b>'+people.length+'</b> 人</span><span>本月已计考勤 <b>'+fmt(total)+'</b> 班</span><span>由按日考勤自动汇总</span></div><section class="panel"><div class="table-wrap att2-month-wrap"><table class="att2-month-table" aria-label="按月考勤汇总表"><thead><tr><th class="att2-sticky-name">姓名 / 班组</th>'+days.map(day=>'<th>'+esc(day.slice(5).replace("-","/"))+'</th>').join("")+'<th class="att2-sticky-total">合计（班）</th></tr></thead><tbody>'+rows+'</tbody><tfoot><tr><th class="att2-sticky-name">每日合计</th>'+days.map(day=>'<td>'+fmt(people.reduce((n,p)=>n+(cellAt(model,p.id,day)?.units||0),0))+'</td>').join("")+'<th class="att2-sticky-total">'+fmt(total)+'</th></tr></tfoot></table></div></section>'+rule+'<p class="help">点击日期格跳转当日任务式考勤面板。每日及月合计均以“班”为单位，不将1.5班截成1天；进行中、待开始和时段冲突尚未计入。调度确认优先，原人工记录在无任务日补充，未来无记录显示“—”。</p>';
}
function details(d,m,id,date){
 const model=build(d,m,date,date),p=model.people.find(p=>p.id===id),c=cellAt(model,id,date);
 if(!p)throw Error("人员记录不存在，请刷新后重试");
 const rows=c?.entries||[],legacy=c?.manual;
 return '<h3>'+esc(p.name+" · "+p.team+" · "+date)+'</h3><p>当日已计 <strong>'+fmt(c?.units)+' 班</strong></p>'+rows.map(e=>'<section class="att2-detail"><h3>'+esc(e.shiftName+" · "+(e.vehicleCode||"人员任务"))+'</h3><p>任务开始：'+esc(time(e.startAt))+'</p><p>任务结束：'+esc(time(e.endAt))+'</p><p>时长 '+fmt(e.hours)+' 小时；任务默认 '+fmt(e.units)+' 班；'+esc(e.conflict?"时段重叠，暂不计":e.phase==="ended"?"已结束":e.phase==="running"?"进行中":"待开始")+'</p><small>来源：任务版本 '+esc(e.version)+' · '+esc(e.releaseId)+'</small></section>').join("")+(!rows.length?'<p>当天没有已发布人员任务。</p>':"")+(legacy?.attendanceDecision?'<section class="att2-detail"><h3>调度确认</h3><p>白班 '+esc(legacy.attendanceDecision.dayUnits==null?"跟随任务 / 原规则":fmt(legacy.attendanceDecision.dayUnits)+"班")+'；夜班 '+esc(legacy.attendanceDecision.nightUnits==null?"跟随任务 / 原规则":fmt(legacy.attendanceDecision.nightUnits)+"班")+'</p><p>'+esc(legacy.attendanceDecision.note||"无备注")+'</p><small>'+esc(time(legacy.attendanceDecision.at)+" · "+(legacy.attendanceDecision.name||"调度"))+'</small></section>':"")+(legacy&&(legacy.status||legacy.note)?'<section class="att2-detail"><h3>原人工记录（保留）</h3><p>'+esc(legacy.status||"未登记")+' · '+esc(legacy.note||"无备注")+'</p><small>'+esc(c.confirmed?"已由调度确认，原记录不重复累加。":rows.length?"同日已有任务，本条不重复累加。":"无任务，人工出勤按1班补充。")+'</small></section>':"")+'<button type="button" class="soft" data-action="att3Confirm" data-id="'+esc(id+"|"+date+"|白班")+'">确认 / 调整考勤</button> <button type="button" class="soft" data-action="attendanceDay" data-id="'+esc(id+"|"+date)+'">查看 / 登记原人工考勤</button>'+rule;
}
window.MineAttendanceBoard=Object.freeze({STANDARD_HOURS,unitsFor,monthRange,addDays,build,cellAt,resolveUnits,sourceStamp,daily,monthly,details});
})();