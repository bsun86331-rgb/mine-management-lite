(()=>{"use strict";
let slot;const order={maintenance:0,haul:1,gps:2};
function container(){if(slot?.isConnected)return slot;const native=document.querySelector(".sidebar nav:not([data-workspace-feature-nav]),.side nav:not([data-workspace-feature-nav]),.aux-sidebar nav:not([data-workspace-feature-nav]),aside .nav:not([data-workspace-feature-nav])");
slot=document.createElement("nav");slot.className="workspace-feature-nav";slot.dataset.workspaceFeatureNav="";slot.setAttribute("aria-label","共用功能");
if(native){native.after(slot);return slot;}
const work=document.getElementById("bossWork");if(work){const panel=work.querySelector(".work-panel");if(panel)panel.before(slot);else work.prepend(slot);return slot;}
const board=document.getElementById("portalTaskBoard");if(board){board.before(slot);return slot;}
const shortcuts=document.querySelector("[data-workspace-shortcuts]");if(shortcuts){shortcuts.before(slot);return slot;}slot=null;return null;}
function add(button,key){const host=container();if(!host)return;const previous=host.querySelector('[data-workspace-feature="'+key+'"]');if(previous&&previous!==button)previous.remove();button.dataset.workspaceFeature=key;button.classList.remove("workspace-shortcut");button.classList.add("workspace-feature-link");host.append(button);for(const child of [...host.children].sort((a,b)=>(order[a.dataset.workspaceFeature]??9)-(order[b.dataset.workspaceFeature]??9)))host.append(child);}
function refresh(){const native=document.querySelector('#nav [data-view="summary"]');if(native)add(native,"haul");}
window.MineWorkspaceNav={container,add,refresh};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",refresh);else refresh();
})();