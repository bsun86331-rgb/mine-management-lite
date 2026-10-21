(()=>{"use strict";
const KEY="mine-management-lite-maintenance-stations-v1",ROLE="middle_repair_manager";
const clone=value=>JSON.parse(JSON.stringify(value));
function initial(){return {version:1,revision:0,stations:Array.from({length:6},(_,i)=>({id:"station-"+(i+1),number:i+1,name:(i+1)+"号工位",status:"active",createdAt:null})),history:[]};}
function read(){const raw=localStorage.getItem(KEY);if(raw===null)return initial();let data;try{data=JSON.parse(raw);}catch{throw Error("工位资料读取失败，请联系管理员");}
 if(data?.version!==1||!Number.isInteger(data.revision)||!Array.isArray(data.stations)||!Array.isArray(data.history)||data.stations.some(s=>!s||typeof s.id!=="string"||!Number.isInteger(s.number)||s.number<1||!["active","deleted"].includes(s.status))||new Set(data.stations.map(s=>s.id)).size!==data.stations.length||new Set(data.stations.map(s=>s.number)).size!==data.stations.length)throw Error("工位资料格式异常，请联系管理员");return data;}
function manager(role){if(role!==ROLE)throw Error("只有维修管理可以操作工位");const p=window.MineLogistics.context(role);if(p.applicationRole!==ROLE||!window.MineLogistics.active(p))throw Error("只有在岗的维修管理可以操作工位");return p;}
function canManage(role){try{manager(role);return true;}catch{return false;}}
async function change(role,type,options={}){
 const run=()=>{const p=manager(role);if(!options.personId||p.id!==options.personId)throw Error("本人登记已变化，请重新确认");
 const data=read();if(data.revision!==options.revision)throw Error("工位已更新，请重新确认");const at=new Date().toISOString();let station;
 if(type==="add"){const number=Math.max(0,...data.stations.map(s=>s.number))+1;station={id:"station-"+crypto.randomUUID(),number,name:number+"号工位",status:"active",createdAt:at,createdBy:p.id};data.stations.push(station);}
 else if(type==="delete"){station=data.stations.find(s=>s.id===options.id&&s.status==="active");if(!station)throw Error("此工位已删除或不存在");if(station.occupied===true)throw Error("工位正在使用，不能删除");station.status="deleted";station.deletedAt=at;station.deletedBy=p.id;}
 else throw Error("不支持的工位操作");
 data.revision++;data.history.push({id:crypto.randomUUID(),type,stationId:station.id,stationNumber:station.number,at,by:p.id,role:ROLE});
 localStorage.setItem(KEY,JSON.stringify(data));return clone(station);};
 return navigator.locks?.request?navigator.locks.request(KEY,{mode:"exclusive"},run):run();
}
window.MineMaintenanceStations=Object.freeze({KEY,read,manager,canManage,change});
})();