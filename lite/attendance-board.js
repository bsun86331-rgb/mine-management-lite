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
  if(!cell.entries.length&&cell.manual){cell.source="manual";cell.units=cell.manual.status==="出勤"?1:0;}
 }
 return {people:[...people.values()].sort((a,b)=>a.team.localeCompare(b.team,"zh-CN")||a.name.localeCompare(b.name,"zh-CN")||a.id.localeCompare(b.id)),cells,releases,startDate,endDate,at};
}
const cellAt=(model,id,date)=>model.cells.get(JSON.stringify([id,date]));
const rule='<p class="att2-rule">本版按任务看板已发布的开始、结束时间计算，暂按12小时为标准班：大于0且不超过6小时记0.5班，超过6小时记1班；零时长或无效时间不计。白、夜班分别累计，同日可为1.5班；跨午夜归开始日，任务时段结束后入账，进行中及待开始暂不计。单段超过12小时仍按1班并提示核对，后续按你的规则调整。</p>';
function tabs(mode){return '<div class="actions att2-tabs"><button type="button" class="'+(mode==="daily"?"":"soft")+'" data-view="attendanceDaily">按日考勤</button><button type="button" class="'+(mode==="monthly"?"":"soft")+'" data-view="attendance">汇总考勤表</button></div>';}
function teamSelect(team){return '<label>班组<select name="att2Team"><option value="">全部生产班组</option>'+TEAMS.map(t=>'<option'+(team===t?' selected':"")+'>'+esc(t)+'</option>').join("")+'</select></label>';}
function daily(d,m,filters,today){
 const date=filters.date||today,team=filters.team||"",model=build(d,m,date,date,Date.now(),team),selected=model.people.filter(p=>!team||p.team===team),cells=selected.map(p=>cellAt(model,p.id,date)).filter(Boolean),entries=cells.flatMap(c=>c.entries),groups=new Map();
 for(const r of model.releases)if(!team||r.team===team)groups.set(JSON.stringify([r.team,r.shiftName]),{release:r,entries:[]});
 for(const e of entries){const key=JSON.stringify([e.team,e.shiftName]);if(!groups.has(key))groups.set(key,{release:null,entries:[]});groups.get(key).entries.push(e);}
 const controls='<div class="att2-filters"><label>考勤日期<input type="date" name="att2Date" value="'+esc(date)+'"></label>'+teamSelect(team)+'<div class="actions"><button type="button" class="soft" data-action="att2Previous">前一天</button><button type="button" class="soft" data-action="att2Today">今天</button><button type="button" class="soft" data-action="att2Next">后一天</button></div></div>';
 const total=cells.reduce((n,c)=>n+c.units,0),strip='<div class="attendance-strip"><span>人员 <b>'+selected.length+'</b> 人</span><span>已计考勤 <b>'+fmt(total)+'</b> 班</span><span>进行中 <b>'+entries.filter(e=>e.phase==="running").length+'</b> 项</span><span>待开始 <b>'+entries.filter(e=>e.phase==="scheduled").length+'</b> 项</span><span>待核对 <b>'+entries.filter(e=>e.phase==="invalid"||e.conflict||e.hours>STANDARD_HOURS).length+'</b> 项</span></div>';
 const boards=[...groups.values()].map(g=>'<section class="panel att2-board"><header class="att2-board-head"><h2>'+esc(date+" · "+g.release.team+" · "+g.release.shiftName)+'</h2><span>'+esc(time(g.release.startAt)+" — "+time(g.release.endAt))+'</span></header><div class="att2-cards">'+g.entries.map(e=>{
  const status=e.conflict?"时段重叠，待核对":e.phase==="invalid"?"时间无效，待核对":e.phase==="ended"?"已计入":e.phase==="running"?"进行中":"待开始",kind=e.kind==="excavator"?"挖机":e.kind==="driver"?"汽车":"辅助作业";
  return '<button type="button" class="att2-card '+esc(["driver","excavator"].includes(e.kind)?e.kind:"auxiliary")+'" data-action="att2Details" data-id="'+esc(e.personId+"|"+date)+'"><strong>'+esc(e.personName)+'</strong><span>'+esc(kind+(e.vehicleCode?" · "+e.vehicleCode:""))+'</span><small>开始 '+esc(time(e.startAt))+'</small><small>结束 '+esc(time(e.endAt))+'</small><span>时长 '+fmt(e.hours)+' 小时</span><b>'+fmt(e.units)+' 班</b><small>'+esc(status)+(e.phase!=="ended"&&!e.conflict&&e.phase!=="invalid"?" · 预计"+fmt(e.expectedUnits)+"班":"")+'</small>'+(e.hours>STANDARD_HOURS?'<small class="att2-warning">超过标准时长，暂按1班，待核对</small>':"")+'</button>';
 }).join("")+'</div>'+(g.entries.length?"":'<p class="muted">该班次没有人员任务</p>')+'</section>').join("");
 const peopleTable='<section class="panel"><h2>当日人员考勤合计</h2><div class="table-wrap"><table class="att2-day-totals"><thead><tr><th>姓名</th><th>班组</th><th>白班</th><th>夜班</th><th>当日合计（班）</th><th>状态 / 来源</th></tr></thead><tbody>'+selected.map(p=>{
  const c=cellAt(model,p.id,date),byShift=name=>c?.entries.filter(e=>e.shiftName===name).reduce((n,e)=>n+(e.units||0),0)||0;
  const status=!c?"无任务 / 未登记":c.source==="manual"?"原人工记录："+(c.manual.status||"未登记"):c.issues?"存在待核对任务":c.running?"进行中，结束后补计":c.scheduled?"有待开始任务":"任务时段已结束";
  return '<tr><td><button type="button" class="soft" data-action="att2Details" data-id="'+esc(p.id+"|"+date)+'">'+esc(p.name)+'</button></td><td>'+esc(p.team)+'</td><td>'+fmt(byShift("白班"))+'</td><td>'+fmt(byShift("夜班"))+'</td><td><strong>'+fmt(c?.units)+'</strong></td><td>'+esc(status)+'</td></tr>';
 }).join("")+'</tbody><tfoot><tr><th colspan="4">当日合计</th><th>'+fmt(total)+'</th><th>可累计0.5、1、1.5班</th></tr></tfoot></table></div></section>';
 return tabs("daily")+controls+strip+(boards||'<section class="panel"><h2>当日任务考勤</h2><p class="empty">所选日期及班组暂无已发布任务，尚不生成任务考勤。</p></section>')+peopleTable+rule+'<p class="help">同日有任务时按任务计算；无任务时原人工出勤记1班，其他人工状态记0班。旧记录不删除，点击姓名查看来源。本版不根据GPS车数、检查或请销假推断出勤，不把无任务人员记为缺勤。</p>';
}
function monthly(d,m,filters,today){
 const month=filters.month||today.slice(0,7),team=filters.team||"",range=monthRange(month),model=build(d,m,range.startDate,range.endDate,Date.now(),team),people=model.people.filter(p=>!team||p.team===team),count=Number(range.endDate.slice(8)),days=Array.from({length:count},(_,i)=>addDays(range.startDate,i)),total=people.reduce((sum,p)=>sum+days.reduce((n,day)=>n+(cellAt(model,p.id,day)?.units||0),0),0);
 const rows=people.map(p=>{
  const own=days.map(day=>cellAt(model,p.id,day)),sum=own.reduce((n,c)=>n+(c?.units||0),0);
  return '<tr><th class="att2-sticky-name">'+esc(p.name)+'<small>'+esc(p.team)+'</small></th>'+days.map((day,i)=>{const c=own[i],state=!c?"—":c.issues?"待核对":c.running?fmt(c.units)+" / 进行中":c.scheduled?fmt(c.units)+" / 待开始":c.source==="manual"&&c.manual.status!=="出勤"?(c.manual.status||"—"):fmt(c.units);return '<td><button type="button" class="att2-month-cell'+(c?.units?" has-units":"")+'" data-action="att2MonthDay" data-id="'+esc(day+"|"+p.team)+'" aria-label="'+esc(p.name+" "+day+" "+state+"，查看按日考勤")+'">'+esc(state)+'</button></td>';}).join("")+'<td class="att2-sticky-total"><strong>'+fmt(sum)+'</strong></td></tr>';
 }).join("");
 return tabs("monthly")+'<div class="att2-filters"><label>统计月份<input type="month" name="att2Month" value="'+esc(month)+'"></label>'+teamSelect(team)+'</div><div class="attendance-strip"><span>人员 <b>'+people.length+'</b> 人</span><span>本月已计考勤 <b>'+fmt(total)+'</b> 班</span><span>由按日考勤自动汇总</span></div><section class="panel"><div class="table-wrap att2-month-wrap"><table class="att2-month-table" aria-label="按月考勤汇总表"><thead><tr><th class="att2-sticky-name">姓名 / 班组</th>'+days.map(day=>'<th>'+esc(day.slice(5).replace("-","/"))+'</th>').join("")+'<th class="att2-sticky-total">合计（班）</th></tr></thead><tbody>'+rows+'</tbody><tfoot><tr><th class="att2-sticky-name">每日合计</th>'+days.map(day=>'<td>'+fmt(people.reduce((n,p)=>n+(cellAt(model,p.id,day)?.units||0),0))+'</td>').join("")+'<th class="att2-sticky-total">'+fmt(total)+'</th></tr></tfoot></table></div></section>'+rule+'<p class="help">点击日期格跳转当日任务式考勤面板。每日及月合计均以“班”为单位，不将1.5班截成1天；进行中、待开始和时段冲突尚未计入。原人工记录在无任务日补充，未来无记录显示“—”。</p>';
}
function details(d,m,id,date){
 const model=build(d,m,date,date),p=model.people.find(p=>p.id===id),c=cellAt(model,id,date);
 if(!p)throw Error("人员记录不存在，请刷新后重试");
 const rows=c?.entries||[],legacy=c?.manual;
 return '<h3>'+esc(p.name+" · "+p.team+" · "+date)+'</h3><p>当日已计 <strong>'+fmt(c?.units)+' 班</strong></p>'+rows.map(e=>'<section class="att2-detail"><h3>'+esc(e.shiftName+" · "+(e.vehicleCode||"人员任务"))+'</h3><p>任务开始：'+esc(time(e.startAt))+'</p><p>任务结束：'+esc(time(e.endAt))+'</p><p>时长 '+fmt(e.hours)+' 小时；已计 '+fmt(e.units)+' 班；'+esc(e.conflict?"时段重叠，暂不计":e.phase==="ended"?"已结束":e.phase==="running"?"进行中":"待开始")+'</p><small>来源：任务版本 '+esc(e.version)+' · '+esc(e.releaseId)+'</small></section>').join("")+(!rows.length?'<p>当天没有已发布人员任务。</p>':"")+(legacy?'<section class="att2-detail"><h3>原人工记录（保留）</h3><p>'+esc(legacy.status||"未登记")+' · '+esc(legacy.note||"无备注")+'</p><small>'+esc(rows.length?"同日已有任务，本条不重复累加。":"无任务，人工出勤按1班补充。")+'</small></section>':"")+'<button type="button" class="soft" data-action="attendanceDay" data-id="'+esc(id+"|"+date)+'">查看 / 登记原人工考勤</button>'+rule;
}
window.MineAttendanceBoard=Object.freeze({STANDARD_HOURS,unitsFor,monthRange,addDays,build,cellAt,daily,monthly,details});
})();