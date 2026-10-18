(() => {
"use strict";
const S=window.MineLeave,L=window.MineLogistics,$=id=>document.getElementById(id),role=new URLSearchParams(location.search).get("role"),esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let person,ledger,view=role==="boss"?"approval":"apply",busy=false,clientId=crypto.randomUUID(),opened=null,approverSignature="";
const statusNames={pending:"待审批",approved:"已批准",rejected:"已驳回",withdrawn:"已撤回"},part=value=>value==="pm"?"下午":"上午",when=value=>new Date(value).toLocaleString("zh-CN",{timeZone:"Asia/Ulaanbaatar",hour12:false}),today=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Ulaanbaatar"});
const dayText=value=>Number(value).toLocaleString("zh-CN",{maximumFractionDigits:4});
function durationText(r){const w=S.leaveWindow(r),seconds=Math.max(0,Math.floor((w.endAt-w.startAt)/1000)),days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;return days+"天"+hours+"小时"+minutes+"分"+(rest?rest+"秒":"");}
function toast(text){$("notice").textContent=text;}
function eligible(r){if(r.personId===person.id)return false;return r.route.kind==="gm"?person.boss===true:(r.route.kind==="dispatch"?person.applicationRole==="dispatch"&&person.team===r.route.team:r.route.kind==="repair"?person.applicationRole==="middle_repair_manager":false)&&(!r.approverId||r.approverId===person.id);}
function visible(r){return r.personId===person.id||eligible(r);}
function refreshQuota(){
 if(person.boss)return;
 const q=S.quota(person,$("startDate").value||today(),ledger);
 const enabled=person.rotationLeave?.enabled===true,rule=person.rotationLeave||{};
 $("quota").innerHTML=[["是否享有轮休假",enabled?"是":"否"],["当前轮休周期",q.startDate?q.startDate+" 至 "+q.endDate:"—"],["周期总额度",rule.quotaDays!=null?rule.quotaDays+"天":"—"],["本周期已批准使用",q.used!=null?dayText(q.used)+"天":"—"],["待审批预留",q.reserved!=null?dayText(q.reserved)+"天":"—"],["本周期剩余",q.remaining!=null?dayText(q.remaining)+"天":"—"]].map(([label,value])=>'<div><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>').join("");
 $("quotaMessage").textContent=(q.error?q.error+"。":"")+"周期按入职日期起算，到期重新计算，不跨周期结转。";
 try{$("days").value=S.span({startDate:$("startDate").value,endDate:$("endDate").value,startPart:$("startPart").value,endPart:$("endPart").value}).days;}catch{$("days").value="";}
}
function updateRoute(){
 if(person.boss)return;
 const route=S.route(person),options=S.candidates(person),current=$("approver").value;
 $("route").textContent="当前审批路线："+route.label;
 $("approverField").hidden=!["dispatch","repair"].includes(route.kind);
 const signature=JSON.stringify(options.map(p=>[p.id,p.name]));
 if(signature!==approverSignature){$("approver").innerHTML='<option value="">不指定，由本路线管理人员审批（选填）</option>'+options.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name+" · "+p.id)+'</option>').join("");if(options.some(p=>p.id===current))$("approver").value=current;approverSignature=signature;}
 $("routeHelp").textContent=["dispatch","repair"].includes(route.kind)?(options.length?(route.kind==="dispatch"?"可选择本组某位调度；不指定时，本组在岗调度均可审批。":"可选择修理管理；不指定时，在岗修理管理均可审批。"):"本路线暂无在岗审批人员，请先由管理员配置。"):route.kind==="gm"?"提交后由总经理在Boss端审批。":"当前班组审批路线待设置，可先填写，暂不能提交。";
}
function listRows(rows){
 return rows.length?rows.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=>'<button type="button" class="request-row" data-request="'+esc(r.id)+'"><span><strong>'+esc(r.personName+" · "+r.type)+'</strong><small>'+esc(r.team+" · "+r.startDate+" "+part(r.startPart)+" 至 "+r.endDate+" "+part(r.endPart))+'</small><small>'+esc(r.days+"天 · "+r.route.label)+'</small></span><b class="status '+r.status+'">'+esc(r.returnRequest?statusNames[r.status]+" · 销假"+statusNames[r.returnRequest.status]:statusNames[r.status])+'</b></button>').join(""):'<p class="empty">暂无申请</p>';
}
function draw(){
 const own=ledger.requests.filter(r=>r.personId===person.id),reviews=ledger.requests.filter(eligible),pending=reviews.filter(r=>S.canApprove(r,person)).length;
 $("identity").textContent=person.name+(person.team?" · "+person.team:"");
 $("applyTab").hidden=person.boss===true;$("mineTab").hidden=person.boss===true;$("approvalTab").hidden=!(person.boss||["dispatch","middle_repair_manager"].includes(person.applicationRole));
 $("approvalTab").textContent="请销假审批"+(pending?"（"+pending+"）":"");
 for(const b of document.querySelectorAll("[data-view]"))b.classList.toggle("selected",b.dataset.view===view);
 $("applyPanel").hidden=view!=="apply";$("minePanel").hidden=view!=="mine";$("approvalPanel").hidden=view!=="approval";
 $("mineList").innerHTML=listRows(own);$("approvalList").innerHTML=listRows(reviews);
 if(!person.boss){updateRoute();refreshQuota();}
}
async function refresh(){person=S.identity(role);ledger=await S.sync();draw();}
function details(id){
 const r=ledger.requests.find(r=>r.id===id&&visible(r));if(!r)return toast("无权查看此申请");
 opened={id:r.id,updatedAt:r.updatedAt,returnPending:r.returnRequest?.status==="pending"};
 $("detailBody").innerHTML='<h2>请销假申请 · '+esc(r.personName)+'</h2><dl>'+[["班组",r.team||"未设置"],["请假类型",r.type],["请假时段",r.startDate+" "+part(r.startPart)+" 至 "+r.endDate+" "+part(r.endPart)],["请假天数",r.days+"天"],["审批路线",r.route.label],["指定审批人",r.approverId?(L.main().people.find(p=>p.id===r.approverId)?.name||r.approverId):"未指定"],["联系电话",r.phone||"未填写"],["请假原因",r.reason||"未填写"],["状态",statusNames[r.status]],["申请时间",when(r.createdAt)],...(r.returnRequest?[["销假状态",statusNames[r.returnRequest.status]],["申请返岗时间",when(r.returnRequest.requestedReturnAt)],["销假说明",r.returnRequest.reason||"未填写"],...(r.returnRequest.effectiveReturnAt?[["销假生效时间",when(r.returnRequest.effectiveReturnAt)],["实际请假时长",durationText(r)],["实际计假天数",dayText(S.effectiveSpan(r).days)+"天（按实际时长折算）"]]:[]),...(r.returnRequest.decisionAt?[["销假审批人",r.returnRequest.decisionName],["销假审批意见",r.returnRequest.decisionNote||"未填写"]]:[])]:[]),...(r.decisionAt?[["审批人",r.decisionName],["审批时间",when(r.decisionAt)],["审批意见",r.decisionNote||"未填写"]]:[])].map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>').join("")+'</dl><details><summary>操作记录</summary>'+r.history.map(h=>'<p>'+esc(when(h.at)+" · "+(h.name||h.by)+" · "+(statusNames[h.action]||h.action))+'</p>').join("")+'</details>';
 $("returnPanel").hidden=!(r.personId===person.id&&r.status==="approved"&&Date.now()<S.leaveWindow(r).endAt&&!["pending","approved"].includes(r.returnRequest?.status));
 $("returnAt").value=new Date(Date.now()+8*3600000).toISOString().slice(0,16);$("returnReason").value="";
 $("withdrawReturn").hidden=!(r.personId===person.id&&r.returnRequest?.status==="pending");
 $("approve").textContent=opened.returnPending?"批准销假":"批准请假";$("reject").textContent=opened.returnPending?"驳回销假":"驳回请假";
 $("decisionNote").value="";$("decisionField").hidden=!S.canApprove(r,person);
 $("approve").hidden=!S.canApprove(r,person);$("reject").hidden=!S.canApprove(r,person);$("withdraw").hidden=!(r.personId===person.id&&r.status==="pending");$("dialogError").textContent="";$("details").showModal();
}
async function decision(action){
 if(busy||!opened)return;busy=true;setBusy();
 try{const actual=opened.returnPending&&["approve","reject"].includes(action)?action+"Return":action;
 await S.act(actual,{id:opened.id,expectedUpdatedAt:opened.updatedAt,note:action==="requestReturn"?$("returnReason").value:$("decisionNote").value,returnAt:$("returnAt").value?new Date($("returnAt").value+":00+08:00").toISOString():""},role);$("details").close();opened=null;await refresh();toast("操作已保存");}
 catch(error){$("dialogError").textContent=error.message;}
 finally{busy=false;setBusy();}
}
function setBusy(){for(const b of document.querySelectorAll('button[type="submit"],#approve,#reject,#withdraw,#submitReturn,#withdrawReturn'))b.disabled=busy;}
$("requestForm").addEventListener("submit",async event=>{
 event.preventDefault();if(busy)return;busy=true;setBusy();toast("");
 try{await S.act("submit",{clientId,type:$("type").value,startDate:$("startDate").value,endDate:$("endDate").value,startPart:$("startPart").value,endPart:$("endPart").value,approverId:$("approver").value,phone:$("phone").value,reason:$("reason").value},role);clientId=crypto.randomUUID();$("reason").value="";view="mine";await refresh();toast("申请已提交审批");}
 catch(error){toast(error.message);}
 finally{busy=false;setBusy();}
});
document.addEventListener("click",event=>{
 const tab=event.target.closest("[data-view]");if(tab&&!busy){view=tab.dataset.view;draw();return;}
 const row=event.target.closest("[data-request]");if(row&&!busy)details(row.dataset.request);
});
for(const id of ["startDate","endDate","startPart","endPart","type"])$(id).addEventListener("change",refreshQuota);
$("submitReturn").onclick=()=>decision("requestReturn");$("withdrawReturn").onclick=()=>decision("withdrawReturn");
$("approve").onclick=()=>decision("approve");$("reject").onclick=()=>decision("reject");$("withdraw").onclick=()=>decision("withdraw");$("closeDetails").onclick=()=>{if(!busy)$("details").close();};
$("back").onclick=()=>{if(parent!==window)parent.postMessage({type:"mine-close-leave"},location.origin);else location.href=role==="boss"?"boss.html":["driver","excavator","dispatch"].includes(role)?"transport.html?role="+encodeURIComponent(role):role==="middle_store"?"logistics.html?role=middle_store":"portal.html?role="+encodeURIComponent(role);};
(async()=>{try{person=S.identity(role);$("startDate").value=today();$("endDate").value=today();$("phone").value=person.phone||"";$("type").value=person.rotationLeave?.enabled?"轮休假":"事假";await refresh();$("app").hidden=false;}catch(error){$("blocked").hidden=false;$("blockedMessage").textContent=error.message;}})();
let polling=false;async function poll(){if(polling||busy||document.visibilityState!=="visible")return;polling=true;try{await refresh();}catch(error){$("app").hidden=true;$("blocked").hidden=false;$("blockedMessage").textContent=error.message;}finally{polling=false;}}
window.addEventListener("focus",poll);document.addEventListener("visibilitychange",poll);setInterval(poll,3000);
})();
