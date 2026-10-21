(()=>{"use strict";const $=id=>document.getElementById(id);
function workView(maintenance){$("maintenancePanel").hidden=!maintenance;$("taskPanel").hidden=maintenance;$("maintenanceBoardNav").classList.toggle("selected",maintenance);$("taskBoardNav").classList.toggle("selected",!maintenance);$("roleTitle").textContent=maintenance?"维修看板":"任务看板";$("roleDesc").textContent=maintenance?"查看今日维修概况及修理厂工位":"查看各班组已发布任务和作业安排";}
$("maintenanceBoardNav").onclick=()=>workView(true);$("taskBoardNav").onclick=()=>workView(false);
const tabs=Array.from(document.querySelectorAll("[data-maint-tab]"));
function select(tab){for(const item of tabs){const chosen=item===tab;item.setAttribute("aria-selected",String(chosen));item.tabIndex=chosen?0:-1;item.classList.toggle("active",chosen);$(item.getAttribute("aria-controls")).hidden=!chosen;}}
for(const tab of tabs){tab.onclick=()=>select(tab);tab.addEventListener("keydown",event=>{let i=tabs.indexOf(tab);if(event.key==="ArrowRight")i=(i+1)%tabs.length;else if(event.key==="ArrowLeft")i=(i+tabs.length-1)%tabs.length;else if(event.key==="Home")i=0;else if(event.key==="End")i=tabs.length-1;else return;event.preventDefault();select(tabs[i]);tabs[i].focus();});}
workView(true);
const S=window.MineMaintenanceStations,role=new URLSearchParams(location.search).get("role"),host=$("maintenanceStations"),dialog=$("stationConfirm"),error=$("stationError");
let pending=null,saving=false,signature="";
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function notice(text){error.textContent=text;error.hidden=!text;}
function renderStations(force=false){try{const data=S.read(),allowed=S.canManage(role),stamp=JSON.stringify(data)+allowed;if(!force&&stamp===signature)return;
 signature=stamp;host.innerHTML=data.stations.filter(s=>s.status==="active").map(s=>'<article class="maintenance-station" data-station-id="'+esc(s.id)+'"><header><h3>🔧 '+esc(s.name||s.number+"号工位")+'</h3><span>空闲</span></header><p>当前工位可安排车辆进入维修。</p>'+(allowed?'<button type="button" class="station-delete" data-station-delete="'+esc(s.id)+'" aria-label="删除'+esc(s.name||s.number+"号工位")+'">删除</button>':"")+'</article>').join("")+(allowed?'<button type="button" class="station-add" id="addMaintenanceStation" aria-label="增加工位"><span aria-hidden="true">＋</span></button>':"");
}catch(e){host.innerHTML="";notice(e.message);signature="";}}
function ask(type,id){try{const person=S.manager(role),data=S.read(),station=data.stations.find(s=>s.id===id&&s.status==="active");if(type==="delete"&&!station)throw Error("此工位已删除，请刷新后重试");
 const name=type==="add"?(Math.max(0,...data.stations.map(s=>s.number))+1)+"号工位":station.name||station.number+"号工位";
 pending={type,id,revision:data.revision,personId:person.id};$("stationConfirmTitle").textContent=type==="add"?"确认增加工位":"确认删除工位";$("stationConfirmText").textContent=type==="add"?"确认增加“"+name+"”？":"确认删除“"+name+"”？";$("stationConfirmSave").textContent=type==="add"?"确认增加":"确认删除";$("stationConfirmSave").classList.toggle("danger",type==="delete");$("stationConfirmError").textContent="";dialog.showModal();
}catch(e){notice(e.message);renderStations(true);}}
host.addEventListener("click",event=>{if(saving)return;const add=event.target.closest("#addMaintenanceStation"),remove=event.target.closest("[data-station-delete]");if(add)ask("add");if(remove)ask("delete",remove.dataset.stationDelete);});
$("stationConfirmCancel").onclick=()=>{if(!saving)dialog.close();};
dialog.addEventListener("cancel",event=>{if(saving)event.preventDefault();});
dialog.addEventListener("close",()=>{pending=null;});
$("stationConfirmSave").onclick=async()=>{if(saving||!pending)return;saving=true;$("stationConfirmSave").disabled=true;$("stationConfirmCancel").disabled=true;const request={...pending};
 try{await S.change(role,request.type,request);dialog.close();notice(request.type==="add"?"工位已增加":"工位已删除");renderStations(true);}catch(e){$("stationConfirmError").textContent=e.message;renderStations(true);}finally{saving=false;$("stationConfirmSave").disabled=false;$("stationConfirmCancel").disabled=false;}};
window.addEventListener("storage",event=>{if(event.key===S.KEY)renderStations(true);});
window.addEventListener("focus",()=>renderStations(true));setInterval(()=>renderStations(),1000);renderStations(true);
})();