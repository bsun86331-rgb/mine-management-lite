(() => {
  "use strict";
  const T=window.MineTransport,L=window.MineLogistics,$=id=>document.getElementById(id),role=new URLSearchParams(location.search).get("role");
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const when=v=>v?new Date(v).toLocaleString("zh-CN",{timeZone:"Asia/Ulaanbaatar"}):"—";
  const labels={driver:"司机工作台",excavator:"挖机工作台",dispatch:"调度工作台"},states={working:"作业中",paused:"已暂停",repair:"维修暂停",maintenance:"保养暂停",disabled:"设备已停用",missing:"设备未找到",checking:"待使用前检查",checked:"异常已上报",closed:"已收班",loaded:"装载已识别",hauling:"运输中",review:"定位待核对",completed:"已完成",voided:"已作废",draft:"草稿",active:"已启用",cancelled:"已取消"};
  let d,m,person,actor,view=role==="dispatch"?"tasks":"work",modalSave=null,busy=false,signature="",watchId=null,gpsTimer=null,gpsFetching=false,gpsGeneration=0,positionBusy=false,lastQueuedPoint=null,tracking=false,photoUrls=[],modalToken=0,recordSearch="",taskClockSignature="",publishPreviewState=null,selectedDispatchShift=null,dispatchShiftLocked=false,timeConfiguredShift=null,dispatchGroups={},dispatchProductionDate=null,shiftMinute=null,zoneCenterFix=null,zoneFixRequest=0,lastSimulation={lat:"",lng:"",accuracy:"5"};
  const dispatchBindingEdits=new Map();
  const attendanceFilters={startDate:null,endDate:null,team:""};
  const att2Filters={date:null,month:null,team:""};
  let att3ConfirmationContext=null;
  let attendanceEditorVersion="",attendanceRenderedToday="";
  const haulSummaryFilters={startDate:null,endDate:null,mode:"crew",personId:"",vehicleId:""};
  const haulSummaryTitles={crew:"班组逐日车数统计",person:"人员逐日车数统计",equipment:"设备逐日车数统计"};
  let haulSummaryRenderedToday="",haulSummaryExportData=null,haulSummaryTaskHistory=null;
  const coalRatioSettings={period:"natural",startDay:1,endDay:31,month:null};
  try{const saved=JSON.parse(localStorage.getItem("mine-transport-coal-ratio-settings-v1")||"{}");if(saved.period==="custom")coalRatioSettings.period="custom";for(const key of ["startDay","endDay"])if(Number.isInteger(saved[key])&&saved[key]>=1&&saved[key]<=31)coalRatioSettings[key]=saved[key];}catch{}
  const nameOf=id=>m.people.find(p=>p.id===id)?.name||"未分配",vehicleOf=id=>m.vehicles.find(v=>v.id===id),vehicleName=id=>vehicleOf(id)?.code||"未分配";
  const button=(action,id,label,style="soft")=>'<button type="button" class="'+style+'" data-action="'+action+'" data-id="'+esc(id||"")+'">'+esc(label)+'</button>';
  const pill=(text,warn=false,red=false)=>'<span class="pill'+(red?' red':warn?' warn':'')+'">'+esc(text)+'</span>';
  const empty=text=>'<div class="empty">'+esc(text||"暂无记录")+'</div>';
  const input=(name,label,value="",type="text",extra="")=>'<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value??"")+'" '+extra+'></label>';
  const select=(name,label,options,value="")=>'<label>'+label+'<select name="'+name+'">'+options.map(([v,t])=>'<option value="'+esc(v)+'"'+(String(v)===String(value)?' selected':'')+'>'+esc(t)+'</option>').join("")+'</select></label>';
  const materialSelect=(label,value="")=>select("material",label,[["","请选择（选填）"],...T.materialTypes.map(v=>[v,v])],T.materialTypes.includes(value)?value:"")+(value&&!T.materialTypes.includes(value)&&value!=="未分类"?'<p class="help">历史物料：'+esc(value)+'。请从统一分类重新选择；未选择则记为未分类。</p>':'');
  const materialHelp='<p class="help">只记车数：采坑内垫路、修路等未离开采坑的运输，完成卸料后计1车。</p>';
  const note=(label="说明（选填）",value="")=>'<label>'+label+'<textarea name="note" rows="3" maxlength="300">'+esc(value)+'</textarea></label>';
  const session=()=>T.ownShift(d,person.id),currentTrip=()=>T.shiftTrip(d,session());
  const devicePill=id=>{const state=T.equipmentState(d,m,id);return pill(states[state]||state,state!=="working",["disabled","missing"].includes(state));};
  const modeName=t=>t.mode==="simulation"?"位置模拟":"真实定位";
  const activeAssignments=()=>d.assignments.filter(r=>r.personId===person.id&&r.status==="active"&&(!r.releaseId||MineTaskEngine.phase(d.taskReleases.find(t=>t.id===r.releaseId)||{})==="running"));
  function machineIds(){const s=session();if(s)return [s.vehicleId];const a=activeAssignments();if(a.length)return [...new Set(a.map(r=>r.vehicleId))];const last=d.shifts.find(s=>s.personId===person.id);return last?[last.vehicleId]:[];}
  function roleTrips(){if(role==="dispatch")return d.trips;if(role==="driver")return d.trips.filter(t=>t.personId===person.id);const ids=machineIds();return d.trips.filter(t=>ids.includes(t.excavatorId));}
  function currentStatsTrips(){const s=session();return roleTrips().filter(t=>!s||(t.workDate===s.workDate&&t.shiftName===s.shiftName&&(role!=="driver"||t.shiftId===s.id)));}
  function stats(rows){return {real:rows.filter(t=>t.status==="completed"&&t.mode==="gps").length,sim:rows.filter(t=>t.status==="completed"&&t.mode==="simulation").length,live:rows.filter(T.liveTrip).length,review:rows.filter(t=>t.status==="review").length};}
  function summary(rows){const n=stats(rows);return '<div class="summary"><div><strong>'+n.real+'</strong><span>真实定位有效车数</span></div><div><strong>'+n.sim+'</strong><span>位置模拟车数</span></div><div><strong>'+n.live+'</strong><span>在途车次</span></div><div><strong>'+n.review+'</strong><span>定位待核对</span></div></div>';}
  function toast(text){if($("modal").open)$("modalError").textContent=text;$("toast").textContent=text;$("toast").classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>$("toast").classList.remove("show"),4500);}
  function releasePhotos(){photoUrls.forEach(url=>URL.revokeObjectURL(url));photoUrls=[];modalToken++;}
  function closeModal(){if(busy)return;$("modal").close();modalSave=null;releasePhotos();}
  function show(title,body,save,label="保存"){releasePhotos();$("modalTitle").textContent=title;$("modalBody").innerHTML=body;$("modalError").textContent="";$("save").textContent=label;$("save").hidden=!save;$("save").disabled=false;modalSave=save;$("modal").showModal();}
  function block(error){window.MineTransportChat?.dispose();stopGPS(false);$("app").hidden=true;$("blocked").hidden=false;$("blockedText").textContent=error.message||error;$("blockedLink").href="enroll.html?role="+encodeURIComponent(role||"");$("blockedLink").textContent="返回登记状态页";$("modal").close();$("logisticsDialog").close();releasePhotos();}
  function refresh(force=false){try{const next=T.context(role);if(person&&next.id!==person.id)throw new Error("本人登记已切换，请重新进入对应工作台");person=next;L.selectSession(person,false);actor={personId:person.id,role};d=T.get();m=L.main();$("blocked").hidden=true;$("app").hidden=false;signature=T.stamp()+window.MineLeave.stamp()+localStorage.getItem(L.PEOPLE)+localStorage.getItem(L.KEY);if($("modal").open&&!force)return;render();}catch(error){block(error);}}
  async function operate(type,args={},success="已保存",onSaved=null){
    if(busy)return;busy=true;$("save").disabled=true;
    try{await T.act(type,args,actor);if(onSaved)onSaved();$("modal").close();modalSave=null;releasePhotos();refresh(true);toast(success);}catch(error){toast(error.message);}finally{busy=false;$("save").disabled=false;}
  }
  function render(){
    $("transportFooter").hidden=role==="dispatch";
    $("workspaceRefresh").hidden=role==="dispatch";
    haulSummaryExportData=null;$("exportHaulSummary").hidden=role!=="dispatch"||view!=="summary";$("exportHaulSummary").disabled=true;
    const entries=role==="dispatch"?[["tasks","任务看板"],["summary","月报汇总"],["attendanceDaily","考勤汇总"],["assignments","白夜班排班"],["zones","GPS作业区域"],["faults","检查与异常责任"],["messages","消息中心"],["settings","定位规则"],["audit","操作记录"]]:[["work",role==="driver"?"本班驾驶作业":"本班装载作业"],["tasks","我的任务看板"],["records","运输车次"],["faults","检查与责任关联"],["sessions","我的班次"],["messages","消息中心"]];
    if(!entries.some(e=>e[0]===(role==="dispatch"&&view==="attendance"?"attendanceDaily":view)))view=entries[0][0];const unread=T.visibleMessages(d,person).filter(v=>!v.readBy.includes(person.id)).length;
    $("roleLabel").textContent=labels[role];$("identity").textContent=person.name+" · "+person.status;$("nav").innerHTML=entries.map(([id,label])=>'<button type="button" data-view="'+id+'" class="'+(id===view||(id==="attendanceDaily"&&view==="attendance")?'selected':'')+(id==="messages"&&unread?' message-unread':'')+'">'+label+(id==="messages"&&unread?'<span class="message-unread-badge" aria-label="'+unread+'条未读">'+unread+'</span>':'')+'</button>').join("");
    $("title").textContent=view==="summary"?haulSummaryTitles[haulSummaryFilters.mode]:(entries.find(v=>v[0]===view)?.[1]||"考勤汇总");$("subtitle").textContent=view==="summary"?"生产A组 / 生产B组":role==="dispatch"?"排班、区域、设备与车次共用同一台账":role==="driver"?"先检查设备，再按装载与卸载区域完成运输":"按实际装载挖机汇总跟随车辆的已完成车次";document.title=labels[role]+" · 矿山管理系统";
    if(role==="dispatch"&&view==="tasks"&&haulSummaryTaskHistory){$("title").textContent=haulSummaryTaskHistory.workDate+" · "+haulSummaryTaskHistory.team+"任务看板";$("subtitle").textContent="查看当天白夜班任务及逐趟拉运明细";}
    $("eyebrow").hidden=false;$("subtitle").hidden=false;$("notice").hidden=false;
    $("notice").innerHTML=(unread?'<div class="banner">你有 '+unread+' 条未读消息。'+button("go-messages","","查看")+'</div>':'');
    const renderers={attendanceDaily:renderDailyAttendance,attendance:renderAttendance,summary:renderHaulSummary,tasks:()=>MineTaskBoard.render(d,m,person,{dispatch:role==="dispatch",hideTitle:true,history:role==="dispatch"?haulSummaryTaskHistory:null}),assignments:renderAssignments,zones:renderZones,records:renderRecords,faults:renderFaults,devices:renderDevices,sessions:renderSessions,messages:renderMessages,settings:renderSettings,audit:renderAudit,work:role==="driver"?renderDriver:renderExcavator};
    if(view==="messages"&&window.MineTransportChat){
      if(!$("content").querySelector("[data-chat-root]"))$("content").innerHTML=MineTransportChat.html();
      MineTransportChat.update({d,m,person,role,onChanged:()=>refresh(),toast});
    }else{window.MineTransportChat?.dispose();$("content").innerHTML=(view==="work"?MineTaskBoard.render(d,m,person):"")+renderers[view]();}
    taskClockSignature=MineTaskBoard.clockKey(d);
  }
  function attendanceScope(){
    const today=T.date(),startDate=attendanceFilters.startDate||today.slice(0,7)+"-01",endDate=attendanceFilters.endDate||today;
    const error=!haulSummaryValidDate(startDate)||!haulSummaryValidDate(endDate)?"请选择有效日期":startDate>endDate?"开始日期不能晚于结束日期":"";
    return {startDate,endDate,team:attendanceFilters.team,error};
  }
  function attendanceData(scope){
    const records=[...new Map((d.attendanceRecords||[]).filter(r=>r.workDate>=scope.startDate&&r.workDate<=scope.endDate).slice().sort((a,b)=>String(a.updatedAt||a.createdAt||"").localeCompare(String(b.updatedAt||b.createdAt||""))).map(r=>[JSON.stringify([r.personId,r.workDate]),r])).values()];
    const people=new Map(m.people.filter(p=>L.active(p)&&["生产A组","生产B组"].includes(p.team)).map(p=>[p.id,{id:p.id,name:p.name,team:p.team}]));
    for(const r of records){const p=m.people.find(p=>p.id===r.personId);if(!people.has(r.personId))people.set(r.personId,{id:r.personId,name:p?.name||r.personName,team:p?.team||r.team||""});}
    const rows=[...people.values()].filter(p=>!scope.team||p.team===scope.team).map(p=>{
      const own=records.filter(r=>r.personId===p.id),row={...p,present:0,leave:0,rest:0,absent:0,due:0};
      for(const r of own){const key={"出勤":"present","请假":"leave","休息":"rest","缺勤":"absent"}[r.status];if(key)row[key]++;}
      row.due=row.present+row.leave+row.absent;return row;
    }).sort((a,b)=>a.team.localeCompare(b.team,"zh-CN")||a.name.localeCompare(b.name,"zh-CN")||String(a.id).localeCompare(String(b.id)));
    const totals={present:0,leave:0,rest:0,absent:0,due:0};for(const row of rows)for(const key of Object.keys(totals))totals[key]+=row[key];
    return {rows,totals};
  }
  const attendanceRate=row=>row.due?(row.present/row.due*100).toFixed(1)+"%":"—";
  function renderDailyAttendance(){
    attendanceRenderedToday=T.date();const date=att2Filters.date||MineAttendanceBoard.addDays(T.date(),-1);if(!att2Filters.month)att2Filters.month=date.slice(0,7);
    $("title").textContent="按日考勤";$("subtitle").textContent=date+" · "+(att2Filters.team||"请选择班组")+" · "+MineAttendanceBoard.scheduleFor(d,att2Filters.team||"",date).label;
    attendanceFilters.startDate=date;attendanceFilters.endDate=date;attendanceFilters.team=att2Filters.team;
    return MineAttendanceBoard.daily(d,m,att2Filters,T.date());
  }
  function renderAttendance(){
    attendanceRenderedToday=T.date();const month=att2Filters.month||T.date().slice(0,7),range=MineAttendanceBoard.monthRange(month);
    $("title").textContent="汇总考勤表";$("subtitle").textContent=month+" · "+(att2Filters.team||"全部生产班组")+" · 按日考勤自动汇总";
    attendanceFilters.startDate=range.startDate;attendanceFilters.endDate=range.endDate;attendanceFilters.team=att2Filters.team;
    return MineAttendanceBoard.monthly(d,m,att2Filters,T.date());
  }
  function syncAtt3Confirmation(){
    if(!att3ConfirmationContext)return;
    const day=$("editForm").querySelector('[name="att3DayUnits"]'),night=$("editForm").querySelector('[name="att3NightUnits"]'),output=$("att3ConfirmationPreview");if(!day||!night||!output)return;
    const parse=value=>value===""?null:Number(value),summary=MineAttendanceBoard.resolveUnits(att3ConfirmationContext.cell,{dayUnits:parse(day.value),nightUnits:parse(night.value)});
    output.textContent="白班 "+summary.dayUnits+" 班 ＋ 夜班 "+summary.nightUnits+" 班 ＝ 当日 "+summary.units+" 班";
  }
  function confirmUnscheduledAttendance(personId,workDate){
    if(role!=="dispatch")return;
    const p=m.people.find(p=>p.id===personId);if(!p)return toast("人员不存在，请刷新");
    const state=MineAttendanceBoard.unscheduledState(d,personId,p.team,workDate);
    if(!state.ready)return toast(state.error||"请在次日确认未排班考勤");
    const model=MineAttendanceBoard.build(d,m,workDate,workDate),record=MineAttendanceBoard.cellAt(model,personId,workDate)?.manual,decision=record?.unscheduledDecision,expectedUpdatedAt=record?.updatedAt||"",expectedSourceStamp=MineAttendanceBoard.sourceStamp(d,personId,workDate);
    const changes=(record?.history||[]).filter(h=>h.action==="未排班考勤判断").slice().reverse().map(h=>'<p>'+esc(when(h.at)+" · "+h.name+" · "+h.toDecision.units+"个考勤 · "+h.toDecision.note)+'</p>').join("");
    const body='<p><strong>'+esc(p.name)+'</strong> · '+esc(p.team+" · "+workDate)+'</p><p class="help">'+(state.onLeave?'当日有已批准请假，不记考勤；未销假一直按请假处理。':'未排班不自动认定缺勤。下雨、检查等非司机原因，可正常记考勤；记1个必须填写原因。')+'</p>'+select("attNoScheduleUnits","调度判断",state.onLeave?[["0","请假，不记考勤（0）"]]:[["","请选择判断结果"],["1","非司机原因，正常记考勤（1）"],["0","不记考勤（0）"]],state.onLeave?"0":decision?String(decision.units):"")+'<label>原因 / 说明<textarea name="attNoScheduleNote" rows="3" maxlength="500" placeholder="例如：下雨停工、现场检查">'+esc(decision?.note||"")+'</textarea></label><p class="help">保存后自动进入月汇总。若排班或请假发生变化，需要重新打开核对。</p>'+(changes?'<details><summary>判断历史</summary>'+changes+'</details>':"");
    show("未排班考勤 · "+p.name,body,form=>{if(form.get("attNoScheduleUnits")==="")throw Error("请选择判断结果");return operate("unscheduledAttendance",{personId,workDate,units:form.get("attNoScheduleUnits"),note:form.get("attNoScheduleNote"),expectedUpdatedAt,expectedSourceStamp},"考勤判断已保存，月汇总已更新");},"保存考勤");
  }
  function confirmDailyAttendance(personId,workDate,shiftName){
    if(role!=="dispatch")return;
    const model=MineAttendanceBoard.build(d,m,workDate,workDate),p=model.people.find(p=>p.id===personId),cell=MineAttendanceBoard.cellAt(model,personId,workDate);
    if(!p)throw new Error("人员记录不存在，请刷新后重试");
    const dayReady=MineAttendanceBoard.shiftState(d,p.team,workDate,"白班").ready,nightReady=MineAttendanceBoard.shiftState(d,p.team,workDate,"夜班").ready;
    const schedule=MineAttendanceBoard.scheduleFor(d,p.team,workDate),maxDay=schedule.limits["白班"]??1,maxNight=schedule.limits["夜班"]??1;
    if(!(shiftName==="夜班"?nightReady:dayReady))return toast("当天排班尚未全部结束、未到次日或未发布，暂不能确认考勤");
    const record=cell?.manual,decision=record?.attendanceDecision,expectedUpdatedAt=record?.updatedAt||"",expectedDecisionId=decision?.id||"",expectedSourceStamp=MineAttendanceBoard.sourceStamp(d,personId,workDate),options=[["","跟随任务 / 原规则"],["0","不计考勤（0班）"],["0.5","半班（0.5班）"],["1","整班（1班）"]];
    const source=(cell?.entries||[]).map(e=>'<tr><td>'+esc(e.shiftName)+'</td><td>'+esc(e.vehicleCode||"人员任务")+'</td><td>'+esc(when(e.startAt))+'</td><td>'+esc(when(e.endAt))+'</td><td>'+esc(e.tripAnomaly?"异常 · 本时段无车数":e.requiresTrips?"✓ 本时段"+e.tripCount+"车":e.phase==="ended"?"已结束":e.phase==="running"?"进行中":e.phase==="invalid"?"时间待核对":"待开始")+'</td></tr>').join("");
    const changes=(record?.history||[]).filter(h=>h.action==="调度确认日考勤").slice().reverse().map(h=>'<p>'+esc(when(h.at)+" · "+(h.name||h.by)+" · 白班 "+(h.toDecision?.dayUnits==null?"跟随任务":h.toDecision.dayUnits+"班")+" / 夜班 "+(h.toDecision?.nightUnits==null?"跟随任务":h.toDecision.nightUnits+"班")+(h.toDecision?.note?" · "+h.toDecision.note:""))+'</p>').join("");
    const body='<p><strong>'+esc(p.name)+'</strong> · '+esc(p.team)+' · '+esc(workDate)+'</p><p class="help">当前查看'+esc(shiftName||"白班")+'。第二天确认前一天；按当天全部排班时段结束后开放，未分任务人员也一样。</p><div class="form-grid">'+select("att3DayUnits","白班考勤"+(dayReady?"":"（任务未结束，暂不可确认）"),options.filter(([v])=>v===""||Number(v)<=maxDay).map(([v,t])=>[v,v==="0.5"&&maxDay===0.5?"上满（0.5个考勤）":t]),dayReady&&decision?.dayUnits!=null&&decision.dayUnits<=maxDay?String(decision.dayUnits):"").replace('<select ','<select '+(dayReady?"":'disabled '))+select("att3NightUnits","夜班考勤"+(nightReady?"":"（任务未结束，暂不可确认）"),options.filter(([v])=>v===""||Number(v)<=maxNight).map(([v,t])=>[v,v==="0.5"&&maxNight===0.5?"上满（0.5个考勤）":t]),nightReady&&decision?.nightUnits!=null&&decision.nightUnits<=maxNight?String(decision.nightUnits):"").replace('<select ','<select '+(nightReady?"":'disabled '))+'</div><p class="att3-confirmation-preview" id="att3ConfirmationPreview"></p><label>考勤说明（选填）<textarea name="att3Note" rows="3" maxlength="500" placeholder="例如：上午半班、下午休息，夜班整班">'+esc(decision?.note||"")+'</textarea></label><p class="help">汽车/挖机有本时段真实已完成车数时默认有考勤；无车数显示异常、默认不计，调度核对后可人工确认（如雨天、检查等）。保存后日合计、月汇总自动更新。选择“跟随任务 / 原规则”可恢复默认计算，原人工记录和调整历史保留。</p><details><summary>任务依据与原记录</summary>'+(source?'<div class="table-wrap"><table><thead><tr><th>班次</th><th>设备</th><th>开始</th><th>结束</th><th>状态</th></tr></thead><tbody>'+source+'</tbody></table></div>':'<p>本人未分配任务；本班任务已结束，可按现场情况确认考勤。</p>')+(record&&(record.status||record.note)?'<p>'+esc("原人工记录："+(record.status||"未登记")+"；"+(record.note||"无备注"))+'</p>':"")+'</details>'+(changes?'<details><summary>调度确认历史</summary>'+changes+'</details>':"");
    att3ConfirmationContext={cell:cell||{entries:[],manual:null,dayReady,nightReady,maxDay,maxNight}};
    show("确认考勤 · "+p.name,body,form=>operate("attendanceDecision",{personId,workDate,dayUnits:dayReady?form.get("att3DayUnits"):(decision?.dayUnits??null),nightUnits:nightReady?form.get("att3NightUnits"):(decision?.nightUnits??null),note:form.get("att3Note"),expectedUpdatedAt,expectedDecisionId,expectedSourceStamp},"考勤已确认，日月汇总已更新"),"保存考勤");
    syncAtt3Confirmation();
  }
  function syncAttendanceEditor(){
    const workDate=$("editForm").querySelector('[name="attendanceWorkDate"]')?.value,personId=$("editForm").dataset.attendancePerson;
    if(!personId)return;const row=(d.attendanceRecords||[]).find(r=>r.personId===personId&&r.workDate===workDate);
    $("editForm").querySelector('[name="attendanceStatus"]').value=row?.status||"";$("editForm").querySelector('[name="attendanceNote"]').value=row?.note||"";
    attendanceEditorVersion=row?.updatedAt||"";
  }
  function editAttendance(personId,selectedDate=null){
    if(role!=="dispatch")return;
    const p=m.people.find(p=>p.id===personId),history=(d.attendanceRecords||[]).filter(r=>r.personId===personId),scope=attendanceScope(),fallback=history[0];
    if(!p&&!fallback)return toast("人员记录不存在，请刷新后重试");
    const name=p?.name||fallback.personName,team=p?.team||fallback?.team||"",today=T.date(),workDate=selectedDate&&haulSummaryValidDate(selectedDate)?selectedDate:today>=scope.startDate&&today<=scope.endDate?today:scope.endDate;
    const records=history.filter(r=>r.workDate>=scope.startDate&&r.workDate<=scope.endDate).sort((a,b)=>b.workDate.localeCompare(a.workDate));
    const body='<p><strong>'+esc(name)+'</strong> · '+esc(team)+'</p><div class="form-grid">'+input("attendanceWorkDate","考勤日期",workDate,"date")+select("attendanceStatus","考勤状态",[["","未登记"],["出勤","出勤"],["请假","请假"],["休息","休息"],["缺勤","缺勤"]],"")+'</div><label>备注（选填）<textarea name="attendanceNote" rows="2" maxlength="500" placeholder="可填写请假或缺勤说明"></textarea></label><p class="help">修改按天保存；选择“未登记”可清除当天统计状态，历史修改记录保留。</p><h3>所选范围登记记录</h3>'+(records.length?'<div class="table-wrap"><table><thead><tr><th>日期</th><th>状态</th><th>备注</th></tr></thead><tbody>'+records.map(r=>'<tr><td>'+esc(r.workDate)+'</td><td>'+esc(r.status||"未登记")+'</td><td>'+esc(r.note||"—")+'</td></tr>').join("")+'</tbody></table></div>':empty("尚未登记考勤"));
    $("editForm").dataset.attendancePerson=personId;
    show("考勤登记 · "+name,body,form=>operate("attendance",{personId,workDate:form.get("attendanceWorkDate"),status:form.get("attendanceStatus"),note:form.get("attendanceNote"),expectedUpdatedAt:attendanceEditorVersion},"考勤已保存"),"保存考勤");
    syncAttendanceEditor();
  }
  function haulSummaryValidDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+"T00:00:00Z"))&&new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value;}
  function haulSummaryScope(){
    const today=T.date(),startDate=haulSummaryFilters.startDate||today.slice(0,7)+"-01",endDate=haulSummaryFilters.endDate||today;
    const error=!haulSummaryValidDate(startDate)||!haulSummaryValidDate(endDate)?"请选择有效的开始日期和结束日期":startDate>endDate?"开始日期不能晚于结束日期，请调整日期范围":"";
    return {startDate,endDate,error,mode:haulSummaryFilters.mode,personId:haulSummaryFilters.personId,vehicleId:haulSummaryFilters.vehicleId};
  }
  function haulSummaryContext(scope){
    const blank=()=>({total:0,crewA:0,crewB:0,otherCrew:0,haul:0,load:0,"渣":0,"煤":0,"只记车数":0,unknown:0});
    const start=Date.parse(scope.startDate+"T00:00:00Z"),end=Date.parse(scope.endDate+"T00:00:00Z"),length=scope.error?0:Math.round((end-start)/86400000)+1;
    const days=Array.from({length},(_,index)=>({workDate:new Date(start+index*86400000).toISOString().slice(0,10),...blank()})),byDate=new Map(days.map(row=>[row.workDate,row]));
    const releases=new Map(d.taskReleases.map(r=>[r.id,r])),assignments=new Map(d.assignments.map(a=>[a.id,a])),people=new Map(m.people.map(p=>[String(p.id),p])),vehicles=new Map(m.vehicles.map(v=>[String(v.id),v]));
    const trips=[...new Map(d.trips.filter(t=>t.status==="completed"&&t.mode==="gps"&&byDate.has(t.workDate)).map(t=>[t.id,t])).values()],operators=new Map();
    const operatorId=t=>{if(!operators.has(t.id))operators.set(t.id,MineTaskBoard.excavatorOperator(d,t));return operators.get(t.id);};
    return {blank,days,byDate,releases,assignments,people,vehicles,trips,operatorId};
  }
  function haulSummaryPersonGroup(scope){return {"__crew_a_persons__":"生产A组","__crew_b_persons__":"生产B组"}[scope.personId]||"";}
  function haulSummaryPersonMulti(scope){return scope.personId==="__all_persons__"||!!haulSummaryPersonGroup(scope);}
  function haulSummaryPersonMatches(id,scope,context,trip=null){
    if(scope.personId==="__all_persons__")return true;
    const team=haulSummaryPersonGroup(scope);
    if(!team)return id!=null&&id!==""&&String(id)===scope.personId;
    const person=context.people.get(String(id));
    const sourceTeam=trip?(context.releases.get(trip.releaseId)?.team||context.assignments.get(trip.assignmentId)?.team):"";
    return (person?.team||sourceTeam)===team;
  }
  function haulSummaryOptions(scope,context){
    const entries=new Map(),add=(id,name,description)=>{if(id!=null&&id!==""&&!entries.has(String(id)))entries.set(String(id),{name:name||String(id),label:(name||String(id))+(description?" · "+description:"")+"（"+id+"）"});};
    if(scope.mode==="person"){
      for(const p of m.people.filter(p=>["driver","excavator"].includes(p.applicationRole)))add(p.id,p.name,p.role);
      for(const t of context.trips){
        const driver=context.people.get(String(t.personId));add(t.personId,driver?.name||t.personName,driver?.role||"汽车司机");
        const id=context.operatorId(t),operator=context.people.get(String(id)),source=context.releases.get(t.releaseId),group=source?.groups?.find(g=>g.excavatorId===t.excavatorId);
        const actual=d.shifts.find(s=>s.kind==="excavator"&&s.personId===id&&s.vehicleId===t.excavatorId&&s.workDate===t.workDate&&s.shiftName===t.shiftName);
        add(id,operator?.name||actual?.personName||(group?.excavatorDriverId===id?group.excavatorDriverName:""),operator?.role||"挖机司机");
      }
      if(scope.personId&&!haulSummaryPersonMulti(scope)&&!entries.has(scope.personId)){const p=context.people.get(scope.personId);add(scope.personId,p?.name,p?.role||"原人员");}
    }else if(scope.mode==="equipment"){
      for(const v of m.vehicles.filter(v=>T.isExcavator(v)||T.isHaulTruck(v)))add(v.id,v.code||v.name,v.category||v.model);
      for(const t of context.trips){
        const truck=context.vehicles.get(String(t.vehicleId)),exc=context.vehicles.get(String(t.excavatorId));
        add(t.vehicleId,truck?.code||t.vehicleCode,truck?.category||truck?.model||"汽车");
        add(t.excavatorId,exc?.code||t.excavatorCode,exc?.category||exc?.model||"挖机");
      }
      if(scope.vehicleId&&!["__all_excavators__","__all_trucks__"].includes(scope.vehicleId)&&!entries.has(scope.vehicleId)){const v=context.vehicles.get(scope.vehicleId);add(scope.vehicleId,v?.code||v?.name,v?.category||v?.model||"原设备");}
    }
    return [...entries.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name,"zh-CN",{numeric:true})||a[0].localeCompare(b[0])).map(([id,value])=>[id,value.label]);
  }
  function haulSummaryData(scope,context){
    const totals=context.blank();
    for(const t of context.trips){
      let hauling=false,loading=false;
      if(scope.mode==="person"){
        const all=scope.personId==="__all_persons__",operatorId=context.operatorId(t);
        hauling=t.personId!=null&&t.personId!==""&&haulSummaryPersonMatches(t.personId,scope,context,t);
        loading=operatorId!=null&&operatorId!==""&&haulSummaryPersonMatches(operatorId,scope,context,t);
        const unassigned=(t.personId==null||t.personId==="")&&(operatorId==null||operatorId==="")&&haulSummaryPersonMulti(scope)&&haulSummaryPersonMatches(null,scope,context,t);
        if(!scope.personId||(!all&&!hauling&&!loading&&!unassigned))continue;
      }else if(scope.mode==="equipment"){
        hauling=scope.vehicleId==="__all_trucks__"?(t.vehicleId!=null&&t.vehicleId!==""):scope.vehicleId==="__all_excavators__"?false:String(t.vehicleId)===scope.vehicleId;loading=scope.vehicleId==="__all_excavators__"?(t.excavatorId!=null&&t.excavatorId!==""):scope.vehicleId==="__all_trucks__"?false:String(t.excavatorId)===scope.vehicleId;
        if(!scope.vehicleId||(!hauling&&!loading))continue;
      }
      const team=context.releases.get(t.releaseId)?.team||context.assignments.get(t.assignmentId)?.team||context.people.get(String(t.personId))?.team;
      const crew=team==="生产A组"?"crewA":team==="生产B组"?"crewB":"otherCrew",material=T.materialTypes.includes(t.material)?t.material:"unknown",row=context.byDate.get(t.workDate);
      row.total++;row[crew]++;row[material]++;totals.total++;totals[crew]++;totals[material]++;
      if(hauling){row.haul++;totals.haul++;}if(loading){row.load++;totals.load++;}
    }
    return {days:context.days,totals};
  }
  function haulSummaryPeopleRows(context,options,scope){
    const nameCounts=new Map();
    for(const [id,label] of options){const name=context.people.get(id)?.name||label;nameCounts.set(name,(nameCounts.get(name)||0)+1);}
    const people=new Map(options.map(([id,label])=>{const name=context.people.get(id)?.name||label;return [id,{id,name:name+(nameCounts.get(name)>1?"（"+id+"）":"")}];}));
    const rows=new Map(),key=(date,id)=>JSON.stringify([date,id]);
    for(const day of context.days)for(const person of people.values())if(haulSummaryPersonMatches(person.id,scope,context))rows.set(key(day.workDate,person.id),{workDate:day.workDate,personId:person.id,personName:person.name,...context.blank()});
    for(const trip of context.trips){
      const operator=context.operatorId(trip),driver=trip.personId,actualIds=[...new Set([driver,operator].filter(id=>id!=null&&id!=="").map(String))],ids=actualIds.filter(id=>haulSummaryPersonMatches(id,scope,context,trip));
      if(!actualIds.length&&haulSummaryPersonMatches(null,scope,context,trip))ids.push("__unassigned_person__");
      for(const id of ids){
        const rowKey=key(trip.workDate,id);
        if(!rows.has(rowKey))rows.set(rowKey,{workDate:trip.workDate,personId:id,personName:people.get(id)?.name||"历史未归属",...context.blank()});
        const row=rows.get(rowKey),material=T.materialTypes.includes(trip.material)?trip.material:"unknown";
        row.total++;row[material]++;
        if(driver!=null&&driver!==""&&String(driver)===id)row.haul++;
        if(operator!=null&&operator!==""&&String(operator)===id)row.load++;
      }
    }
    return [...rows.values()].sort((a,b)=>a.workDate.localeCompare(b.workDate)||a.personName.localeCompare(b.personName,"zh-CN",{numeric:true})||a.personId.localeCompare(b.personId));
  }
  function renderCoalRatio(scope,entityName){
    const settings=coalRatioSettings,month=settings.month||T.date().slice(0,7),year=Number(month.slice(0,4)),monthIndex=Number(month.slice(5,7))-1;
    const dateAt=(offset,day)=>{const last=new Date(Date.UTC(year,monthIndex+offset+1,0)).getUTCDate();return new Date(Date.UTC(year,monthIndex+offset,Math.min(day,last))).toISOString().slice(0,10);};
    const custom=settings.period==="custom",startDate=dateAt(0,custom?settings.startDay:1),endDate=custom?dateAt(settings.endDay<settings.startDay?1:0,settings.endDay):dateAt(0,31);
    const ratioScope={...scope,startDate,endDate,error:"",personId:scope.personId||"__all_persons__",mode:scope.mode==="equipment"&&!scope.vehicleId?"crew":scope.mode},context=haulSummaryContext(ratioScope),{totals}=haulSummaryData(ratioScope,context),percent=totals.total?(totals["煤"]/totals.total*100).toFixed(2)+"%":"—";
    const dayOptions=Array.from({length:31},(_,i)=>[String(i+1),String(i+1)+"号"]);
    return '<section class="coal-ratio-panel" aria-label="煤渣比例"><div class="coal-ratio-heading"><h2>煤渣比例</h2><span>'+esc(scope.mode==="crew"?"班组汇总":scope.mode==="person"?(scope.personId?entityName:"全员"):(scope.vehicleId?entityName:"全部设备"))+' · '+esc(startDate)+' 至 '+esc(endDate)+'</span></div><div class="coal-ratio-values"><div><span>渣车数</span><strong>'+totals["渣"]+'<small> 车</small></strong></div><div><span>煤车数</span><strong>'+totals["煤"]+'<small> 车</small></strong></div><div><span>煤占总车数</span><strong>'+percent+'</strong></div></div><div class="coal-ratio-controls">'+select("coalRatioPeriod","统计周期",[["natural","自然月"],["custom","自定义每月几号到几号"]],settings.period)+input("coalRatioMonth","统计月份",month,"month")+(custom?select("coalRatioStartDay","每月开始日",dayOptions,settings.startDay)+select("coalRatioEndDay","每月结束日",dayOptions,settings.endDay):"")+'</div><p class="help">煤占比＝煤车数 ÷ 总车数；总车数含渣、煤、只记车数及历史未分类，每趟只计一次。'+(totals.total?"":"暂无有效车次，比例显示“—”。")+(custom?"结束日小于开始日时跨至次月，月份没有对应日期时取当月最后一天。":"自然月按当月1日至最后一天统计。")+'</p></section>';
  }
  function renderHaulSummary(){
    if(role!=="dispatch")return "";
    const scope=haulSummaryScope(),context=haulSummaryContext(scope),options=haulSummaryOptions(scope,context),{days,totals}=haulSummaryData(scope,context),today=T.date(),showOther=totals.otherCrew>0,showUnknown=totals.unknown>0;
    haulSummaryRenderedToday=today;
    const entityId=scope.mode==="person"?scope.personId:scope.vehicleId,entityName=scope.mode==="person"?(entityId==="__all_persons__"?"全员":haulSummaryPersonGroup(scope)||context.people.get(entityId)?.name||options.find(([id])=>id===entityId)?.[1]||entityId):(entityId==="__all_excavators__"?"全部挖机":entityId==="__all_trucks__"?"全部汽车":context.vehicles.get(entityId)?.code||context.vehicles.get(entityId)?.name||options.find(([id])=>id===entityId)?.[1]||entityId);
    const modeLabel=scope.mode==="crew"?"生产A组 / 生产B组":scope.mode==="person"?(entityId?"人员："+entityName:"按人名逐日统计"):(entityId?"设备："+entityName:"按设备逐日统计");
    $("subtitle").textContent=scope.startDate+" 至 "+scope.endDate+" · "+modeLabel;
    const tabs='<div class="haul-summary-mode-tabs" role="group" aria-label="逐日统计方式">'+[["crew","班组逐日统计"],["person","按人名逐日统计"],["equipment","按设备逐日统计"]].map(([key,label])=>'<button type="button" data-action="haulSummaryMode" data-id="'+key+'" class="'+(scope.mode===key?"":"soft")+'" aria-pressed="'+(scope.mode===key)+'">'+label+'</button>').join("")+'</div>';
    const subject=scope.mode==="person"?select("haulSummaryPerson","人员",[["","请选择人员（选填）"],["__all_persons__","全员"],["__crew_a_persons__","生产A组"],["__crew_b_persons__","生产B组"],...options],scope.personId):scope.mode==="equipment"?select("haulSummaryVehicle","设备",[["","请选择设备（选填）"],["__all_excavators__","全部挖机"],["__all_trucks__","全部汽车"],...options],scope.vehicleId):"";
    const ratioPanel=renderCoalRatio(scope,entityName);
    const filters='<div class="haul-summary-filters haul-month-filter">'+subject+input("haulSummaryStartDate","开始日期",scope.startDate,"date")+input("haulSummaryEndDate","结束日期",scope.endDate,"date")+'</div>',toolbar='<div class="haul-summary-toolbar">'+tabs+filters+'</div>';
    if(scope.error)return '<section class="haul-summary">'+ratioPanel+toolbar+'<section class="panel"><p class="haul-summary-range-error" role="alert">'+esc(scope.error)+'</p></section></section>';
    if(scope.mode!=="crew"&&!entityId)return '<section class="haul-summary">'+ratioPanel+toolbar+'<section class="panel"><p class="help">请选择'+(scope.mode==="person"?"人员":"设备")+'，查看所选日期范围每天的车数及区间合计。</p></section></section>';
    let line;
    if(scope.mode==="crew")line='<span>生产A组 <b>'+totals.crewA+'</b> 车</span><span>生产B组 <b>'+totals.crewB+'</b> 车</span>'+(showOther?'<span>其他/未归属 <b>'+totals.otherCrew+'</b> 车</span>':"")+'<strong>区间合计 <b>'+totals.total+'</b> 车</strong>';
    else if(scope.mode==="person")line='<span>'+esc(entityName)+'</span><span>拉运 <b>'+totals.haul+'</b> 车</span><span>装车 <b>'+totals.load+'</b> 车</span><strong>区间合计 <b>'+totals.total+'</b> 车</strong>';
    else line='<span>'+esc(entityName)+'</span>'+T.materialTypes.map(name=>'<span>'+esc(name)+' <b>'+totals[name]+'</b> 车</span>').join("")+'<strong>区间合计 <b>'+totals.total+'</b> 车</strong>';
    const roleColumns=scope.mode==="crew"?[["crewA","生产A组"],["crewB","生产B组"],...(showOther?[["otherCrew","其他/未归属"]]:[])]:scope.mode==="person"?[["haul","拉运车数"],["load","装车车数"]]:[];
    const columns=[...roleColumns,...T.materialTypes.map(name=>[name,name]),...(showUnknown?[["unknown","历史未分类"]]:[])];
    const allPeople=scope.mode==="person"&&haulSummaryPersonMulti(scope),displayRows=allPeople?haulSummaryPeopleRows(context,options,scope):days;
    haulSummaryExportData={scope,modeLabel,allPeople,totals,columns,context,options,rows:displayRows.map(row=>({...row,future:row.workDate>today&&row.total===0}))};
    $("exportHaulSummary").disabled=false;
    const head='<th>日期</th>'+(allPeople?'<th>姓名</th>':"")+columns.map(([key,label])=>'<th class="haul-summary-number'+(["crewA","crewB"].includes(key)?' haul-crew-heading':'')+'">'+esc(label)+'</th>').join("")+'<th class="haul-summary-number">当日合计</th>';
    const body=displayRows.map(row=>{
      const future=row.workDate>today&&row.total===0,value=n=>future?"—":n;
      return '<tr class="'+(future?"haul-summary-future":row.workDate===today?"haul-summary-today":"")+'"><td>'+esc(row.workDate)+'</td>'+(allPeople?'<td>'+esc(row.personName)+'</td>':"")+columns.map(([key])=>'<td class="haul-summary-number">'+(scope.mode==="crew"&&["crewA","crewB"].includes(key)?'<button type="button" class="haul-summary-day-link" data-action="haulSummaryDay" data-id="'+esc(row.workDate+"|"+(key==="crewA"?"生产A组":"生产B组"))+'" aria-label="'+esc(row.workDate+" "+(key==="crewA"?"生产A组":"生产B组")+" "+row[key]+"车，查看当天任务看板")+'">'+value(row[key])+'</button>':value(row[key]))+'</td>').join("")+'<td class="haul-summary-number haul-summary-total">'+value(row.total)+'</td></tr>';
    }).join("");
    const footer='<tr><td'+(allPeople?' colspan="2"':"")+'>'+(allPeople?'区间合计（车次去重）':'区间合计')+'</td>'+columns.map(([key])=>'<td class="haul-summary-number">'+totals[key]+'</td>').join("")+'<td class="haul-summary-number">'+totals.total+'</td></tr>';
    return '<section class="haul-summary">'+ratioPanel+toolbar+'<div class="haul-summary-line haul-crew-strip">'+line+'</div><section class="panel"><div class="table-wrap"><table class="haul-summary-table haul-crew-month-table" aria-label="'+esc(haulSummaryTitles[scope.mode])+'"><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody><tfoot>'+footer+'</tfoot></table></div></section><p class="help">单位：车。夜班按开始日归属，跨月仍计入开始日所在月份。仅统计已完成的真实定位车次，非卸载区完成同样计入；每趟在合计中只计一次。未来日期暂无记录时显示“—”。'+(scope.mode==="person"?' 拉运按实际汽车驾驶员统计，装车按实际装载挖机及其对应司机统计，包含临时挖机装载。':scope.mode==="equipment"?' 按车次记录中的实际汽车或实际装载挖机统计，包含临时挖机装载。':"")+(allPeople?' 所选范围人员按日期和姓名逐行展示，含零车数司机；同一趟分别归属汽车司机和挖机司机，个人行不可相加作为总车数，底部合计按实际车次去重。':"")+(scope.mode==="crew"&&showOther?' 旧记录的其他或未归属班组车次单独列出。':"")+(showUnknown?' 旧物料未归入统一三类时单独显示“历史未分类”。':"")+'</p></section>';
  }
  function assignmentCards(rows,own=false){return rows.length?rows.map(r=>'<section class="panel"><div class="panel-head"><h2>'+esc(r.workDate||"日期未设置")+' · '+esc(r.shiftName)+'</h2>'+pill(states[r.status]||r.status,r.status==="draft")+'</div><p><strong>'+esc(nameOf(r.personId))+'</strong> · '+esc(vehicleName(r.vehicleId))+'</p><p class="muted">'+(r.kind==="driver"?'绑定挖机：'+esc(vehicleName(r.excavatorId)):'挖机操作人员排班')+'</p>'+(r.note?'<p class="muted">'+esc(r.note)+'</p>':'')+'<div class="actions">'+(own&&r.status==="active"&&!session()?button("openShift",r.id,"接班并检查设备",""):"")+(role==="dispatch"&&!d.shifts.some(s=>s.assignmentId===r.id)?button("assignment",r.id,"编辑"):'')+(role==="dispatch"&&r.status==="draft"?button("activateAssignment",r.id,"启用排班",""):'')+(role==="dispatch"&&["draft","active"].includes(r.status)?button("cancelAssignment",r.id,"取消排班","danger"):'')+'</div></section>').join(""):(own?empty("尚无可用排班，请等待调度分配车辆和班次"):"");}

  function renderShiftButtons(){
    const current=T.currentShift(d.shiftTimes);if(!selectedDispatchShift)selectedDispatchShift=current||"白班";shiftMinute=Math.floor(Date.now()/60000);
    return '<div id="dispatchShiftPicker" class="shift-picker" role="group" aria-label="白夜班选择">'+(dispatchShiftLocked?[selectedDispatchShift]:["白班","夜班"]).map(name=>{const times=d.shiftTimes[name],overnight=times.end<times.start;return '<section class="shift-card'+(name===current?' current-shift':'')+(name===selectedDispatchShift?' selected-shift':'')+'"><button type="button" class="shift-name" data-action="selectDispatchShift" data-id="'+name+'" aria-pressed="'+(name===selectedDispatchShift)+'">'+name+(name===current?' · 当前班':'')+'</button><button type="button" class="shift-hours" data-action="editShiftTimes" data-id="'+name+'" aria-label="设置'+name+'时间">'+esc(times.start)+'—'+esc(times.end)+(overnight?' （次日结束）':'')+'</button></section>';}).join("")+'</div>';
  }
  function productionContext(){return {workDate:dispatchProductionDate||T.date(),shiftName:selectedDispatchShift,team:dispatchGroups[selectedDispatchShift]||""};}
  function eligibleForSchedule(p,c=productionContext()){try{if(!p||!window.MineLeave)return false;const w=window.MineTaskEngine.timeWindow(c.workDate,d.shiftTimes[c.shiftName]);return !window.MineLeave.schedulingConflict(p,w.startAt,w.endAt);}catch{return false;}}
  function dispatchBindingKey(){const c=productionContext();return JSON.stringify([c.workDate,c.shiftName,c.team]);}
  function publishedDispatchTask(){const c=productionContext();return d.taskReleases.find(r=>r.status==="published"&&(r.sourceDate||r.workDate)===c.workDate&&r.shiftName===c.shiftName&&r.team===c.team);}
  function dispatchPublishButton(){const release=publishedDispatchTask(),editing=release&&dispatchBindingEdits.get(dispatchBindingKey())===release.id;return button(release&&!editing?"changeTaskBinding":"publishTasks","",release&&!editing?"更改绑定":"发布任务","");}
  function productionGroups(){const c=productionContext();return d.productionGroups.filter(g=>g.workDate===c.workDate&&g.shiftName===c.shiftName&&g.team===c.team&&g.status==="draft").sort((a,b)=>Number(a.number)-Number(b.number)||String(a.createdAt||"").localeCompare(String(b.createdAt||""))||a.id.localeCompare(b.id)).map((g,index)=>({...g,number:index+1}));}
  function productionGroup(id=null){return productionGroups().find(g=>id?g.id===id:g.number===1);}
  function truckGroup(id){return productionGroups().find(g=>g.id===id||g.followingTrucks.some(t=>t.id===id));}
  function groupTitle(g){const n=g?.number||1,names=["","一","二","三","四","五","六","七","八","九","十"];const label=n<=10?names[n]:n<100?(n<20?"十":names[Math.floor(n/10)]+"十")+(n%10?names[n%10]:""):String(n);return "第"+label+"组生产设备";}
  function auxiliaryPlan(){const c=productionContext();return d.auxiliaryPlans.find(p=>p.workDate===c.workDate&&p.shiftName===c.shiftName&&p.team===c.team);}
  function draftAvailable(field,id,except){return !T.draftSlots(d,productionContext()).some(slot=>slot.id!==except&&slot[field]===id);}
  const frontLineRoles=["driver","excavator",...T.auxiliaryRoles];
  const jobName=p=>({driver:"汽车司机",excavator:"挖机司机",assistant_loader:"铲车司机",assistant_fuel:"加油车司机",assistant_water:"洒水车司机",assistant_grader:"平地机司机",assistant_dump:"排土管理员",assistant:"辅助人员"}[p.applicationRole]||p.role||"");
  function availability(v){const state=T.equipmentState(d,m,v.id),busyShift=d.shifts.find(s=>s.vehicleId===v.id&&s.status!=="closed");return {ok:state==="working"&&!busyShift&&v.status!=="作业中",label:state==="working"?(busyShift?"班次占用":v.status==="作业中"?"作业中":"可调配"):(states[state]||state)};}

  function productionZoneName(id,kind){if(!id)return "未设置";const zone=d.zones.find(z=>z.id===id);if(!zone)return "区域已失效";return zone.name+((zone.kind===kind&&zone.enabled&&T.validZone(zone))?"":"（不可用）");}
  function renderProductionRegions(g){
    const unloads=Array.isArray(g.unloadZoneIds)?g.unloadZoneIds:[];
    return '<div class="production-region-card" aria-label="生产组装卸区域"><strong>装卸区域</strong><div class="production-region-values"><p>装载区：<br>'+esc(productionZoneName(g.loadZoneId,"load"))+'</p><p>卸载区：<br>'+esc(unloads.length?unloads.map(id=>productionZoneName(id,"unload")).join("、"):"未设置")+'</p></div>'+button("productionRegions",g.id,"区域设置","region-settings-button")+'</div>';
  }
  function renderFollowingTruck(g){
    const cards=g.followingTrucks.filter(t=>t.status==="draft").map(truck=>{
      const v=vehicleOf(truck.vehicleId),p=m.people.find(p=>p.id===truck.personId),driverValid=p&&L.active(p)&&p.applicationRole==="driver"&&p.team===g.team&&eligibleForSchedule(p);
      return '<div class="production-equipment-card following-truck-card" aria-label="跟随汽车">'+button("chooseFollowingTruck",truck.id,v?(v.code||v.name||"已选汽车"):(truck.vehicleId?"汽车失效，请重选":"选择汽车"),"equipment-choice equipment-label")+button("chooseFollowingDriver",truck.id,p?(p.name+(driverValid?"":"（需重选）")):(truck.personId?"司机失效，请重选":"选择司机"),"equipment-choice driver-label")+button("removeFollowingTruck",truck.id,"移除","equipment-remove")+'</div>';
    }).join("");
    return cards+'<button type="button" class="production-equipment-card following-truck-card add-following-truck" data-action="addFollowingTruck" data-id="'+esc(g.id)+'" aria-label="新增一组跟随汽车" title="新增跟随汽车">＋</button>'+renderProductionRegions(g);
  }
  function renderProductionGroup(g){
    if(!dispatchShiftLocked||timeConfiguredShift!==selectedDispatchShift||!dispatchGroups[selectedDispatchShift])return "";
    const v=g?vehicleOf(g.vehicleId):null,p=g?m.people.find(p=>p.id===g.personId):null;
    const driverValid=p&&L.active(p)&&p.applicationRole==="excavator"&&p.team===g.team&&eligibleForSchedule(p),ready=g&&T.isExcavator(v)&&driverValid;
    return '<section class="production-group-section"><div class="actions">'+button("openProductionGroup",g?.id||"",groupTitle(g),"")+'</div>'+(g?'<div class="production-equipment-row"><div class="production-equipment-card" aria-label="'+esc(groupTitle(g))+'挖机">'+button("chooseProductionEquipment",g.id,v?(v.code||v.name||"已选设备"):(g.vehicleId?"设备失效，请重选":"选择设备"),"equipment-choice equipment-label")+button("chooseProductionDriver",g.id,p?(p.name+(driverValid?"":"（需重选）")):(g.personId?"司机失效，请重选":"选择司机"),"equipment-choice driver-label")+button("removeProductionGroup",g.id,"移除","equipment-remove")+'</div>'+(ready?renderFollowingTruck(g):"")+'</div>':"")+'</section>';
  }
  function renderAssignments(){
    const group=dispatchGroups[selectedDispatchShift]||"";
    return renderShiftButtons()+(dispatchShiftLocked&&timeConfiguredShift===selectedDispatchShift?'<div class="actions" style="margin-bottom:20px">'+button("selectDispatchGroup",selectedDispatchShift,group?'选择班组：'+group:'选择班组',"")+'</div>':"")+renderDispatchLower();
  }
  function renderDispatchLower(){
    if(!dispatchShiftLocked||timeConfiguredShift!==selectedDispatchShift||!dispatchGroups[selectedDispatchShift])return "";
    const groups=productionGroups();
    return (groups.length?groups.map(renderProductionGroup).join(""):renderProductionGroup(null))+(groups.length?'<button type="button" class="add-production-group" data-action="addProductionGroup">＋ '+esc(groupTitle({number:groups.length+1}))+'</button>':"")+renderAuxiliaryVehicles()+renderUnusedResources()+'<div class="publish-task-bar">'+dispatchPublishButton()+'</div>';
  }
  function renderAuxiliaryVehicles(){
    const cards=(auxiliaryPlan()?.cards||[]).filter(c=>c.status==="draft");
    return '<section class="dispatch-lower-section"><h3>辅助车辆</h3><div class="auxiliary-vehicle-row">'+cards.map(card=>{
      const v=vehicleOf(card.vehicleId),p=m.people.find(p=>p.id===card.personId),valid=p&&L.active(p)&&T.auxiliaryRoles.includes(p.applicationRole)&&p.team===productionContext().team&&eligibleForSchedule(p);
      return '<div class="auxiliary-item"><div class="production-equipment-card auxiliary-equipment-card">'+button("auxEquipment",card.id,v?(v.code||v.name||"已选设备"):(card.vehicleId?"设备失效，请重选":"选择设备"),"equipment-choice equipment-label")+button("auxDriver",card.id,p?(p.name+(valid?"":"（需重选）")):(card.personId?"人员失效，请重选":"选择司机"),"equipment-choice driver-label")+button("auxRemove",card.id,"移除","equipment-remove")+'</div>'+button("auxContent",card.id,"作业内容"+(card.content?" · 已设置":""),"auxiliary-content-button")+'</div>';
    }).join("")+'<button type="button" class="auxiliary-add" data-action="auxAdd" aria-label="增加辅助车辆">＋</button></div></section>';
  }
  function renderUnusedResources(){
    const team=productionContext().team,vehicles=m.vehicles.filter(v=>draftAvailable("vehicleId",v.id,null)),people=m.people.filter(p=>L.active(p)&&p.team===team&&frontLineRoles.includes(p.applicationRole)&&eligibleForSchedule(p)&&draftAvailable("personId",p.id,null));
    return '<section class="dispatch-lower-section"><h3>未进入分配的车辆 / 设备</h3><p class="help">绿色为可调配；红色为维修、保养、停用、暂停或作业占用。点击编号查看信息。</p><div class="unused-resource-list">'+(vehicles.map(v=>{const a=availability(v);return button("unusedVehicleInfo",v.id,(v.code||v.name||v.id)+" · "+a.label,"resource-chip"+(a.ok?"":" unavailable"));}).join("")||'<span class="muted">暂无未分配设备</span>')+'</div></section><section class="dispatch-lower-section"><h3>未进入分配的人员</h3><p class="help">仅显示所选班组未分配的一线人员，已批准请假且时段冲突的人员不参与排班。</p><div class="unused-resource-list">'+(people.map(p=>{const busy=d.shifts.some(s=>s.personId===p.id&&s.status!=="closed");return button("unusedPersonInfo",p.id,p.name+" · "+jobName(p)+" · "+p.team+" · "+(busy?"班次占用":"空闲"),"resource-chip"+(busy?" unavailable":""));}).join("")||'<span class="muted">暂无未分配人员</span>')+'</div></section>';
  }
  const metres=value=>Number.isFinite(value)?value.toFixed(3):"未设置";
  function utmSummary(z){const c=window.MineUTM.zoneCoordinates(z);return "WGS84 / UTM "+(c.zone==null?"分区未设置":c.zone+(c.hemisphere||""))+" · X "+metres(c.easting)+" / Y "+metres(c.northing)+" 米";}
  function invalidateZoneFix(target){
    const form=$("editForm");if(!form.contains(target)||!form.querySelector('[name="centerAccuracy"]'))return;
    if(["easting","northing","utmZone","utmHemisphere"].includes(target.name)){zoneFixRequest++;zoneCenterFix=null;form.querySelector('[name="centerAccuracy"]').value="";$("zoneFixInfo").textContent="平面坐标或分区已手动修改，原定位精度已清除；可重新获取当前位置。";}
  }
  function renderZones(){return '<div class="panel-head"><p class="muted">UTM平面坐标与半径定义圆形区域。装载区通用，车次归属司机绑定或临时选择的挖机；卸载区决定物料。</p>'+button("zone","","新增GPS区域","")+'</div><section class="panel">'+mapSvg(d.zones.filter(T.validZone),null)+'</section>'+(d.zones.length?'<div class="cards">'+d.zones.map(z=>'<section class="panel"><div class="panel-head"><h2>'+esc(z.name)+'</h2>'+pill(z.enabled?'已启用':'草稿',!z.enabled)+'</div><p>'+esc(z.kind==="load"?'通用装载区':'卸载区 · '+(z.material||'未分类'))+'</p><p class="muted">'+esc(utmSummary(z))+'</p><p class="muted">区域半径 '+esc(z.radius??'未设置')+' 米</p><p class="muted">中心定位精度：'+(z.centerFix?('约 ±'+esc(z.centerFix.accuracy)+' 米 · '+esc(when(z.centerFix.ts))):'未获取')+'</p><div class="actions">'+button("zone",z.id,"编辑")+button("toggleZone",z.id,z.enabled?'停用区域':'启用区域',z.enabled?'amber':'')+'</div></section>').join("")+'</div>':empty("尚未设置GPS作业区域"));}
  function tripTable(rows){return rows.length?'<div class="table-wrap"><table><thead><tr><th>班次 / 司机</th><th>车辆 / 实际挖机</th><th>物料 / 卸料</th><th>来源 / 状态</th><th>操作</th></tr></thead><tbody>'+rows.map(t=>'<tr><td>'+esc(t.workDate)+' '+esc(t.shiftName)+'<small>'+esc(t.personName)+'</small></td><td><strong>'+esc(t.vehicleCode)+'</strong><small>'+esc(t.excavatorCode)+(t.isTemporary?' · 临时装载':'')+'</small></td><td>'+esc(t.material||'在途待确定')+'<small>'+esc(t.method==="outside"?'非卸载区卸料':t.unloadZone?.name||'—')+'</small></td><td>'+pill(modeName(t),t.mode==="simulation")+'<small>'+esc(states[t.status]||t.status)+'</small></td><td><div class="actions">'+button("tripDetails",t.id,"详情")+(role==="dispatch"&&t.status!=="voided"?button("voidTrip",t.id,t.status==="completed"?'冲销':'作废',"danger"):'')+(role==="dispatch"&&t.status==="completed"?button("correctMaterial",t.id,"物料分类"):'')+'</div></td></tr>').join("")+'</tbody></table></div>':empty("暂无运输车次");}
  function renderRecords(){const rows=roleTrips().filter(t=>!recordSearch||[t.personName,t.vehicleCode,t.excavatorCode,t.material,t.workDate].some(v=>String(v||"").toLowerCase().includes(recordSearch.toLowerCase())));return summary(roleTrips())+'<div class="panel-head"><input id="recordSearch" style="max-width:350px" placeholder="搜索日期、司机、车辆、挖机或物料" value="'+esc(recordSearch)+'">'+button("exportTrips","","导出车次明细")+'</div><section class="panel">'+tripTable(rows)+'</section>';}
  function materialSummary(rows){const grouped={};rows.filter(t=>t.status==="completed"&&t.mode==="gps").forEach(t=>{const key=t.material||"未分类";grouped[key]=(grouped[key]||0)+1;});return Object.entries(grouped).length?Object.entries(grouped).map(([name,n])=>'<div class="row"><strong>'+esc(name)+'</strong><b>'+n+' 车</b></div>').join(""):empty("暂无真实定位已完成车次");}
  function inspectionPanel(s){const previous=esc(s.previousDriverName||"未记录");return '<section class="panel"><h2>使用前检查</h2><p>设备：<strong>'+esc(s.vehicleCode)+'</strong></p><p class="muted">上一实际班次驾驶员：'+previous+'。新发现的异常直接关联该班次；已经登记的旧异常可选择延续记录。</p><div class="actions">'+button("normalInspection","","检查无异常，开始作业","")+button("abnormalInspection","","拍照上报异常","amber")+'</div></section>';}
  function renderDriver(){const s=session();if(!s)return '<section class="hero"><small>DRIVER</small><h2>开始你的驾驶班次</h2><p>调度分配车辆与挖机后，在此接班并检查设备。</p></section>'+assignmentCards(activeAssignments(),true);
    const r=d.assignments.find(r=>r.id===s.assignmentId),t=currentTrip(),excId=t?.excavatorId||s.tempExcavatorId||r?.excavatorId,excState=excId?T.equipmentState(d,m,excId):"missing";const stage=s.status!=="working"?0:!t?1:t.status==="loaded"?1:t.status==="hauling"?2:2;
    return '<section class="hero"><div class="panel-head">'+pill(s.workDate+' · '+s.shiftName)+' '+devicePill(s.vehicleId)+'</div><h2>'+esc(s.vehicleCode)+'</h2><p>装载挖机：'+esc(vehicleName(excId))+(t?.isTemporary||s.tempExcavatorId?' · 本趟临时':' · 排班绑定')+'</p><p class="muted">登记司机：'+esc(s.personName)+' · 班次开始 '+esc(when(s.openedAt))+'</p></section>'+summary(currentStatsTrips())+'<div class="steps">'+['使用前检查','装载区停留','运输到卸载区','卸料计车'].map((text,i)=>'<div class="step '+(i===stage?'current':i<stage?'done':'')+'">'+(i+1)+'. '+text+'</div>').join("")+'</div>'+(s.status==="checking"?inspectionPanel(s):s.status==="checked"?'<section class="panel"><h2>异常已上报并暂停设备</h2><p class="muted">责任关联已直接记录，无需调度审批。设备异常处理完成后再恢复作业。</p><div class="actions">'+button("resumeDevice",s.vehicleId,"异常处理完成，恢复作业","")+button("go-faults","","查看异常")+'</div></section>':'')+(s.status==="working"?'<div class="grid"><section class="panel"><div class="panel-head"><h2>本趟运输</h2>'+pill(t?states[t.status]:'等待进入装载区',t?.status==="review")+'</div>'+(t?'<p><strong>'+esc(t.excavatorCode)+'</strong> · '+esc(modeName(t))+'</p><p class="muted">装载识别时间 '+esc(when(t.loadedAt))+'；车次 '+esc(t.id.slice(0,8))+'</p>'+(t.status==="review"?'<div class="banner">'+esc(t.reviewReason)+'<div class="actions">'+button("resumeTrip",t.id,"仍在运输本趟，恢复定位","")+'</div></div>':'')+'<div class="actions">'+button("outsideUnload",t.id,"非卸载区卸料","")+button("tripDetails",t.id,"车次详情")+button("voidTrip",t.id,"作废未完成车次","danger")+'</div>':'<p class="muted">有效停留装载区后形成一趟运输，离开装载区并有效到达卸载区后自动计1车。每个车次同时归入车辆和实际装载挖机。</p>')+(excState!=="working"&&!t?'<div class="banner">原装载挖机'+esc(states[excState]||excState)+'，可选择其他可用挖机临时装载。</div>':'')+'<div class="actions">'+(!t?button("temporaryExcavator","","临时非绑定挖机装车"):"")+'</div></section><section class="panel"><h2>定位与作业区域</h2>'+positionPanel(s,t)+'</section></div>':'')+'<div class="sticky-actions actions">'+(s.status==="working"?(T.working(d,m,s.vehicleId)?(tracking?button("stopGPS","","停止定位","amber"):button("startGPS","","开启实时定位","")+button("simulation","","输入模拟位置")+(s.lastPoint?.mode==="simulation"?button("repeatSimulation","","再次提交模拟位置"):"")):button("resumeDevice",s.vehicleId,"处理完成，恢复设备",""))+button("pauseDevice",s.vehicleId,"暂停设备","amber"):'')+button("closeShift",s.id,"结束本班")+'</div>';
  }
  function positionPanel(s,t){const p=s.lastPoint;const zones=t?[t.loadZone,...t.unloadZones]:d.zones.filter(z=>z.enabled);return (s.locationWarning?'<div class="banner">'+esc(s.locationWarning)+'</div>':'')+'<div class="position"><div><span>位置来源</span>'+(p?(p.mode==="gps"?'真实定位':'位置模拟'):'尚未定位')+'</div><div><span>精度 / 最近定位</span>'+(p?Math.round(p.accuracy)+' 米 · '+esc(when(p.ts)):'—')+'</div><div><span>纬度</span>'+esc(p?.lat??'—')+'</div><div><span>经度</span>'+esc(p?.lng??'—')+'</div></div><div style="margin-top:12px">'+mapSvg(zones,p)+'</div><p class="help">有效停留 '+esc((t?.settings||d.settings).dwellSeconds)+' 秒，精度不差于 '+esc((t?.settings||d.settings).maxAccuracy)+' 米。锁屏或定位中断不自动补造车次。</p>'+(s.candidate?'<p class="muted">正在识别装载区停留，起始 '+esc(when(s.candidate.since))+'</p>':'')+(t?.unloadCandidate?'<p class="muted">正在识别卸载区停留，起始 '+esc(when(t.unloadCandidate.since))+'</p>':'');}
  function renderExcavator(){const s=session();if(!s)return '<section class="hero"><small>EXCAVATOR</small><h2>开始你的挖机班次</h2><p>接班检查后查看跟随车辆和实际装载车次。</p></section>'+assignmentCards(activeAssignments(),true);
    const rows=currentStatsTrips(),bound=d.assignments.filter(r=>r.kind==="driver"&&r.status==="active"&&r.excavatorId===s.vehicleId),temporary=d.shifts.filter(v=>v.kind==="driver"&&v.status!=="closed"&&(v.tempExcavatorId===s.vehicleId||d.trips.some(t=>t.shiftId===v.id&&t.excavatorId===s.vehicleId&&T.liveTrip(t))));const following=new Map();bound.forEach(r=>following.set(r.vehicleId,{driver:nameOf(r.personId),vehicle:vehicleName(r.vehicleId),kind:"排班绑定"}));temporary.forEach(v=>following.set(v.vehicleId,{driver:v.personName,vehicle:v.vehicleCode,kind:"临时装载 / 在途"}));
    return '<section class="hero">'+pill(s.workDate+' · '+s.shiftName)+'<h2>'+esc(s.vehicleCode)+'</h2><p>'+esc(s.personName)+' · '+esc(states[T.equipmentState(d,m,s.vehicleId)])+'</p></section>'+summary(rows)+(s.status==="checking"?inspectionPanel(s):s.status==="checked"?'<section class="panel"><h2>异常已上报，设备暂停</h2><div class="actions">'+button("resumeDevice",s.vehicleId,"异常处理完成，恢复作业","")+button("go-faults","","查看异常")+'</div></section>':'')+'<div class="grid"><section class="panel"><h2>跟随车辆</h2>'+(following.size?[...following.values()].map(v=>'<div class="row"><div><strong>'+esc(v.vehicle)+'</strong><small>'+esc(v.driver)+'</small></div>'+pill(v.kind,v.kind.includes('临时'))+'</div>').join(""):empty("暂无绑定或临时跟随车辆"))+'</section><section class="panel"><h2>本班有效车次按物料汇总</h2>'+materialSummary(rows)+'<p class="help">仅已完成卸料的真实定位车次计入正式数量，位置模拟与在途单独显示。</p></section></div><section class="panel"><h2>实际装载车次</h2>'+tripTable(rows)+'</section><div class="sticky-actions actions">'+(s.status!=="checking"?button("pauseDevice",s.vehicleId,"暂停 / 维修 / 保养","amber")+button("resumeDevice",s.vehicleId,"恢复作业",""):'')+button("closeShift",s.id,"结束本班")+'</div>';
  }
  function renderDevices(){return '<section class="panel"><h2>设备作业状态</h2><div class="table-wrap"><table><thead><tr><th>设备</th><th>主档案状态</th><th>运输作业状态</th><th>操作</th></tr></thead><tbody>'+m.vehicles.map(v=>'<tr><td><strong>'+esc(v.code)+'</strong><small>'+esc(v.category||v.model)+'</small></td><td>'+esc(v.status)+'</td><td>'+devicePill(v.id)+'</td><td><div class="actions">'+button("pauseDevice",v.id,"暂停 / 维修 / 保养","amber")+button("resumeDevice",v.id,"恢复作业")+'</div></td></tr>').join("")+'</tbody></table></div></section>';}
  function renderFaults(){const faults=role==="dispatch"?d.faults:d.faults.filter(f=>f.reporterId===person.id||f.responsibleId===person.id||machineIds().includes(f.vehicleId));return '<div class="banner">异常责任直接关联同设备上一实际作业班次驾驶员。未记录上班驾驶员时如实显示未记录；延续已登记异常不重复生成责任。</div>'+(faults.length?faults.map(f=>'<section class="panel"><div class="panel-head"><h2>'+esc(f.vehicleCode)+'</h2>'+pill(f.status==="open"?'异常未处理':'已处理',f.status==="open")+'</div><p><strong>关联责任驾驶员：'+esc(f.responsibleName||'未记录')+'</strong></p><p class="muted">上报人 '+esc(f.reporterName)+' · '+esc(when(f.reportedAt))+'</p><p>'+esc(f.note||'未填写说明')+'</p>'+(f.resolution?'<p class="muted">处理记录：'+esc(f.resolution)+'</p>':'')+'<div class="actions">'+button("faultDetails",f.id,"照片与检查记录")+'</div></section>').join(""):empty("暂无异常责任关联记录"));}
  function renderSessions(){const rows=role==="dispatch"?d.shifts:d.shifts.filter(s=>s.personId===person.id);return '<section class="panel"><h2>实际使用班次</h2>'+ (rows.length?rows.map(s=>'<div class="row"><div><strong>'+esc(s.vehicleCode)+' · '+esc(s.personName)+'</strong><small>'+esc(s.workDate)+' '+esc(s.shiftName)+' · '+esc(when(s.openedAt))+'</small><small>上一实际班次驾驶员：'+esc(s.previousDriverName||'未记录')+'</small></div><div>'+pill(states[s.status]||s.status,s.status!=="closed")+(role==="dispatch"&&s.status!=="closed"?'<div class="actions">'+button("forceCloseShift",s.id,"结束班次占用","amber")+'</div>':'')+'</div></div>').join(""):empty())+'</section>';}
  function renderMessages(){return window.MineTransportChat?MineTransportChat.html():empty("聊天组件尚未加载，请刷新页面");}
  function renderSettings(){return '<section class="panel"><h2>GPS识别规则</h2><p class="muted">规则修改仅用于后续装载车次，在途车次继续使用开始时的快照。空值保留原设置。</p><div class="position"><div><span>有效停留</span>'+d.settings.dwellSeconds+' 秒</div><div><span>可接受定位误差</span>'+d.settings.maxAccuracy+' 米</div><div><span>定位间断阈值</span>'+d.settings.gapSeconds+' 秒</div><div><span>区域退出缓冲</span>'+d.settings.exitMargin+' 米</div><div><span>明显跳点速度阈值</span>'+d.settings.maxSpeedKmh+' km/h</div></div><div class="actions">'+button("settings","","调整定位规则","")+'</div></section>';}
  function renderAudit(){return '<section class="panel"><h2>操作记录</h2><div class="table-wrap"><table><thead><tr><th>时间</th><th>操作</th><th>说明</th><th>操作者</th></tr></thead><tbody>'+d.audit.map(v=>'<tr><td>'+esc(when(v.at))+'</td><td>'+esc(v.type)+'</td><td>'+esc(v.detail)+'</td><td>'+esc(v.actor)+'</td></tr>').join("")+'</tbody></table></div></section>';}
  function mapSvg(zones,point){const valid=zones.filter(T.validZone);if(!valid.length&&!point)return empty("尚未设置有效区域或获得位置");const latitude=(point?.lat??valid[0]?.lat??0)*Math.PI/180;const origin=point||valid[0],scaleX=111320*Math.max(.01,Math.cos(latitude));const projected=valid.map(z=>({...z,x:(z.lng-origin.lng)*scaleX,y:-(z.lat-origin.lat)*111320}));const minX=Math.min(-50,...projected.map(z=>z.x-z.radius)),maxX=Math.max(50,...projected.map(z=>z.x+z.radius)),minY=Math.min(-50,...projected.map(z=>z.y-z.radius)),maxY=Math.max(50,...projected.map(z=>z.y+z.radius));const scale=Math.min(540/(maxX-minX||1),190/(maxY-minY||1)),x=v=>30+(v-minX)*scale,y=v=>25+(v-minY)*scale;return '<svg class="gps-map" viewBox="0 0 600 250" role="img" aria-label="GPS作业区域相对位置示意">'+projected.map(z=>'<circle cx="'+x(z.x)+'" cy="'+y(z.y)+'" r="'+Math.max(3,z.radius*scale)+'" fill="'+(z.kind==="load"?'#176b4a18':'#c79b1e1c')+'" stroke="'+(z.kind==="load"?'#176b4a':'#b78b16')+'" stroke-dasharray="'+(z.enabled?'0':'4 3')+'"/><text x="'+x(z.x)+'" y="'+(y(z.y)-4)+'" text-anchor="middle" fill="#344c3d" font-size="10">'+esc(z.name)+'</text>').join("")+(point?'<circle cx="'+x(0)+'" cy="'+y(0)+'" r="5" fill="#2563eb"/><text x="'+x(0)+'" y="'+(y(0)+17)+'" font-size="10" text-anchor="middle" fill="#2563eb">最近位置</text>':'')+'</svg><div class="map-legend"><span><i style="background:#176b4a"></i>装载区</span><span><i style="background:#b78b16"></i>卸载区</span><span>相对位置示意，不含道路底图</span></div>';}
  function peopleOptions(kind){return [["","暂未选择人员"],...m.people.filter(p=>L.active(p)&&p.applicationRole===kind).map(p=>[p.id,p.name+' / '+p.id])];}
  function vehicleOptions(kind){return [["","暂未选择设备"],...m.vehicles.filter(v=>T.isExcavator(v)===(kind==="excavator")).map(v=>[v.id,v.code+' / '+(v.name||v.category||v.model||'')])];}
  function optionsHtml(options,value){return options.map(([v,label])=>'<option value="'+esc(v)+'"'+(v===value?' selected':'')+'>'+esc(label)+'</option>').join("");}
  function syncAssignmentFields(){const f=$("editForm"),kind=f.querySelector('[name="kind"]')?.value;if(!kind)return;const person=f.querySelector('[name="personId"]'),vehicle=f.querySelector('[name="vehicleId"]');const oldPerson=person.value,oldVehicle=vehicle.value;person.innerHTML=optionsHtml(peopleOptions(kind),oldPerson);vehicle.innerHTML=optionsHtml(vehicleOptions(kind),oldVehicle);$("bindingField").hidden=kind!=="driver";}
  function syncZoneFields(){const kind=$("editForm").querySelector('[name="zoneKind"]')?.value;if(!kind)return;$("zoneMaterial").hidden=kind!=="unload";}
  function assignmentForm(key){const r=d.assignments.find(v=>v.id===key),kind=r?.kind||"driver";show(r?'编辑排班草稿':'新增白夜班排班','<p class="help">可先保存草稿；启用时检查人员、设备、日期与分配冲突。</p><div class="form-grid">'+select("kind","岗位",[["driver","汽车司机"],["excavator","挖机操作人员"]],kind)+input("workDate","排班日期",r?.workDate??T.date(),"date")+select("shiftName","班别",[["白班","白班"],["夜班","夜班"]],r?.shiftName||"白班")+select("personId","人员",peopleOptions(kind),r?.personId||"")+select("vehicleId","驾驶设备",vehicleOptions(kind),r?.vehicleId||"")+'<div id="bindingField">'+select("excavatorId","绑定装载挖机",vehicleOptions("excavator"),r?.excavatorId||"")+'</div></div>'+note("排班说明（选填）",r?.note||""),f=>operate("assignment",{id:key||null,kind:f.get("kind"),workDate:f.get("workDate"),shiftName:f.get("shiftName"),personId:f.get("personId"),vehicleId:f.get("vehicleId"),excavatorId:f.get("excavatorId"),note:f.get("note")}),"保存草稿");syncAssignmentFields();}
  function zoneForm(key){
    const z=d.zones.find(v=>v.id===key),c=z?window.MineUTM.zoneCoordinates(z):{};
    zoneCenterFix=z?.centerFix&&Number.isFinite(z.lat)&&Number.isFinite(z.lng)&&T.distance(z.centerFix,z)<=0.02?{...z.centerFix}:null;
    show(z?'编辑GPS区域':'新增GPS区域','<p class="help">坐标系：WGS84 / UTM；X为东向，Y为北向，单位米。可先保存草稿，设置有效位置和半径后启用。</p><div class="form-grid">'+input("name","区域名称",z?.name||"","text",'maxlength="60"')+select("zoneKind","区域用途",[["load","装载区"],["unload","卸载区"]],z?.kind||"load")+'<div id="zoneMaterial">'+materialSelect("卸载物料类型",z?.material||"")+materialHelp+'</div>'+input("utmZone","UTM分区（1–60）",c.zone??"","number",'min="1" max="60" step="1"')+select("utmHemisphere","半球",[["","请选择（选填）"],["N","北半球 N"],["S","南半球 S"]],c.hemisphere||"")+input("easting","横坐标 X（东向，米）",Number.isFinite(c.easting)?c.easting.toFixed(3):"","number",'step="any" min="0" max="1000000"')+input("northing","纵坐标 Y（北向，米）",Number.isFinite(c.northing)?c.northing.toFixed(3):"","number",'step="any" min="0" max="10000000"')+input("radius","区域半径（米）",z?.radius??100,"number",'min="1" max="100000" step="any"')+input("centerAccuracy","定位精度（米）",zoneCenterFix?.accuracy??"","number",'readonly placeholder="获取当前位置后自动显示"')+'</div><p id="zoneFixInfo" class="help">'+(zoneCenterFix?'采集时间：'+esc(when(zoneCenterFix.ts)):'获取当前位置后自动转换UTM并填写定位精度；手动改平面坐标或分区会清除旧精度。')+'</p><div class="actions">'+button("zonePosition","","用当前位置作为中心")+'</div><p class="help">装卸区重叠或定位误差越界时不直接计车。</p>',f=>operate("zone",{id:key||null,name:f.get("name"),kind:f.get("zoneKind"),coordinateSystem:"WGS84-UTM",utmZone:f.get("utmZone"),utmHemisphere:f.get("utmHemisphere"),easting:f.get("easting"),northing:f.get("northing"),centerFix:zoneCenterFix,material:f.get("material"),radius:f.get("radius")}),"保存区域草稿");
    syncZoneFields();
  }
  async function saveInspection(form){if(busy)return;busy=true;$("save").disabled=true;const saved=[];let committed=false;try{const files=[...($("inspectionPhotos").files||[])];if(files.length>10)throw new Error("一次检查最多上传10张照片");for(const file of files){if(!file.type.startsWith("image/"))throw new Error("请上传图片文件");const attachment=await MineAttachmentStore.save(file);saved.push(attachment);}await T.act("inspection",{outcome:"abnormal",note:form.get("note"),faultId:form.get("faultId"),attachments:saved},actor);committed=true;$("modal").close();modalSave=null;releasePhotos();refresh(true);toast("异常已上报，直接关联上一实际班次驾驶员，设备已暂停");}catch(error){if(!committed)await Promise.allSettled(saved.map(f=>MineAttachmentStore.remove(f.id)));toast(error.message);}finally{busy=false;$("save").disabled=false;}}
  function previewSelected(files){releasePhotos();const host=$("selectedPhotos");if(!host)return;host.innerHTML=[...files].map(file=>{const url=URL.createObjectURL(file);photoUrls.push(url);return '<div><img src="'+url+'" alt="所选异常照片"><div class="photo-label">'+esc(file.name)+'</div></div>';}).join("");}
  async function faultDetails(key){const f=d.faults.find(v=>v.id===key),reports=d.inspections.filter(r=>r.faultId===key);show('异常责任与照片：'+f.vehicleCode,'<p><strong>直接关联责任驾驶员：'+esc(f.responsibleName||'未记录')+'</strong></p><p class="muted">上一实际班次 '+esc(f.previousShiftId||'未记录')+'；状态 '+esc(f.status==="open"?'未处理':'已处理')+'</p>'+reports.map(r=>'<section class="history"><strong>'+esc(r.personName)+' · '+esc(when(r.at))+'</strong><p>'+esc(r.note||'未填写说明')+'</p><div class="photos">'+r.attachments.map(file=>'<div><img data-photo-id="'+esc(file.id)+'" alt="异常照片载入中"><div class="photo-label">'+esc(file.name)+'</div><a class="photo-open" data-file-link="'+esc(file.id)+'" target="_blank" rel="noopener">打开原图</a></div>').join("")+'</div>'+(!r.attachments.length?'<p class="muted">本次未上传照片</p>':'')+'</section>').join("")+(f.resolution?'<p>处理记录：'+esc(f.resolution)+'</p>':''),null);const token=modalToken;for(const r of reports)for(const file of r.attachments){try{const record=await MineAttachmentStore.get(file.id);if(token!==modalToken||!$("modal").open)return;const img=[...$("modalBody").querySelectorAll('[data-photo-id]')].find(v=>v.dataset.photoId===file.id),link=[...$("modalBody").querySelectorAll('[data-file-link]')].find(v=>v.dataset.fileLink===file.id);if(record?.blob){const url=URL.createObjectURL(record.blob);photoUrls.push(url);if(img){img.src=url;img.alt=file.name;}if(link)link.href=url;}else if(img)img.alt="照片未在当前浏览器中找到";}catch(error){if(token===modalToken)$("modalError").textContent=error.message;}}}
  function tripDetails(key){const t=d.trips.find(v=>v.id===key);show('运输车次详情','<div class="position"><div><span>司机 / 班次</span>'+esc(t.personName)+' / '+esc(t.workDate)+' '+esc(t.shiftName)+'</div><div><span>车辆 / 实际挖机</span>'+esc(t.vehicleCode)+' / '+esc(t.excavatorCode)+'</div><div><span>来源 / 状态</span>'+esc(modeName(t))+' / '+esc(states[t.status])+'</div><div><span>物料 / 来源</span>'+esc(t.material||'待确定')+' / '+esc(t.materialSource||'—')+'</div><div><span>装载识别 / 卸料完成</span>'+esc(when(t.loadedAt))+' / '+esc(when(t.completedAt))+'</div><div><span>装载区 / 卸载区</span>'+esc(t.loadZone?.name)+' / '+esc(t.unloadZone?.name||'—')+'</div></div>'+(t.outsideNote?'<p>区外卸料说明：'+esc(t.outsideNote)+'</p>':'')+(t.voidNote?'<p>作废说明：'+esc(t.voidNote)+'</p>':'')+'<p class="muted">本车次使用开始时保存的区域快照，位置时间与完成时间分别记录；位置模拟不作为真实定位证据。</p>'+mapSvg([t.loadZone,...(t.unloadZones||[])],t.unloadPoint||t.loadPoint)+(t.events||[]).map(e=>'<div class="history"><strong>'+esc(e.type)+'</strong> · '+esc(when(e.at))+(e.reason?'<p>'+esc(e.reason)+'</p>':'')+(e.point?'<p class="muted">纬度 '+esc(e.point.lat)+' / 经度 '+esc(e.point.lng)+' · 精度 '+esc(e.point.accuracy)+'米 · 位置时间 '+esc(when(e.point.ts))+'</p>':'')+'</div>').join("")+(t.corrections||[]).map(c=>'<div class="history">物料调整：'+esc(c.from)+' → '+esc(c.to)+' · '+esc(when(c.at))+'<p>'+esc(c.note)+'</p></div>').join("")+'<p class="help">唯一车次编号：'+esc(t.id)+'</p>',null);}
  let simulationZones=[];
  function simulationForm(){const s=session();if(!s||s.status!=="working"||!T.working(d,m,s.vehicleId))return toast("请先检查并恢复驾驶设备");const t=currentTrip();if(t?.mode==="gps")return toast("当前车次为真实定位，请先完成本趟，不能切换来源");if(tracking)stopGPS(true);const zones=t?[t.loadZone,...t.unloadZones]:d.zones.filter(z=>z.enabled);simulationZones=[...new Map(zones.filter(T.validZone).map(z=>[z.id,z])).values()];show('输入模拟位置','<div class="banner">此入口只用于位置模拟，生成的车次单独标识，不计入真实定位有效车数。有效停留仍按调度设置执行。</div>'+select("simulationZone","选取区域中心作为参考坐标",[["","手动输入"],...simulationZones.map(z=>[z.id,z.name])])+ '<div class="form-grid">'+input("lat","模拟纬度",lastSimulation.lat,"number",'step="any" min="-90" max="90"')+input("lng","模拟经度",lastSimulation.lng,"number",'step="any" min="-180" max="180"')+input("accuracy","模拟误差（米）",lastSimulation.accuracy,"number",'min="0" step="any"')+'</div><p class="help">在区域内提交有效位置后，等待有效停留时间，再次提交位置。离开装载区后进入卸载区完成这一趟；模拟也不能重复计车。</p>',f=>{lastSimulation={lat:f.get("lat"),lng:f.get("lng"),accuracy:f.get("accuracy")};return operate("location",{...lastSimulation,mode:"simulation",ts:Date.now()},"模拟位置已提交，请按停留规则继续操作");},"提交模拟位置");}
  function updatePublishPreview(){
    const state=publishPreviewState,field=$("editForm").querySelector('[name="taskDate"]'),host=$("taskPublishPreview");if(!state||!field||!host)return;
    try{
      const current=T.get(),records=L.main(),taskDate=field.value||state.fallbackDate,candidate=MineTaskEngine.prepare(current,records,{...state.context,taskDate});
      if(Date.now()>=Date.parse(candidate.endAt))throw new Error("该日期的班次已经结束，请选择后续任务日期");
      state.signature=candidate.signature;state.taskDate=taskDate;state.valid=true;$("save").disabled=false;
      const count=kind=>candidate.tasks.filter(t=>t.kind===kind).length;
      host.innerHTML='<p><strong>'+esc(candidate.workDate+" "+candidate.shiftName+" · "+candidate.team)+'</strong></p><p>'+esc(when(candidate.startAt))+' — '+esc(when(candidate.endAt))+'</p><p>挖机任务 '+count("excavator")+' 个 · 汽车任务 '+count("driver")+' 个 · 辅助任务 '+count("auxiliary")+' 个</p><ul>'+candidate.tasks.map(t=>'<li>'+esc(t.personName+" / "+(t.vehicleCode||"未绑定设备")+(t.content?" / "+t.content:""))+'</li>').join("")+'</ul>'+(candidate.warnings.length?'<div class="publish-task-warnings">'+candidate.warnings.map(esc).join("<br>")+'</div>':"");
      $("modalError").textContent="";
    }catch(error){state.valid=false;state.signature=null;$("save").disabled=true;host.textContent=error.message;}
  }
  function openPublishTasks(){
    if(role!=="dispatch"||!dispatchShiftLocked||timeConfiguredShift!==selectedDispatchShift||!dispatchGroups[selectedDispatchShift])return;
    const context=productionContext(),release=publishedDispatchTask(),editing=release&&dispatchBindingEdits.get(dispatchBindingKey())===release.id,fallbackDate=editing?release.workDate:MineTaskEngine.suggestDate(context.workDate,d.shiftTimes[context.shiftName]);
    publishPreviewState={context,fallbackDate,valid:false,signature:null};
    show("发布班次任务",input("taskDate","任务日期（班次开始日，选填）",fallbackDate,"date")+'<div id="taskPublishPreview" class="publish-task-preview"></div><p class="help">到班次开始时间任务自动执行；司机和挖机仍须完成使用前检查。发布后修改配置需重新发布，旧版本保留。</p>',f=>{
      const state=publishPreviewState;if(!state?.valid)throw new Error("请先核对可发布任务");
      const taskDate=f.get("taskDate")||state.fallbackDate;
      if(taskDate!==state.taskDate)throw new Error("任务日期已变化，请重新核对预览");
      return operate("publishTasks",{sourceDate:state.context.workDate,shiftName:state.context.shiftName,team:state.context.team,taskDate,expectedSignature:state.signature},"任务已发布，各岗位看板已更新",()=>{dispatchBindingEdits.delete(JSON.stringify([state.context.workDate,state.context.shiftName,state.context.team]));view="assignments";});
    },"发布任务");updatePublishPreview();
  }
  function personnelMatrixSheets(report){
    const {scope,context,options}=report,all=haulSummaryPersonMulti(scope),today=T.date();
    return [["driver","汽车司机汇总","汽车拉运车数统计表","haul"],["excavator","挖机司机汇总","挖机装车数统计表","load"]].map(([roleCode,name,heading,kind])=>{
      const people=new Map(),add=(id,label,trip=null)=>{if(id==null||id===""||(!all&&String(id)!==scope.personId)||!haulSummaryPersonMatches(id,scope,context,trip))return;id=String(id);if(!people.has(id))people.set(id,{id,name:context.people.get(id)?.name||label||id,counts:new Map()});};
      for(const p of m.people)if(p.applicationRole===roleCode)add(p.id,p.name);
      for(const t of context.trips){
        const id=kind==="haul"?t.personId:context.operatorId(t),hasEquipment=kind==="haul"?t.vehicleId:t.excavatorId;
        if(!hasEquipment||!haulSummaryPersonMatches(id,scope,context,t))continue;
        if(id==null||id===""){if(all)add("__unassigned_"+kind+"__","历史未归属",t);}
        else add(id,options.find(([key])=>key===String(id))?.[1],t);
        const row=people.get(id==null||id===""?"__unassigned_"+kind+"__":String(id));
        if(row)row.counts.set(t.workDate,(row.counts.get(t.workDate)||0)+1);
      }
      const duplicateNames=new Map();for(const p of people.values())duplicateNames.set(p.name,(duplicateNames.get(p.name)||0)+1);
      const records=[...people.values()].sort((a,b)=>a.name.localeCompare(b.name,"zh-CN",{numeric:true})||a.id.localeCompare(b.id)).map(p=>({name:p.name+(duplicateNames.get(p.name)>1?"（"+p.id+"）":""),values:context.days.map(day=>day.workDate>today&&!p.counts.has(day.workDate)?null:p.counts.get(day.workDate)||0)}));
      const crossYear=scope.startDate.slice(0,4)!==scope.endDate.slice(0,4);
      const dates=context.days.map(day=>crossYear?day.workDate:Number(day.workDate.slice(5,7))+"月"+Number(day.workDate.slice(8,10))+"日");
      return {name,title:scope.startDate+"至"+scope.endDate+" "+heading,dates,records,matrix:true,notes:["单位：车。"+(haulSummaryPersonGroup(scope)||(all?"全部人员":"当前所选人员"))+"；按班次开始日归属，仅统计已完成真实定位车次。",kind==="haul"?"汽车司机按每趟实际驾驶员统计。":"挖机司机按实际装载设备对应司机统计，包含临时挖机。","无车数显示0，未来暂无记录留空；汽车与挖机分别统计，同一趟不能将两张表相加作为总拉运数。"]};
    });
  }
  function exportHaulSummary(){
    if(role!=="dispatch"||view!=="summary")return;
    haulSummaryExportData=null;refresh();
    const report=haulSummaryExportData;
    if(!report)return toast("请先选择有效的日期范围和统计对象");
    if(!window.MineTableExport)return toast("导出组件尚未加载，请刷新页面");
    const {scope,modeLabel,allPeople,totals,columns}=report;
    const fields=[["日期",r=>r.workDate,26,"date"],...(allPeople?[["姓名",r=>r.personName,24]]:[]),...columns.map(([key,label])=>[label,r=>r.future?null:r[key],18,"integer"]),["当日合计",r=>r.future?null:r.total,18,"integer"]];
    const rows=[...report.rows,{...totals,workDate:allPeople?"区间合计（车次去重）":"区间合计",personName:""}];
    const notes=["单位：车。仅统计已完成的真实定位车次，按班次开始日归属；未来日期暂无记录的数值留空。",...(scope.mode==="person"?["拉运按实际汽车司机、装车按实际装载挖机对应司机归属，包含临时挖机。"]:[]),...(allPeople?["所选范围人员按日期和姓名列出，含零车数人员；同一趟分别归属汽车和挖机司机，个人行不能相加作为总车数，区间合计按实际车次去重。"]:[]),...(scope.mode==="equipment"?["按车次实际汽车或实际装载挖机归集，包含临时挖机。"]:[]),...(totals.unknown?["历史未分类车次保留在单独分类和合计中。"]:[])];
    const title=(haulSummaryTitles[scope.mode]+"_"+scope.startDate+"至"+scope.endDate+"_"+modeLabel).replace(/[\\/:*?"<>|\[\]]/g,"_");
    try{if(scope.mode==="person")window.MineTableExport.downloadSheets([{name:"人员逐日明细",columns:fields,records:rows,title,notes},...personnelMatrixSheets(report)],title);else window.MineTableExport.download(fields,rows,title,{notes});toast("Excel 已导出");}catch(error){toast("导出失败："+error.message);}
  }
  function openAction(action,key){const s=session();
    if(action==="att2MonthDay"){
      if(role!=="dispatch")return;const [day,team]=String(key||"").split("|");if(!haulSummaryValidDate(day))return;
      att2Filters.date=day;att2Filters.team=["生产A组","生产B组"].includes(team)?team:"";view="attendanceDaily";refresh();return;
    }
    if(action==="att3Unscheduled"){const [personId,date]=String(key||"").split("|");return confirmUnscheduledAttendance(personId,date);}
    if(action==="att3Confirm"){
      if(role!=="dispatch")return;const [id,day,shift]=String(key||"").split("|");if(!haulSummaryValidDate(day))return;
      return confirmDailyAttendance(id,day,shift);
    }
    if(action==="att2Details"){
      if(role!=="dispatch")return;const [id,day]=String(key||"").split("|");if(!haulSummaryValidDate(day))return;
      attendanceFilters.startDate=day;attendanceFilters.endDate=day;
      show("按日考勤明细",MineAttendanceBoard.details(d,m,id,day),null);return;
    }
    if(action==="attendanceEdit")return editAttendance(key);
    if(action==="attendanceDay"){if(role!=="dispatch")return;const [personId,day]=String(key||"").split("|");if(!haulSummaryValidDate(day))return;return editAttendance(personId,day);}
    if(action==="haulSummaryDay"){
      if(role!=="dispatch")return;const [workDate,team]=String(key||"").split("|");
      if(!haulSummaryValidDate(workDate)||!["生产A组","生产B组"].includes(team))return toast("请选择有效日期和班组");
      haulSummaryTaskHistory={workDate,team};view="tasks";refresh();window.scrollTo({top:0,behavior:"smooth"});return;
    }
    if(action==="backHaulSummary"){if(role!=="dispatch")return;haulSummaryTaskHistory=null;view="summary";refresh();return;}
    if(action==="exitHaulHistory"){if(role!=="dispatch")return;haulSummaryTaskHistory=null;view="tasks";refresh();return;}
    if(action==="exportHaulSummary")return exportHaulSummary();
    if(action==="haulSummaryMode"){if(role!=="dispatch"||!["crew","person","equipment"].includes(key))return;haulSummaryFilters.mode=key;refresh();return;}
    if(action==="changeTaskBinding"){if(role!=="dispatch")return;const release=publishedDispatchTask();if(!release)return refresh();dispatchBindingEdits.set(dispatchBindingKey(),release.id);refresh();return toast("请调整绑定，完成后点击发布任务");}
    if(action==="publishTasks")return openPublishTasks();
    if(action==="taskInspection"){if(!["driver","excavator"].includes(role))return;return operate("openShift",{id:key},"请完成使用前检查",()=>{view="work";});}
    if(action==="selectDispatchShift"||action==="editShiftTimes"){
      if(role!=="dispatch"||!["白班","夜班"].includes(key))return;
      selectedDispatchShift=key;dispatchShiftLocked=true;if(!dispatchProductionDate)dispatchProductionDate=T.date();refresh();
      const times=d.shiftTimes[key],prefix=key==="白班"?"day":"night";
      show(key+"时间设置",'<div class="form-grid">'+input(prefix+"_start",key+"开始",times.start,"time",'step="60"')+input(prefix+"_end",key+"结束",times.end,"time",'step="60"')+'</div><p class="help">结束早于开始表示次日结束；空白保留原时间。</p>',f=>operate("shiftTimes",Object.fromEntries(f),key+"时间已保存",()=>{timeConfiguredShift=key;}),"保存时间");return;
    }
    if(action==="selectDispatchGroup"){
      if(role!=="dispatch"||!dispatchShiftLocked||key!==selectedDispatchShift||timeConfiguredShift!==key)return;
      const groups=["生产A组","生产B组"];
      show(key+" · 选择班组",select("dispatchTeam","班组",[["","请选择（选填）"],...groups.map(team=>[team,team])],dispatchGroups[key]||""),f=>{
        const team=String(f.get("dispatchTeam")||"");if(team&&!groups.includes(team))throw new Error("请选择现有班组");
        if(team)return operate("auxiliaryPlan",{...productionContext(),team,action:"ensure"},"班组已选择",()=>{dispatchGroups[key]=team;setTimeout(()=>document.querySelector('[data-action="openProductionGroup"]')?.scrollIntoView({behavior:"smooth",block:"nearest"}),0);});
        dispatchGroups[key]="";closeModal();refresh(true);
      },"确定");return;
    }
    if(action==="openProductionGroup"||action==="addProductionGroup"){
      if(role!=="dispatch"||!dispatchShiftLocked||timeConfiguredShift!==selectedDispatchShift||!dispatchGroups[selectedDispatchShift])return;
      return operate("productionGroup",{...productionContext(),id:action==="openProductionGroup"?(key||null):null,action:action==="addProductionGroup"?"add":"open"},"生产设备组已展开");
    }
    if(["chooseProductionEquipment","chooseProductionDriver","removeProductionGroup"].includes(action)){
      if(role!=="dispatch"||!dispatchShiftLocked||timeConfiguredShift!==selectedDispatchShift)return;
      const g=productionGroup(key);if(!g)return toast("设备组已变化，请重新选择");
      const context={id:g.id,workDate:g.workDate,shiftName:g.shiftName,team:g.team};
      if(action==="removeProductionGroup")return operate("productionGroup",{...context,action:"remove"},"设备组已移除");
      if(action==="chooseProductionEquipment"){
        const vehicles=m.vehicles.filter(v=>T.isExcavator(v)&&draftAvailable("vehicleId",v.id,g.id));
        show(groupTitle(g)+" · 选择挖机",select("vehicleId","挖机设备",[["","请选择（选填）"],...vehicles.map(v=>[v.id,(v.code||v.id)+(v.name?" · "+v.name:"")])],g.vehicleId||"")+(vehicles.length?"":'<p class="help">暂无挖机设备档案。</p>'),f=>operate("productionGroup",{...context,action:"equipment",value:f.get("vehicleId")},"设备已选择"),"确定");return;
      }
      const drivers=m.people.filter(p=>L.active(p)&&p.applicationRole==="excavator"&&p.team===g.team&&eligibleForSchedule(p)&&draftAvailable("personId",p.id,g.id));
      show(groupTitle(g)+" · 选择挖机司机",select("personId",g.team+"挖机司机",[["","请选择（选填）"],...drivers.map(p=>[p.id,p.name+" / "+p.id])],g.personId||"")+(drivers.length?"":'<p class="help">该班组暂无已审核在岗的挖机司机。</p>'),f=>operate("productionGroup",{...context,action:"driver",value:f.get("personId")},"挖机司机已选择"),"确定");return;
    }
    if(["chooseFollowingTruck","chooseFollowingDriver","removeFollowingTruck","addFollowingTruck"].includes(action)){
      if(role!=="dispatch"||!dispatchShiftLocked||timeConfiguredShift!==selectedDispatchShift)return;
      const g=truckGroup(key);if(!g)return toast("设备组已变化，请重新选择");
      const excavator=vehicleOf(g.vehicleId),operator=m.people.find(p=>p.id===g.personId);
      if(!T.isExcavator(excavator)||!operator||!L.active(operator)||operator.applicationRole!=="excavator"||operator.team!==g.team)return toast("请先选择当前班组的有效挖机及挖机司机");
      const base={id:g.id,workDate:g.workDate,shiftName:g.shiftName,team:g.team};
      if(action==="addFollowingTruck"){if(key!==g.id)return toast("设备组已变化，请重新选择");return operate("productionGroup",{...base,action:"addTruck"},"已新增一组跟随汽车");}
      const active=g.followingTrucks.filter(t=>t.status==="draft"),truck=active.find(t=>t.id===key);
      if(!truck)return toast("该汽车卡已变化，请重新选择");
      const context={...base,truckId:truck.id},others=active.filter(t=>t.id!==truck.id);
      if(action==="removeFollowingTruck")return operate("productionGroup",{...context,action:"removeTruck"},"跟随汽车已移除");
      if(action==="chooseFollowingTruck"){
        const vehicles=m.vehicles.filter(v=>T.isHaulTruck(v)&&draftAvailable("vehicleId",v.id,truck.id));
        show("跟随汽车 · 选择设备",select("vehicleId","汽车设备",[["","请选择（选填）"],...vehicles.map(v=>[v.id,(v.code||v.id)+(v.name?" · "+v.name:"")])],truck.vehicleId||"")+(vehicles.length?"":'<p class="help">暂无尚未在本组选择的矿用自卸车。</p>'),f=>operate("productionGroup",{...context,action:"truckEquipment",value:f.get("vehicleId")},"跟随汽车已选择"),"确定");return;
      }
      const drivers=m.people.filter(p=>L.active(p)&&p.applicationRole==="driver"&&p.team===g.team&&eligibleForSchedule(p)&&draftAvailable("personId",p.id,truck.id));
      show("跟随汽车 · 选择司机",select("personId",g.team+"汽车司机",[["","请选择（选填）"],...drivers.map(p=>[p.id,p.name+" / "+p.id])],truck.personId||"")+(drivers.length?"":'<p class="help">该班组暂无尚未在本组选择的在岗汽车司机。</p>'),f=>operate("productionGroup",{...context,action:"truckDriver",value:f.get("personId")},"汽车司机已选择"),"确定");return;
    }
    if(action==="productionRegions"){
      if(role!=="dispatch"||!dispatchShiftLocked||timeConfiguredShift!==selectedDispatchShift)return;
      const g=productionGroup(key);if(!g)return toast("设备组已变化，请重新选择");
      const exc=vehicleOf(g.vehicleId),operator=m.people.find(p=>p.id===g.personId);
      if(!T.isExcavator(exc)||!operator||!L.active(operator)||operator.applicationRole!=="excavator"||operator.team!==g.team)return toast("请先选择当前班组的有效挖机及挖机司机");
      const usable=z=>z.enabled&&T.validZone(z),loads=d.zones.filter(z=>z.kind==="load"&&usable(z));
      const loadOptions=[["","请选择（选填）"],...loads.map(z=>[z.id,z.name])];
      if(g.loadZoneId&&!loads.some(z=>z.id===g.loadZoneId))loadOptions.push([g.loadZoneId,productionZoneName(g.loadZoneId,"load")+"，请重新选择"]);
      const selected=new Set(Array.isArray(g.unloadZoneIds)?g.unloadZoneIds:[]),unloads=d.zones.filter(z=>z.kind==="unload"&&usable(z)),items=unloads.map(z=>({id:z.id,label:z.name+(z.material?" · "+z.material:"")}));
      for(const id of selected)if(!items.some(item=>item.id===id))items.push({id,label:productionZoneName(id,"unload")+"，请取消或重选"});
      const checks=items.map(item=>'<label class="region-option"><input type="checkbox" name="unloadZoneIds" value="'+esc(item.id)+'"'+(selected.has(item.id)?' checked':'')+'><span>'+esc(item.label)+'</span></label>').join("");
      const context={id:g.id,workDate:g.workDate,shiftName:g.shiftName,team:g.team};
      show(groupTitle(g)+" · 区域设置",select("loadZoneId","装载区（单选）",loadOptions,g.loadZoneId||"")+'<fieldset class="region-checkboxes"><legend>卸载区（可多选）</legend>'+(checks||'<p class="help">暂无已启用的有效卸载区。</p>')+'</fieldset>',f=>operate("productionGroup",{...context,action:"regions",loadZoneId:f.get("loadZoneId"),unloadZoneIds:f.getAll("unloadZoneIds")},"装卸区域已保存"),"保存区域");return;
    }
    if(["auxAdd","auxEquipment","auxDriver","auxRemove","auxContent"].includes(action)){
      if(role!=="dispatch"||!dispatchShiftLocked||timeConfiguredShift!==selectedDispatchShift||!dispatchGroups[selectedDispatchShift])return;
      const context=productionContext();
      if(action==="auxAdd")return operate("auxiliaryPlan",{...context,action:"add"},"已新增辅助车辆卡");
      const card=auxiliaryPlan()?.cards.find(c=>c.id===key&&c.status==="draft");if(!card)return toast("辅助车辆卡已变化，请重新选择");
      const args={...context,cardId:card.id};
      if(action==="auxRemove")return operate("auxiliaryPlan",{...args,action:"remove"},"辅助车辆卡已移除");
      if(action==="auxContent")return show("辅助车辆 · 作业内容",'<label>作业内容（选填）<textarea name="content" rows="5" maxlength="1000">'+esc(card.content||"")+'</textarea></label>',f=>operate("auxiliaryPlan",{...args,action:"content",content:f.get("content")},"作业内容已保存"),"保存");
      if(action==="auxEquipment"){
        const vehicles=m.vehicles.filter(v=>T.isAuxiliaryVehicle(v)&&draftAvailable("vehicleId",v.id,card.id));
        return show("辅助车辆 · 选择设备",select("vehicleId","辅助设备",[["","请选择（选填）"],...vehicles.map(v=>[v.id,(v.code||v.id)+(v.name?" · "+v.name:"")])],card.vehicleId||""),f=>operate("auxiliaryPlan",{...args,action:"equipment",value:f.get("vehicleId")},"辅助设备已选择"),"确定");
      }
      const drivers=m.people.filter(p=>L.active(p)&&p.team===context.team&&eligibleForSchedule(p)&&T.auxiliaryRoles.includes(p.applicationRole)&&draftAvailable("personId",p.id,card.id));
      return show("辅助车辆 · 选择人员",select("personId",context.team+"辅助岗位人员",[["","请选择（选填）"],...drivers.map(p=>[p.id,p.name+" · "+jobName(p)])],card.personId||""),f=>operate("auxiliaryPlan",{...args,action:"driver",value:f.get("personId")},"辅助人员已选择"),"确定");
    }
    if(action==="unusedVehicleInfo"){
      if(role!=="dispatch")return;const v=vehicleOf(key);if(!v)return toast("设备档案已变化");
      const status=availability(v),record=d.devices.find(r=>r.vehicleId===v.id);
      return show("设备信息 · "+(v.code||v.id),'<div class="position"><div><span>设备编号</span>'+esc(v.code)+'</div><div><span>设备名称</span>'+esc(v.name||"—")+'</div><div><span>设备类别</span>'+esc(v.category||v.model||"—")+'</div><div><span>当前状态</span>'+esc(status.label)+'</div><div><span>所属公司 / 车队</span>'+esc(v.team||"—")+'</div><div><span>车牌号</span>'+esc(v.plate||"—")+'</div></div>'+(record?.reason?'<p>'+esc(record.reason)+'</p>':""),null);
    }
    if(action==="unusedPersonInfo"){
      if(role!=="dispatch")return;const p=m.people.find(p=>p.id===key);if(!p)return toast("人员档案已变化");const actual=d.shifts.find(s=>s.personId===p.id&&s.status!=="closed");
      return show("人员信息 · "+p.name,'<div class="position"><div><span>姓名</span>'+esc(p.name)+'</div><div><span>岗位</span>'+esc(jobName(p))+'</div><div><span>班组</span>'+esc(p.team||"—")+'</div><div><span>在岗状态</span>'+esc(p.status)+'</div><div><span>当前实际班次</span>'+esc(actual?actual.vehicleCode+" · "+actual.shiftName:"无设备班次占用")+'</div></div>',null);
    }
    if(action==="assignment")return assignmentForm(key);
    if(action==="zone")return zoneForm(key);
    if(action==="activateAssignment")return operate("activateAssignment",{id:key},"排班已启用并通知人员");
    if(action==="cancelAssignment")return show('取消排班',note(),f=>operate("cancelAssignment",{id:key,note:f.get("note")}));
    if(action==="toggleZone")return operate("toggleZone",{id:key},"区域状态已更新");
    if(action==="settings")return show('调整定位识别规则','<div class="form-grid">'+input("dwellSeconds","有效停留（秒）",d.settings.dwellSeconds,"number",'min="1" max="600" step="any"')+input("maxAccuracy","最大定位误差（米）",d.settings.maxAccuracy,"number",'min="1" max="1000" step="any"')+input("gapSeconds","定位间断阈值（秒）",d.settings.gapSeconds,"number",'min="10" max="3600" step="any"')+input("exitMargin","离开区域缓冲（米）",d.settings.exitMargin,"number",'min="0" max="1000" step="any"')+input("maxSpeedKmh","明显跳点速度阈值（km/h）",d.settings.maxSpeedKmh,"number",'min="5" max="300" step="any"')+'</div><p class="help">空值保留原设置，新规则只用于后续开始的车次。</p>',f=>operate("settings",Object.fromEntries(f)));
    if(action==="openShift")return operate("openShift",{id:key},"已接班，请完成使用前检查");
    if(action==="normalInspection")return operate("inspection",{outcome:"normal",attachments:[]},"检查已登记，可以开始作业");
    if(action==="abnormalInspection"){const faults=d.faults.filter(f=>f.vehicleId===s.vehicleId&&f.status==="open");return show('使用前检查异常','<p>上一实际班次驾驶员：<strong>'+esc(s.previousDriverName||'未记录')+'</strong>。新异常直接关联该驾驶员，无需调度复核。</p>'+select("faultId","异常归属",[["","新发现异常"],...faults.map(f=>[f.id,'延续已有异常：'+(f.note||f.reportedAt)])])+note("异常说明（选填）")+'<label>异常照片（可多张，单张不超过10MB）<input type="file" id="inspectionPhotos" accept="image/*" multiple></label><div id="selectedPhotos" class="photos"></div><p class="help">选择照片后立即预览。上报后暂停设备，处理完成可由实际操作人恢复。</p>',saveInspection,"上报异常并暂停");}
    if(action==="pauseDevice")return show('设备暂停：'+vehicleName(key),select("mode","暂停类型",[["paused","临时暂停"],["repair","维修暂停"],["maintenance","保养暂停"]])+note(),f=>operate("device",{vehicleId:key,mode:f.get("mode"),note:f.get("note")},"设备已暂停，禁止新的装载识别"));
    if(action==="resumeDevice")return show('处理完成并恢复：'+vehicleName(key),'<p class="help">恢复会记录设备异常已处理。主档案仍为维修中或停用时，需要先处理主档案状态。</p>'+note("处理说明（选填）"),f=>operate("device",{vehicleId:key,mode:"working",note:f.get("note")},"设备已恢复"),"确认恢复作业");
    if(action==="temporaryExcavator"){const options=m.vehicles.filter(v=>T.isExcavator(v)&&T.working(d,m,v.id)&&(d.assignments.find(r=>r.id===s.assignmentId)?.releaseId?!!MineTaskEngine.zonesFor(d,d.assignments.find(r=>r.id===s.assignmentId),v.id)?.load:d.zones.some(z=>z.enabled&&z.kind==="load"&&T.validZone(z))));return show('临时非绑定挖机装车','<p class="help">只对下一趟有效，本趟计给实际装载挖机；完成后自动恢复排班绑定。需先启用通用装载区，暂停中的挖机不可选择。</p>'+select("excavatorId","临时装载挖机",[["","选择临时挖机"],...options.map(v=>[v.id,v.code])]),f=>operate("temporaryExcavator",{excavatorId:f.get("excavatorId")},"已设置临时挖机，仅下一趟有效"));}
    if(action==="outsideUnload"){const t=d.trips.find(t=>t.id===key);return show('非卸载区卸料','<p><strong>'+esc(t.vehicleCode)+' → '+esc(t.excavatorCode)+'</strong></p><p class="help">提交后立即完成本趟，汽车和实际装载挖机同时增加1车，无需调度确认；没有装载车次不能直接造车。</p>'+materialSelect("物料类型（选填）")+materialHelp+note("卸料用途 / 说明（选填）"),f=>operate("outsideUnload",{tripId:key,material:f.get("material"),note:f.get("note")},"本趟已完成，汽车与实际装载挖机已同步计车"),"确认卸料并计车");}
    if(action==="resumeTrip"){if(confirm("请确认仍在运送同一趟物料，尚未完成卸料。恢复后继续用本趟编号识别，不新增车次。"))return operate("resumeTrip",{},"本趟已恢复，请重新开启定位");return;}
    if(action==="voidTrip")return show('车次作废 / 冲销','<p class="help">记录会保留。已完成车次冲销后，汽车与实际挖机的有效车数同步减少；在途作废后不计车。</p>'+note("作废 / 冲销说明（选填）"),f=>operate("voidTrip",{id:key,note:f.get("note")},"车次已留痕作废，两端统计同步更新"),"确认作废 / 冲销");
    if(action==="closeShift")return show('结束本班','<p class="help">未完成车次须先卸料或记录作废。结束后释放人员/设备占用，下一实际班次可接班。</p>'+note("收班说明（选填）"),async f=>{await operate("closeShift",{note:f.get("note")},"本班已结束");if(!session())stopGPS(false);},"确认结束本班");
    if(action==="forceCloseShift")return show('结束实际班次占用','<p class="help">用于人员已停用/离职、遗留班次等情况；仍有在途车次时须先在车次明细完成处理或作废。</p>'+note("处理说明（选填）"),f=>operate("forceCloseShift",{id:key,note:f.get("note")},"班次占用已结束"));
    if(action==="correctMaterial"){const t=d.trips.find(t=>t.id===key);return show('修正物料分类',materialSelect("物料类型（选填）",t.material||"")+materialHelp+note(),f=>operate("correctMaterial",{id:key,material:f.get("material"),note:f.get("note")}));}
    if(action==="tripDetails")return tripDetails(key);
    if(action==="faultDetails")return faultDetails(key);
    if(action==="readMessages")return operate("readMessages",{},"消息已标为已读");
    if(action==="simulation")return simulationForm();
    if(action==="repeatSimulation")return operate("location",{...lastSimulation,mode:"simulation",ts:Date.now()},"模拟位置已再次提交");
    if(action==="startGPS")return startGPS();
    if(action==="stopGPS"){stopGPS(true);return;}
    if(action==="zonePosition"){
      if(!navigator.geolocation)return toast("当前浏览器不支持定位");
      const token=modalToken,request=++zoneFixRequest;toast("正在获取UTM坐标与定位精度…");
      navigator.geolocation.getCurrentPosition(p=>{
        if(token!==modalToken||request!==zoneFixRequest||!$("modal").open)return;
        try{
          const c=p.coords,form=$("editForm");if(!form.querySelector('[name="easting"]'))return;
          if(!Number.isFinite(c.accuracy)||c.accuracy<0)throw new Error("未取得有效定位精度，请重新获取");
          const xy=window.MineUTM.fromWGS84(c.latitude,c.longitude);
          for(const [name,value] of Object.entries({utmZone:xy.zone,utmHemisphere:xy.hemisphere,easting:xy.easting.toFixed(3),northing:xy.northing.toFixed(3),centerAccuracy:c.accuracy}))form.querySelector('[name="'+name+'"]').value=value;
          zoneCenterFix={lat:c.latitude,lng:c.longitude,accuracy:c.accuracy,ts:p.timestamp};
          $("zoneFixInfo").textContent="UTM "+xy.zone+xy.hemisphere+"；定位误差约 ±"+c.accuracy+" 米；采集时间："+when(p.timestamp);
          toast("已填入UTM坐标与定位精度");
        }catch(error){toast(error.message);}
      },error=>{if(token===modalToken&&request===zoneFixRequest&&$("modal").open)toast("无法取得位置："+error.message);},{enableHighAccuracy:true,maximumAge:0,timeout:20000});return;
    }
    if(action==="exportTrips"){refresh();if(!window.MineTableExport)return toast("导出组件尚未加载");const rows=roleTrips();if(!rows.length)return toast("暂无车次可导出");const cols=[["车次编号",t=>t.id,42],["日期",t=>t.workDate,16,"date"],["班别",t=>t.shiftName,12],["司机",t=>t.personName,18],["车辆",t=>t.vehicleCode,20],["实际装载挖机",t=>t.excavatorCode,22],["临时装载",t=>t.isTemporary?'是':'否',14],["物料",t=>t.material||'待确定',20],["状态",t=>states[t.status],18],["位置来源",modeName,16],["卸料方式",t=>t.method==="outside"?'非卸载区卸料':t.method?'区域自动识别':'—',22],["正式有效车数",t=>t.status==="completed"&&t.mode==="gps"?1:0,18,"number"],["模拟有效车数",t=>t.status==="completed"&&t.mode==="simulation"?1:0,18,"number"],["装载时间（乌兰巴托）",t=>t.loadedAt,28,"datetime"],["卸料时间（乌兰巴托）",t=>t.completedAt,28,"datetime"],["区外卸料说明",t=>t.outsideNote,32],["作废/冲销说明",t=>t.voidNote,32]];window.MineTableExport.download(cols,rows,"矿山运输车次明细");return toast("车次明细已导出");}
  }
  async function feedPosition(point){if(point.mode==="gps"&&(!tracking||document.visibilityState!=="visible"))return;if(positionBusy){lastQueuedPoint=point;return;}positionBusy=true;try{await T.act("location",point,actor);refresh();}catch(error){toast(error.message);}finally{positionBusy=false;const queued=lastQueuedPoint;lastQueuedPoint=null;if(queued)feedPosition(queued);}}
  function gpsSuccess(position){feedPosition({lat:position.coords.latitude,lng:position.coords.longitude,accuracy:position.coords.accuracy,ts:position.timestamp,mode:"gps"});}
  function gpsFailure(error){toast("定位不可用："+error.message);stopGPS(true);}
  function startGPS(){
    const s=session(),t=currentTrip();if(!s||s.status!=="working")return toast("请先完成接班检查并开始作业");
    if(t?.mode==="simulation")return toast("本趟是位置模拟，完成或作废后才能切换实时定位");
    if(t?.status==="review")return toast("请先确认仍在运输同一趟，再开启定位");
    if(!T.working(d,m,s.vehicleId))return toast("驾驶设备已暂停、维修或停用，请先处理设备状态");
    if(!navigator.geolocation)return toast("当前浏览器不支持定位");
    if(document.visibilityState!=="visible")return toast("请在可见页面开启定位");if(tracking)return;
    tracking=true;gpsFetching=false;const generation=++gpsGeneration;
    const success=p=>{if(tracking&&generation===gpsGeneration)gpsSuccess(p);};
    const failure=e=>{if(tracking&&generation===gpsGeneration)gpsFailure(e);};
    watchId=navigator.geolocation.watchPosition(success,failure,{enableHighAccuracy:true,maximumAge:0,timeout:20000});
    gpsTimer=setInterval(()=>{
      if(!tracking||generation!==gpsGeneration||gpsFetching||document.visibilityState!=="visible")return;gpsFetching=true;
      navigator.geolocation.getCurrentPosition(p=>{if(generation!==gpsGeneration)return;gpsFetching=false;success(p);},e=>{if(generation!==gpsGeneration)return;gpsFetching=false;failure(e);},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
    },5000);
    refresh();toast("定位已开启，请保持页面可见；系统按有效停留识别车次");
  }
  function stopGPS(record){
    if(watchId!=null&&navigator.geolocation)navigator.geolocation.clearWatch(watchId);if(gpsTimer!=null)clearInterval(gpsTimer);
    const wasTracking=tracking;watchId=null;gpsTimer=null;tracking=false;gpsFetching=false;gpsGeneration++;lastQueuedPoint=null;
    if(record&&wasTracking&&actor&&session())T.act("interrupt",{note:document.visibilityState==="hidden"?"页面隐藏，持续定位已停止":"司机停止实时定位"},actor).then(()=>refresh()).catch(error=>toast(error.message));
    if(person&&d&&m&&!$("modal").open)try{render();}catch{}
  }
  function openLogistics(){T.context(role);$("logisticsFrame").src="logistics.html?role="+encodeURIComponent(role);$("logisticsDialog").showModal();}
  document.addEventListener("click",event=>{const nav=event.target.closest("[data-view]");if(nav&&!busy){view=nav.dataset.view;if(view==="tasks")haulSummaryTaskHistory=null;refresh();return;}const b=event.target.closest("[data-action]");if(!b||busy)return;const action=b.dataset.action;if(action==="close"){closeModal();return;}if(action==="close-logistics"){$("logisticsDialog").close();return;}if(action==="logistics"){try{openLogistics();}catch(error){block(error);}return;}if(action==="refresh"){refresh();return;}if(action.startsWith("go-")){view=action.slice(3);refresh();return;}try{const result=openAction(action,b.dataset.id);if(result?.catch)result.catch(error=>toast(error.message));}catch(error){toast(error.message);}});
  $("editForm").addEventListener("submit",event=>{event.preventDefault();if(!modalSave||busy)return;try{const result=modalSave(new FormData(event.currentTarget));if(result?.catch)result.catch(error=>toast(error.message));}catch(error){toast(error.message);}});
  $("modal").addEventListener("cancel",event=>{if(busy)event.preventDefault();else{modalSave=null;releasePhotos();}});
  $("logisticsDialog").addEventListener("close",()=>{$("logisticsFrame").src="about:blank";});
  window.addEventListener("message",event=>{if(event.origin===location.origin&&event.source===$("logisticsFrame").contentWindow&&event.data?.type==="mine-close-logistics")$("logisticsDialog").close();});
  document.addEventListener("change",event=>{
    if(["att3DayUnits","att3NightUnits"].includes(event.target.name)){syncAtt3Confirmation();return;}
    if(["att2Date","att2Month","att2Team"].includes(event.target.name)){
      if(role!=="dispatch")return;const name=event.target.name,value=event.target.value;
      if(name==="att2Date"){if(!haulSummaryValidDate(value))return toast("请选择有效考勤日期");att2Filters.date=value;att2Filters.month=value.slice(0,7);}
      if(name==="att2Month"){try{MineAttendanceBoard.monthRange(value);}catch(error){return toast(error.message);}att2Filters.month=value;}
      if(name==="att2Team")att2Filters.team=["生产A组","生产B组"].includes(value)?value:"";
      refresh();return;
    }
    if(event.target.name==="attendanceWorkDate"){syncAttendanceEditor();return;}
    if(["attendanceStartDate","attendanceEndDate","attendanceTeam"].includes(event.target.name)){if(role!=="dispatch")return;const value=event.target.value;if(event.target.name==="attendanceTeam")attendanceFilters.team=value;else attendanceFilters[event.target.name==="attendanceStartDate"?"startDate":"endDate"]=haulSummaryValidDate(value)?value:null;refresh();return;}
    if(["coalRatioPeriod","coalRatioMonth","coalRatioStartDay","coalRatioEndDay"].includes(event.target.name)){
      if(role!=="dispatch")return;
      const name=event.target.name,value=event.target.value;
      if(name==="coalRatioPeriod")coalRatioSettings.period=value==="custom"?"custom":"natural";
      if(name==="coalRatioMonth")coalRatioSettings.month=haulSummaryValidDate(value+"-01")?value:null;
      if(name==="coalRatioStartDay"||name==="coalRatioEndDay"){const day=Number(value);if(Number.isInteger(day)&&day>=1&&day<=31)coalRatioSettings[name==="coalRatioStartDay"?"startDay":"endDay"]=day;}
      try{localStorage.setItem("mine-transport-coal-ratio-settings-v1",JSON.stringify({period:coalRatioSettings.period,startDay:coalRatioSettings.startDay,endDay:coalRatioSettings.endDay}));}catch{}
      refresh();return;
    }
    if(["haulSummaryStartDate","haulSummaryEndDate","haulSummaryPerson","haulSummaryVehicle"].includes(event.target.name)){
      if(role!=="dispatch")return;
      const value=event.target.value;
      if(event.target.name==="haulSummaryStartDate")haulSummaryFilters.startDate=haulSummaryValidDate(value)?value:null;
      if(event.target.name==="haulSummaryEndDate")haulSummaryFilters.endDate=haulSummaryValidDate(value)?value:null;
      if(event.target.name==="haulSummaryPerson")haulSummaryFilters.personId=String(value||"");
      if(event.target.name==="haulSummaryVehicle")haulSummaryFilters.vehicleId=String(value||"");
      refresh();return;
    }if(event.target.name==="taskDate")updatePublishPreview();invalidateZoneFix(event.target);if(event.target.name==="kind")syncAssignmentFields();if(event.target.name==="zoneKind")syncZoneFields();if(event.target.id==="inspectionPhotos")previewSelected(event.target.files||[]);if(event.target.name==="simulationZone"){const z=simulationZones.find(z=>z.id===event.target.value);if(z){$("editForm").querySelector('[name="lat"]').value=z.lat;$("editForm").querySelector('[name="lng"]').value=z.lng;}}});
  document.addEventListener("input",event=>{invalidateZoneFix(event.target);if(event.target.id==="recordSearch"){recordSearch=event.target.value;const start=event.target.selectionStart;$("content").innerHTML=renderRecords();const field=$("recordSearch");field.focus();field.setSelectionRange(start,start);}});
  async function externalChange(){try{await Promise.all([T.sync(),window.MineLeave.sync()]);T.context(role);const latest=T.stamp()+window.MineLeave.stamp()+localStorage.getItem(L.PEOPLE)+localStorage.getItem(L.KEY);if(latest!==signature||MineTaskBoard.clockKey(d)!==taskClockSignature||(role==="dispatch"&&view==="summary"&&haulSummaryRenderedToday!==T.date())||(role==="dispatch"&&["attendance","attendanceDaily"].includes(view)&&attendanceRenderedToday!==T.date())||(role==="dispatch"&&view==="assignments"&&shiftMinute!==Math.floor(Date.now()/60000)))refresh();}catch(error){block(error);}}
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")stopGPS(true);else externalChange();});
  window.addEventListener("pagehide",()=>{stopGPS(true);releasePhotos();});window.addEventListener("storage",externalChange);window.addEventListener("focus",externalChange);setInterval(externalChange,1000);Promise.all([T.ready(),window.MineLeave.ready()]).then(()=>refresh()).catch(block);
})();
