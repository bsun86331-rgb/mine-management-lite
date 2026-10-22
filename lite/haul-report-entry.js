(()=>{"use strict";
const path=location.pathname,role=path.endsWith("/management.html")?"admin":path.endsWith("/boss.html")?"boss":new URLSearchParams(location.search).get("role");if(!role||role==="dispatch")return;if(window.parent!==window||(location.pathname.endsWith("/logistics.html")&&role!=="middle_store"))return;
function install(){
 const spot=window.MineWorkspaceNav?.container();if(!spot)return;
 const button=document.createElement("button");button.type="button";button.className="haul-report-entry";button.textContent="车数统计表";
 let dialog,frame;button.onclick=()=>{
  if(role==="admin"&&window.MineLogisticsAdmin!==true||role==="boss"&&window.MineLeaveBoss!==true)return;
  if(!dialog){dialog=document.createElement("dialog");dialog.style.cssText="width:min(1200px,96vw);height:92dvh;max-height:94dvh;border:0;border-radius:12px;padding:0";dialog.innerHTML='<header style="display:flex;justify-content:space-between;padding:10px"><strong>车数统计表</strong><button type="button">关闭</button></header><iframe title="车数统计表" style="width:100%;height:calc(100% - 46px);border:0"></iframe>';document.body.append(dialog);frame=dialog.querySelector("iframe");dialog.querySelector("button").onclick=()=>dialog.close();dialog.addEventListener("close",()=>{frame.src="about:blank";});}
  frame.src="haul-report.html?role="+encodeURIComponent(role)+"&v=20261021-3";dialog.showModal();
 };window.addEventListener("message",e=>{if(e.origin===location.origin&&e.source===frame?.contentWindow&&e.data?.type==="mine-close-haul-report")dialog?.close();});window.MineWorkspaceNav.add(button,"haul");
}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install);else install();})();