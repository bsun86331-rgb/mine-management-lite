/* GPS punches are separate from attendance decisions; browser-local prototype. */
(() => {"use strict";
const TEAMS=Object.freeze(['生产A组','生产B组','行政办公组','修理组']);
const L=window.MineLogistics,DB='mine-management-lite-gps-clock-v1',LOCK=DB;let connection,cache;
const fail=s=>{throw Error(s);},id=()=>crypto.randomUUID(),clone=x=>structuredClone(x),day=t=>new Date(t).toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
function database(){if(connection)return Promise.resolve(connection);return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('ledger');r.onsuccess=()=>{connection=r.result;connection.onversionchange=()=>{connection.close();connection=null;};resolve(connection);};r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('请关闭其他打卡窗口后重试'));});}
async function read(){const db=await database();return new Promise((resolve,reject)=>{const t=db.transaction('ledger','readonly'),r=t.objectStore('ledger').get('current');r.onsuccess=()=>{const d=r.result||{points:[],punches:[],audit:[]};if(!['points','punches','audit'].every(k=>Array.isArray(d[k])))return reject(Error('打卡数据格式异常，请保留浏览器数据'));resolve(d);};r.onerror=()=>reject(r.error);});}
async function write(d){const db=await database();return new Promise((resolve,reject)=>{const t=db.transaction('ledger','readwrite');t.objectStore('ledger').put(d,'current');t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('打卡保存失败'));});}
async function sync(){cache=await read();return clone(cache);}
function adminAllowed(){try{return window.MineLogisticsAdmin===true||(parent!==window&&parent.location.origin===location.origin&&parent.MineLogisticsAdmin===true);}catch{return false;}}
function identity(role){if(role==='admin'){if(!adminAllowed())fail('请从已登录的管理员后台进入');return {id:'admin',name:'管理员',admin:true};}const p=L.context(role);if(!L.active(p))fail('仅在岗人员可以打卡或提供位置');return p;}
function text(v,label,max=100){const s=String(v??'').trim();if(!s||s.length>max)fail('请填写'+label+'（最多'+max+'字）');return s;}
function coord(v,min,max,label){if(v==null||String(v).trim()==='')fail('请填写'+label);const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)fail(label+'无效');return n;}
function pointInput(x){const radius=coord(x.radius,10,5000,'范围（10—5000米）'),team=String(x.team||'');if(team&&!TEAMS.includes(team))fail('请选择生产A组、生产B组、行政办公组、修理组或全部人员');return {name:text(x.name,'位置名称',60),lat:coord(x.lat,-90,90,'纬度'),lng:coord(x.lng,-180,180,'经度'),radius,team,note:String(x.note||'').trim().slice(0,500)};}
function uniqueName(d,name,exceptId=""){const key=v=>String(v??"").trim().normalize("NFKC").replace(/\s+/g," ").toLowerCase();if(d.points.some(q=>q.status!=='deleted'&&q.id!==exceptId&&key(q.name)===key(name)))fail("打卡位置名称已存在，请使用其他名称");}
function distance(a,b){const r=x=>x*Math.PI/180,dl=r(b.lat-a.lat),dg=r(b.lng-a.lng),h=Math.sin(dl/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dg/2)**2;return 6371000*2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));}
function eligible(q,p){return q.status==='active'&&(!q.team||q.team===p.team);}
function position(x,q,at){const c=x.position||{},lat=coord(c.lat,-90,90,'定位纬度'),lng=coord(c.lng,-180,180,'定位经度'),accuracy=coord(c.accuracy,0,100000,'定位精度'),timestamp=Number(c.timestamp);if(!Number.isFinite(timestamp)||timestamp>at+5000||at-timestamp>60000)fail('定位已过期，请重新获取位置');const maxAccuracy=Math.min(q.radius,100);if(accuracy>maxAccuracy)fail('定位精度不足，请到开阔处重试（需≤'+maxAccuracy+'米）');const metres=distance({lat,lng},q);if(metres>q.radius)fail('距离打卡点约'+Math.round(metres)+'米，超出'+q.radius+'米范围');return {lat,lng,accuracy,timestamp,distance:Math.round(metres)};}
function execute(d,a,type,x,at=Date.now()){
 const stamp=new Date(at).toISOString(),log=(action,recordId)=>d.audit.push({id:id(),at:stamp,actorId:a.id,actorName:a.name,action,recordId});
 if(type==='propose'||type==='createPoint'){
  if(type==='createPoint'&&!a.admin)fail('仅管理员可启用打卡位置');if(type==='propose'&&(a.admin||a.applicationRole!=='dispatch'))fail('仅调度可提供打卡位置');
  const data=pointInput(x);uniqueName(d,data.name);if(!a.admin&&data.team&&data.team!==a.team)fail('调度只能提供本班组或全员位置');
  const q={id:id(),...data,status:a.admin?'active':'pending',version:1,createdAt:stamp,createdBy:a.id,createdByName:a.name,history:[]};d.points.push(q);log(a.admin?'新增启用位置':'调度提供位置',q.id);return q.id;
 }
 if(['approvePoint','rejectPoint','updatePoint','disablePoint','enablePoint','deletePoint','restorePoint'].includes(type)){
  if(!a.admin)fail('仅管理员可管理打卡位置');const q=d.points.find(q=>q.id===x.id);if(!q||q.version!==x.expectedVersion)fail('位置已变化，请刷新重试');
  if(['approvePoint','rejectPoint'].includes(type)&&q.status!=='pending')fail('该位置已处理');if(type==='enablePoint'&&q.status!=='disabled')fail('只能启用已停用位置');if(type==='disablePoint'&&q.status!=='active')fail('只能停用已启用位置');
  if(["updatePoint","approvePoint","enablePoint"].includes(type))uniqueName(d,type==="updatePoint"?x.name:q.name,q.id);
  if(type==='deletePoint'&&q.status==='deleted')fail('该位置已删除');if(type==='restorePoint'&&q.status!=='deleted')fail('该位置未删除');
  const before={...q,history:undefined};const changes=type==='updatePoint'?pointInput(x):{};
  if(type==='updatePoint'&&q.status!=='active'&&q.status!=='disabled')fail('请先处理位置申请');Object.assign(q,changes);
  if(type==='approvePoint'||type==='enablePoint')q.status='active';if(type==='rejectPoint')q.status='rejected';if(type==='disablePoint')q.status='disabled';
  if(type==='deletePoint'){q.deletedPreviousStatus=q.status;q.status='deleted';q.deletedAt=stamp;q.deletedBy=a.id;}
  if(type==='restorePoint'){uniqueName(d,q.name,q.id);q.status=['pending','rejected'].includes(q.deletedPreviousStatus)?q.deletedPreviousStatus:'disabled';q.restoredAt=stamp;q.restoredBy=a.id;}
  q.version++;q.updatedAt=stamp;q.history.push({at:stamp,by:a.id,action:type,before});log(type,q.id);return q.id;
 }
 if(type==='punch'){
  if(a.admin)fail('请从本人工作端打卡');if(!['in','out'].includes(x.kind))fail('打卡类型无效');
  const q=d.points.find(q=>q.id===x.pointId);if(!q||!eligible(q,a))fail('打卡位置尚未启用或不适用于本人班组');if(q.version!==x.expectedVersion)fail('打卡位置已调整，请重新定位');
  const pos=position(x,q,at),today=day(at),open=d.punches.find(r=>r.personId===a.id&&!r.out),snap={pointId:q.id,pointName:q.name,pointVersion:q.version,pointLat:q.lat,pointLng:q.lng,radius:q.radius,...pos,at:stamp};
  if(x.kind==='in'){
   if(open)fail('已有'+open.workDate+'的上班卡，请先打下班卡');if(d.punches.some(r=>r.personId===a.id&&r.workDate===today))fail('今天已完成上班打卡，每天只记录一次');
   const r={id:id(),personId:a.id,personName:a.name,team:a.team||'',role:a.applicationRole,workDate:today,in:snap,out:null};d.punches.push(r);log('上班打卡',r.id);return r.id;
  }
  if(!open||open.id!==x.recordId)fail('没有待完成的上班卡，或已在其他页面打卡');if(at<Date.parse(open.in.at))fail('设备时间早于上班时间，请校准后重试');open.out=snap;log('下班打卡',open.id);return open.id;
 }
 fail('未知打卡操作');
}
async function act(type,x,role,expectedPersonId){if(!navigator.locks?.request)fail('请使用支持事务锁的新版浏览器');return navigator.locks.request(LOCK,async()=>{const a=identity(role);if(a.id!==expectedPersonId)fail('本人身份已变化，请重新进入');const d=await read(),result=execute(d,a,type,x||{});await write(d);cache=d;return result;});}
function get(){if(!cache)fail("GPS打卡记录尚未加载，请刷新后重试");return clone(cache);}
function stamp(){return JSON.stringify(cache?.punches||[]);}
async function withAttendanceLock(fn){if(!navigator.locks?.request)fail("请使用支持事务锁的新版浏览器");return navigator.locks.request(LOCK,async()=>{await sync();return fn();});}
window.MineGPSClock={get,stamp,withAttendanceLock,teams:TEAMS,sync,identity,act,day,distance,eligible};
})();
