(() => {
"use strict";
const role=location.pathname.endsWith("/boss.html")?"boss":new URLSearchParams(location.search).get("role");
if(!role)return;
let dialog=null,frame=null,button=null,polling=false,hasResults=false;
const leaveUrl=()=>"leave.html?role="+encodeURIComponent(role)+"&rev=20261019-3&opened="+Date.now();
function close(){if(dialog?.open)dialog.close();if(frame)frame.src="about:blank";}
function open(event){
 event?.preventDefault();
 if(role==="boss"&&window.MineLeaveBoss!==true)return;
 if(!dialog){dialog=document.createElement("dialog");dialog.className="leave-entry-dialog";dialog.innerHTML='<header><strong>请销假申请与审批</strong><button type="button">关闭</button></header><iframe title="请销假申请与审批"></iframe>';document.body.appendChild(dialog);frame=dialog.querySelector("iframe");dialog.querySelector("button").onclick=close;dialog.addEventListener("close",()=>{frame.src="about:blank";});}
 frame.src=leaveUrl()+(hasResults?"&view=mine":"");dialog.showModal();
}
function keepHomeLast(container){
 const reorder=()=>{const home=Array.from(container.children).find(el=>el.tagName==="A"&&/^返回(?:系统)?首页/.test(el.textContent.trim()));if(home&&container.lastElementChild!==home)container.appendChild(home);};
 reorder();
 new MutationObserver(reorder).observe(container,{childList:true});
}
function install(){
 const transport=document.querySelector(".sidebar-bottom"),logistics=document.querySelector(".side"),portal=document.querySelector("main.card .actions"),boss=document.getElementById("bossWork"),spot=transport||logistics||portal||boss;
 if(!spot)return;
 const style=document.createElement("style");style.textContent='.leave-entry-button{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;margin:5px 0;border:1px solid #c7dbcf;border-radius:8px;background:#edf5ef;color:#176b4a;text-decoration:none;font:600 13px/1.5 "Microsoft YaHei",sans-serif;cursor:pointer}.sidebar-bottom .leave-entry-button,.side .leave-entry-button{background:#ffffff12;border-color:#ffffff30;color:#d8f178}.leave-entry-button.leave-has-results{background:#fff0c7!important;color:#875313!important;border-color:#e9c66d!important}.leave-entry-badge{border-radius:12px;padding:1px 6px;background:#c94238;color:#fff;font-size:11px}.leave-entry-dialog{width:min(960px,96vw);height:92dvh;max-height:94dvh;border:0;border-radius:15px;padding:0;overflow:hidden}.leave-entry-dialog::backdrop{background:#10201999}.leave-entry-dialog>header{display:flex;align-items:center;justify-content:space-between;padding:9px 14px;height:50px;border-bottom:1px solid #dce5df;background:#fff;color:#173d31;font:14px "Microsoft YaHei",sans-serif}.leave-entry-dialog>header button{border:1px solid #dce5df;border-radius:7px;background:white;color:#176b4a;padding:5px 10px;cursor:pointer}.leave-entry-dialog iframe{width:100%;height:calc(100% - 50px);border:0;background:#f3f6f2}';document.head.appendChild(style);
 button=document.createElement("a");button.className="leave-entry-button";button.href=leaveUrl();button.textContent=role==="boss"?"请销假审批 ↗":"请销假申请 ↗";button.addEventListener("click",open);spot.appendChild(button);
 keepHomeLast(spot);if(boss?.parentElement)keepHomeLast(boss.parentElement);
}
async function poll(){
 if(polling||!button||document.visibilityState!=="visible")return;polling=true;
 try{if(role==="boss"&&window.MineLeaveBoss!==true)return;const p=role==="boss"?{id:"boss",boss:true}:MineLogistics.context(role);if(!p.boss&&!MineLogistics.active(p))return;const data=await MineLeave.sync(),approvals=data.requests.filter(r=>MineLeave.canApprove(r,p)).length,results=MineLeave.unreadDecisions(p,data),count=approvals+results.length;
 hasResults=results.length>0;button.classList.toggle("leave-has-results",hasResults);
 button.title=[approvals?"待审批 "+approvals+" 条":"",...results.map(item=>item.label+"（"+new Date(item.at).toLocaleString("zh-CN",{timeZone:"Asia/Ulaanbaatar",hour12:false})+"）")].filter(Boolean).join("\n");
 button.textContent=role==="boss"?"请销假审批":approvals?"请销假申请 / 审批":"请销假申请";
 if(count){const badge=document.createElement("span");badge.className="leave-entry-badge";badge.textContent=count;badge.setAttribute("aria-label",results.length+"条未读审批结果，"+approvals+"条待审批");button.appendChild(badge);}
 const arrow=document.createElement("span");arrow.textContent="↗";arrow.setAttribute("aria-hidden","true");button.appendChild(arrow);}

 catch{}finally{polling=false;}
}
window.addEventListener("message",event=>{if(event.origin===location.origin&&event.source===frame?.contentWindow&&event.data?.type==="mine-close-leave")close();});
window.addEventListener("pagehide",close);window.addEventListener("focus",poll);document.addEventListener("visibilitychange",poll);
window.MineLeaveEntry={close};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{install();poll();});else{install();poll();}setInterval(poll,5000);
})();