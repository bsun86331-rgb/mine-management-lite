(()=>{"use strict";
const L=MineLogistics,T=MineTransport,E=MineTaskEngine,KEY="mine-management-lite-fuel-records-v1",fail=m=>{throw Error(m);};
const roles=["driver","excavator","dispatch","assistant","assistant_loader","assistant_fuel","assistant_water","assistant_grader","assistant_dump","middle","middle_repair_manager","repair_worker","middle_finance","middle_survey","middle_store","middle_statistics","middle_logistics"];
function privileged(role){const flag=role==="admin"?"MineLogisticsAdmin":"MineLeaveBoss",page=role==="admin"?"/management.html":"/boss.html";try{return location.pathname.endsWith(page)&&window[flag]===true||parent!==window&&parent.location.origin===location.origin&&parent.location.pathname.endsWith(page)&&parent[flag]===true;}catch{return false;}}
function actor(role){if(role==="admin"||role==="boss"){if(!privileged(role))fail("请从已登录的管理工作端进入加油登记");return {id:role,name:role==="admin"?"管理员":"老板",applicationRole:role,team:""};}if(!roles.includes(role))fail("无效工作端");const p=L.context(role);if(!L.active(p))fail("仅在岗人员可登记加油");return p;}
function read(){let d;try{d=JSON.parse(localStorage.getItem(KEY)||'{"version":1,"records":[]}');}catch{fail("加油记录无法读取，请勿清除数据");}if(!d||!Array.isArray(d.records))fail("加油记录格式异常");return d;}
function options(p){
 const d=T.get(),m=L.main(),tasks=d.assignments.filter(a=>{
  if(a.personId!==p.id||a.status!=="active"||!a.vehicleId)return false;
  if(a.releaseId){const r=d.taskReleases.find(r=>r.id===a.releaseId);return r?.status==="published"&&E.phase(r)==="running";}
  try{const w=E.timeWindow(a.workDate,d.shiftTimes[a.shiftName]);return Date.parse(w.startAt)<=Date.now()&&Date.now()<Date.parse(w.endAt);}catch{return false;}
 });
 if(tasks.length){return {source:"task",vehicles:[...new Map(tasks.map(a=>{const v=m.vehicles.find(v=>v.id===a.vehicleId);if(!v)fail("当前任务车辆档案缺失，请联系车队长");return [v.id,{vehicle:v,assignment:a}];})).values()]};}
 return {source:"command",vehicles:m.vehicles.filter(T.isCommandVehicle).map(vehicle=>({vehicle,assignment:null}))};
}
async function snapshot(role){await T.sync();const person=actor(role);return {person,...options(person),records:read().records.filter(r=>r.personId===person.id)};}
async function save(role,x){
 if(!navigator.locks?.request)fail("请使用支持事务锁的新版浏览器");
 return navigator.locks.request(KEY,async()=>{await T.sync();const p=actor(role),d=read(),requestId=String(x.requestId||"");if(!requestId||requestId.length>100)fail("登记标识无效，请刷新");
 const old=d.records.find(r=>r.personId===p.id&&r.requestId===requestId);if(old){if(old.vehicleId!==x.vehicleId||old.litres!==Number(x.litres))fail("登记标识已使用，请重新进入");return old.id;}
 const allowed=options(p),choice=allowed.vehicles.find(v=>v.vehicle.id===x.vehicleId);if(!choice||allowed.source!==x.source||(choice.assignment?.id||"")!==(x.assignmentId||""))fail("当前任务或车辆范围已变化，请刷新后重新选择");
 const text=String(x.litres??"").trim(),litres=Number(text);if(!/^\d+(\.\d{1,2})?$/.test(text)||!Number.isFinite(litres)||litres<=0||litres>100000)fail("请填写有效加油量（升，最多两位小数）");
 if(!["柴油","汽油"].includes(x.fuelType))fail("请选择油品");
 const photo=x.photo??null;if(photo!==null&&(typeof photo!=="string"||photo.length>400000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo)))fail("照片格式无效或过大，请重新选择");
 const meterValue=null;
 const note=String(x.note||"").trim();if(note.length>300)fail("备注最多300字");
 const v=choice.vehicle,a=choice.assignment,at=new Date().toISOString(),r={id:crypto.randomUUID(),requestId,personId:p.id,personName:p.name,personRole:p.applicationRole,team:p.team||"",vehicleId:v.id,vehicleCode:v.code||v.name||v.id,vehicleCategory:v.category||v.model||"",fuelType:x.fuelType,litres,photo,meterValue,meterUnit:window.MineServiceCare?.unit(v)||"公里",note,at,source:allowed.source,assignmentId:a?.id||null,releaseId:a?.releaseId||null,workDate:a?.workDate||null,shiftName:a?.shiftName||null,taskTeam:a?.team||null};
 d.records.unshift(r);try{localStorage.setItem(KEY,JSON.stringify(d));}catch{fail("加油记录保存失败，浏览器存储空间可能不足；请移除照片后重试，历史记录未删除");}window.dispatchEvent(new CustomEvent("mine-fuel-change"));return r.id;
 });
}
window.MineFuel=Object.freeze({KEY,actor,read,snapshot,save});
})();