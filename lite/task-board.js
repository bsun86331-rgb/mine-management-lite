/* Shared read-only task board. Driver/excavator inspection actions are handled by transport-ui. */
(() => {
  "use strict";
  const E=()=>window.MineTaskEngine,esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const time=v=>new Date(v).toLocaleString("zh-CN",{timeZone:"Asia/Ulaanbaatar",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
  const names={scheduled:"待开始",running:"执行中",ended:"班次时间已结束",superseded:"已被新版替代",completed:"已收班",cancelled:"已取消"};
  function taskCard(d,release,task,person,isDispatch){
    const raw=E().phase(release),assignment=d.assignments.find(r=>r.id===task.assignmentId),session=d.shifts.find(s=>s.assignmentId===task.assignmentId),requiresInspection=["driver","excavator"].includes(task.kind);
    const state=raw!=="superseded"&&assignment?.status==="completed"?"completed":raw!=="superseded"&&assignment?.status==="cancelled"?"cancelled":raw,inspection=requiresInspection?(session?.status==="working"||session?.startedWorkAt?"班前检查已完成":session?.status==="checked"?"异常已上报，待处理":session?.status==="closed"?"班次已结束":"待使用前检查"):"按任务时间执行";
    const region=task.regions?'<div><span>装载区</span>'+esc(task.regions.load?.name||"未设置")+'</div><div><span>卸载区</span>'+esc(task.regions.unloads.map(z=>z.name+(z.material?" · "+z.material:"")).join("、")||"未设置")+'</div>':"";
    let work="";
    if(!isDispatch&&requiresInspection&&raw==="running"&&assignment?.status==="active"){
      const own=d.shifts.find(s=>s.personId===person.id&&s.status!=="closed");
      work=own?'<button type="button" data-action="go-work" class="task-work-button">进入本班作业 / 检查</button>':'<button type="button" data-action="taskInspection" data-id="'+esc(task.assignmentId)+'" class="task-work-button">进行使用前检查</button>';
    }
    const following=task.kind==="excavator"&&task.group?.trucks.length?'<p class="task-following">跟随汽车：'+esc(task.group.trucks.map(t=>t.vehicleCode+" / "+t.personName).join("、"))+'</p>':"";
    return '<article class="task-card"><div class="task-card-head"><strong>'+esc(task.kind==="auxiliary"?"辅助作业":task.kind==="driver"?"汽车运输":"挖机装载")+(isDispatch?' · '+esc(task.personName):"")+'</strong><span class="task-phase task-'+esc(state)+'">'+esc(names[state]||state)+'</span></div><div class="task-values"><div><span>设备</span>'+esc(task.vehicleCode||"未绑定设备")+'</div><div><span>岗位 / 班组</span>'+esc(task.personName+" / "+release.team)+'</div>'+(task.group?'<div><span>生产组 / 挖机</span>'+esc("第"+task.groupNumber+"组 · "+task.group.excavatorCode)+'</div><div><span>挖机司机</span>'+esc(task.group.excavatorDriverName)+'</div>':"")+region+'</div>'+following+(task.content?'<p class="task-content"><strong>作业内容</strong><br>'+esc(task.content).replace(/\n/g,"<br>")+'</p>':"")+'<div class="task-inspection">'+esc(inspection)+'</div>'+work+'</article>';
  }
  function render(d,m,person,options={}){
    const dispatch=options.dispatch===true;
    const rows=(d.taskReleases||[]).filter(r=>dispatch||r.tasks.some(t=>t.personId===person.id&&t.role===person.applicationRole));
    const live=rows.filter(r=>r.status==="published"),history=rows.filter(r=>r.status!=="published");
    const order={running:0,scheduled:1,ended:2};
    live.sort((a,b)=>(order[E().phase(a)]??9)-(order[E().phase(b)]??9)||Date.parse(b.startAt)-Date.parse(a.startAt));
    const section=r=>{const tasks=dispatch?r.tasks:r.tasks.filter(t=>t.personId===person.id&&t.role===person.applicationRole);return '<section class="task-release"><header><div><h3>'+esc(r.workDate+" "+r.shiftName+" · "+r.team)+'</h3><p>'+esc(time(r.startAt)+" — "+time(r.endAt))+' <span>第'+esc(r.version)+'版</span></p></div><small>发布人：'+esc(r.publisherName)+'</small></header><div class="task-card-grid">'+tasks.map(t=>taskCard(d,r,t,person,dispatch)).join("")+'</div></section>';};
    return '<section class="task-board">'+(options.hideTitle?"":'<h2>'+esc(dispatch?"任务看板":"我的任务看板")+'</h2>')+(live.length?live.map(section).join(""):'<p class="task-empty">暂无已发布任务</p>')+(history.length?'<details class="task-history"><summary>历史发布版本（'+history.length+'）</summary>'+history.map(section).join("")+'</details>':"")+'</section>';
  }
  window.MineTaskBoard=Object.freeze({render});
})();
