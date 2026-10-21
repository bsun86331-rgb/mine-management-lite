(()=>{"use strict";const $=id=>document.getElementById(id);
function workView(maintenance){$("maintenancePanel").hidden=!maintenance;$("taskPanel").hidden=maintenance;$("maintenanceBoardNav").classList.toggle("selected",maintenance);$("taskBoardNav").classList.toggle("selected",!maintenance);$("roleTitle").textContent=maintenance?"维修看板":"任务看板";$("roleDesc").textContent=maintenance?"查看今日维修概况及修理厂工位":"查看各班组已发布任务和作业安排";}
$("maintenanceBoardNav").onclick=()=>workView(true);$("taskBoardNav").onclick=()=>workView(false);
const tabs=Array.from(document.querySelectorAll("[data-maint-tab]"));
function select(tab){for(const item of tabs){const chosen=item===tab;item.setAttribute("aria-selected",String(chosen));item.tabIndex=chosen?0:-1;item.classList.toggle("active",chosen);$(item.getAttribute("aria-controls")).hidden=!chosen;}}
for(const tab of tabs){tab.onclick=()=>select(tab);tab.addEventListener("keydown",event=>{let i=tabs.indexOf(tab);if(event.key==="ArrowRight")i=(i+1)%tabs.length;else if(event.key==="ArrowLeft")i=(i+tabs.length-1)%tabs.length;else if(event.key==="Home")i=0;else if(event.key==="End")i=tabs.length-1;else return;event.preventDefault();select(tabs[i]);tabs[i].focus();});}
workView(true);
})();