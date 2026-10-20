(()=>{"use strict";
const path=location.pathname,role=path.endsWith("/management.html")?"admin":path.endsWith("/boss.html")?"boss":new URLSearchParams(location.search).get("role");if(!role)return;
function install(){
 const spot=document.querySelector(".sidebar-bottom")||document.querySelector(".side")||document.querySelector("main.card .actions")||document.getElementById("bossWork")||document.querySelector(".nav");if(!spot)return;
 const button=document.createElement("button");button.type="button";button.textContent="任务看板 ↗";button.style.cssText="display:block;margin:6px 0;padding:8px 11px;border:1px solid #c7dbcf;border-radius:8px;background:#edf5ef;color:#176b4a;cursor:pointer;font:600 13px/1.5 sans-serif";
 let dialog,frame;button.onclick=()=>{
  if(role==="admin"&&window.MineLogisticsAdmin!==true||role==="boss"&&window.MineLeaveBoss!==true)return;
  if(!dialog){dialog=document.createElement("dialog");dialog.style.cssText="width:min(1200px,96vw);height:92dvh;max-height:94dvh;border:0;border-radius:12px;padding:0";dialog.innerHTML='<header style="display:flex;justify-content:space-between;padding:10px"><strong>任务看板</strong><button type="button">关闭</button></header><iframe title="任务看板" style="width:100%;height:calc(100% - 46px);border:0"></iframe>';document.body.append(dialog);frame=dialog.querySelector("iframe");dialog.querySelector("button").onclick=()=>dialog.close();dialog.addEventListener("close",()=>{frame.src="about:blank";});}
  frame.src="shared-tasks.html?role="+encodeURIComponent(role)+"&v=20261020-11";dialog.showModal();
 };spot.append(button);const home=[...spot.children].find(e=>e.tagName==="A"&&/^返回(?:系统)?首页/.test(e.textContent.trim()));if(home)spot.append(home);
}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install);else install();})();