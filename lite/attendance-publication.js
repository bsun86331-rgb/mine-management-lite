/* Confirmed attendance snapshots. No automatic writes or notifications to people. */
(() => {
"use strict";
const A=()=>window.MineAttendanceBoard, esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const teams=["生产A组","生产B组"];
function plan(d,m,team,date,at=Date.now()){
 if(!teams.includes(team))throw Error("请选择生产班组");
 const model=A().build(d,m,date,date,at,team),schedule=A().scheduleFor(d,team,date,at),today=new Date(at).toLocaleDateString("sv-SE",{timeZone:"Asia/Ulaanbaatar"});
 const ready=schedule.kind==="none"?date<today:schedule.ready;
 const rows=model.people.filter(p=>p.team===team).map(p=>{
  const c=A().cellAt(model,p.id,date),leave=A().leaveOnDay(p.id,date),manual=c?.manual,entries=c?.entries||[];
  let pending=false;
  if(!leave){if(schedule.kind==="none")pending=!manual?.unscheduledDecision;else for(const r of schedule.releases){const key=r.shiftName==="白班"?"dayUnits":"nightUnits",own=entries.filter(e=>e.shiftName===r.shiftName),fixed=[0,0.5,1].includes(manual?.attendanceDecision?.[key]);if(!fixed&&(!own.length||own.some(e=>e.tripAnomaly||e.conflict||e.phase!=="ended")))pending=true;}}
  const day=leave?0:c?.dayUnits||0,night=leave?0:c?.nightUnits||0;
  return {personId:p.id,name:p.name,team:p.team,dayUnits:day,nightUnits:night,units:day+night,status:leave?"请假":pending?"待核对":day+night===0?"不记考勤":day+night===0.5?"记半天":"正常考勤",pending,note:manual?.attendanceDecision?.note||manual?.unscheduledDecision?.note||manual?.note||"",recordVersion:manual?.updatedAt||"",evidence:entries.map(e=>[e.releaseId,e.shiftName,e.vehicleId,e.tripCount,e.tripAnomaly,e.conflict,e.phase,e.units])};
 }).sort((a,b)=>a.personId.localeCompare(b.personId));
 const fingerprint=JSON.stringify([team,date,schedule.kind,schedule.releases.map(r=>[r.id,r.version,r.startAt,r.endAt]),rows]);
 const latest=(d.attendancePublications||[]).filter(r=>r.team===team&&r.workDate===date).at(-1),current=!!latest&&latest.fingerprint===fingerprint;
 return {team,date,rows,ready,pending:rows.filter(r=>r.pending).length,fingerprint,latest,current,schedule,error:!ready?schedule.message||"次日才能确认未排班考勤":!rows.length?"本组没有可确认人员":""};
}
function footer(d,m,team,date){if(!team)return "";try{const p=plan(d,m,team,date);return '<section class="panel"><div class="panel-head"><div><strong>考勤确认</strong><p class="help">'+esc(p.current?"已确认，本人可在自己的端口查看。":p.error||p.pending? p.error||"还有 "+p.pending+" 人待核对，请先处理。":"核对完成后确认，个人端才能查看本次结果。")+'</p></div><button type="button" data-action="attPublish" '+(!p.ready||p.pending||!p.rows.length||p.current?'disabled':'')+'>'+ (p.current?"已确认":"考勤确认")+'</button></div>'+(p.latest&&!p.current?'<p class="help">考勤或依据已变化，请重新核对并确认；旧确认记录保留。</p>':"")+'</section>';}catch(e){return '<section class="panel">'+esc(e.message)+'</section>';}}
function reminders(d,m,at=Date.now()){
 const keys=new Map();for(const r of d.taskReleases||[])if(r.status==="published"&&teams.includes(r.team))keys.set(r.workDate+"|"+r.team,[r.team,r.workDate]);
 const notices=[];for(const [team,date] of keys.values()){try{const p=plan(d,m,team,date,at);if(p.current||p.schedule.kind==="invalid")continue;const ended=p.schedule.releases.length&&p.schedule.releases.every(r=>Date.parse(r.endAt)<=at);if(ended)notices.push({team,date,kind:"complete",text:p.ready?"班次已结束，请核对并确认考勤":"班次已结束，请于次日完成考勤核对并确认"});else if(p.schedule.kind==="dayToNight"){const first=p.schedule.releases[0];if(Date.parse(first.endAt)<=at)notices.push({team,date,kind:"half",text:"前半班已结束，等待夜班结束后统一确认考勤"});}}catch{}}
 return notices.sort((a,b)=>b.date.localeCompare(a.date));
}
function personal(d,m,id){const latest=new Map();for(const r of d.attendancePublications||[])latest.set(r.team+"|"+r.workDate,r);return [...latest.values()].filter(r=>r.rows.some(p=>p.personId===id)).map(r=>{let current=false;try{current=plan(d,m,r.team,r.workDate).current;}catch{}return {...r,current,row:r.rows.find(p=>p.personId===id)};}).sort((a,b)=>b.workDate.localeCompare(a.workDate));}
function exportMonthly(d,m,filters,today){const month=filters.month||today.slice(0,7),range=A().monthRange(month),model=A().build(d,m,range.startDate,range.endDate,Date.now(),filters.team||""),days=Array.from({length:Number(range.endDate.slice(8))},(_,i)=>A().addDays(range.startDate,i));
 const columns=[["姓名",p=>p.name,18],["班组",p=>p.team,18],...days.map(day=>[day,p=>A().cellAt(model,p.id,day)?.units||0,12,"number"]),["合计",p=>days.reduce((n,day)=>n+(A().cellAt(model,p.id,day)?.units||0),0),14,"number"]];
 const records=model.people.filter(p=>!filters.team||p.team===filters.team),notes=["月份："+month+"；班组："+(filters.team||"全部生产班组"),"单位：个考勤；导出与当前汇总考勤表同源，包含尚未整组确认的核对结果。"];
 const dates=[];for(const team of filters.team?[filters.team]:teams)for(const day of days){let p;try{p=plan(d,m,team,day);}catch{continue;}if(p.latest||p.schedule.releases.length||(d.attendanceRecords||[]).some(r=>r.team===team&&r.workDate===day))dates.push({team,day,state:p.current?"已确认":"待确认",pending:p.pending});}
 if(!records.length)throw Error("暂无考勤人员可导出");window.MineTableExport.downloadSheets([{name:"汇总考勤表",columns,records,title:month+"汇总考勤表",notes},{name:"确认状态",columns:[["日期",r=>r.day,16],["班组",r=>r.team,18],["确认状态",r=>r.state,14],["待核对人数",r=>r.pending,14,"number"]],records:dates,title:"考勤确认状态"}],month+"考勤汇总");
}
window.MineAttendancePublication={plan,footer,reminders,personal,exportMonthly};
})();
