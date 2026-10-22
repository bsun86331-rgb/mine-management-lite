/* Browser-local leave applications; all changes are serialized and checked by applicant/approver identity. */
(() => {
"use strict";
const L=window.MineLogistics,DB="mine-management-lite-leave-v1",LOCK="mine-management-lite-leave-v1",GM_MODE="boss",OTHER_ROUTE="unconfigured";
let connection=null,cache={requests:[],audit:[]},loaded=false;
const fail=text=>{throw new Error(text);},uid=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
function database(){if(connection)return Promise.resolve(connection);return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore("ledger");r.onsuccess=()=>{connection=r.result;connection.onversionchange=()=>{connection.close();connection=null;};resolve(connection);};r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error("请关闭其他请假页面后重试"));});}
async function read(){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction("ledger","readonly"),r=tx.objectStore("ledger").get("current");r.onsuccess=()=>{const value=r.result||{requests:[],audit:[]};if(!Array.isArray(value.requests)||!Array.isArray(value.audit)){reject(new Error("请假数据格式异常，请保留数据"));return;}resolve(value);};r.onerror=()=>reject(r.error);});}
async function write(value){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction("ledger","readwrite");tx.objectStore("ledger").put(value,"current");tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("请假保存失败"));});}
async function sync(){cache=await read();loaded=true;return cache;}
const get=()=>{if(!loaded)fail("请假记录正在加载");return structuredClone(cache);};
function identity(role){
 if(role==="boss"){let allowed=false;try{allowed=GM_MODE==="boss"&&parent!==window&&parent.location.origin===location.origin&&parent.MineLeaveBoss===true;}catch{}if(!allowed)fail("请从已登录的Boss工作台进入审批");return {id:"boss",name:"总经理",applicationRole:"boss",team:"",boss:true};}
 const p=L.context(role);if(!L.active(p))fail("当前人员状态不能申请或审批请假");return p;
}
function route(p){if(p.applicationRole==="repair_worker")return {kind:"repair",team:"修理组",label:"修理管理审批"};if(["dispatch","middle_repair_manager"].includes(p.applicationRole)||p.team==="行政办公组")return {kind:"gm",team:"",label:"总经理审批"};if(["生产A组","生产B组"].includes(p.team))return {kind:"dispatch",team:p.team,label:p.team+"调度审批"};if(p.team==="修理组")return {kind:"repair",team:"修理组",label:"修理管理审批"};if(OTHER_ROUTE==="gm")return {kind:"gm",team:"",label:"总经理审批"};return {kind:"unconfigured",team:p.team||"",label:"审批路线尚未设置"};}
function candidates(p,m=L.main()){const r=route(p);return m.people.filter(v=>L.active(v)&&v.id!==p.id&&(r.kind==="dispatch"?v.applicationRole==="dispatch"&&v.team===r.team:r.kind==="repair"?v.applicationRole==="middle_repair_manager":false));}
function decisionItems(r){return (r.history||[]).flatMap((h,index)=>{const label={approved:"请假已批准",rejected:"请假已驳回","批准销假":"销假已批准","驳回销假":"销假已驳回"}[h.action];return label?[{key:index+":"+h.at+":"+h.action,at:h.at,label}]:[];});}
function unreadDecisions(p,ledger=cache){return ledger.requests.filter(r=>r.personId===p.id).flatMap(r=>decisionItems(r).filter(item=>!(r.decisionReadKeys||[]).includes(item.key)).map(item=>({...item,requestId:r.id}))).sort((a,b)=>b.at.localeCompare(a.at));}
function canApprove(request,p){if((request.status!=="pending"&&!(request.status==="approved"&&request.returnRequest?.status==="pending"))||request.personId===p.id)return false;return request.route.kind==="gm"?(GM_MODE==="boss"?p.boss===true:p.applicationRole==="middle_general_manager"):((request.route.kind==="dispatch"?p.applicationRole==="dispatch"&&p.team===request.route.team:request.route.kind==="repair"?p.applicationRole==="middle_repair_manager":false)&&(!request.approverId||request.approverId===p.id));}
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+"T00:00:00Z"))&&new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value;}
function span(input){if(!validDate(input.startDate)||!validDate(input.endDate))fail("请选择有效的开始和结束日期");if(!["am","pm"].includes(input.startPart)||!["am","pm"].includes(input.endPart))fail("请选择上午或下午");const from=Date.parse(input.startDate+"T00:00:00Z")/86400000*2+(input.startPart==="pm"?1:0),to=Date.parse(input.endDate+"T00:00:00Z")/86400000*2+(input.endPart==="pm"?1:0);if(to<from)fail("结束时间不能早于开始时间");return {from,to,days:(to-from+1)/2};}
function leaveWindow(r){
 const period=span(r),startAt=period.from*43200000-8*3600000,plannedEndAt=(period.to+1)*43200000-8*3600000;
 if(r.status!=="approved")return {startAt,endAt:plannedEndAt,plannedEndAt};
 const returned=r.returnRequest?.status==="approved"?Date.parse(r.returnRequest.effectiveReturnAt):Infinity;
 return {startAt,endAt:Number.isFinite(returned)?Math.max(startAt,returned):Infinity,plannedEndAt};
}
function actualWindow(r,at=Date.now()){
 const w=leaveWindow(r);return {...w,endAt:r.status==="approved"?Math.max(w.startAt,Math.min(w.endAt,at)):w.endAt};
}
function leaveState(r,at=Date.now()){
 if(r.status!=="approved")return "";
 const w=leaveWindow(r);return at<w.startAt?"待开始":at>=w.endAt?"已销假":"请假中";
}
function effectiveSpan(r){
 const original=span(r);if(r.status!=="approved")return original;
 const w=actualWindow(r),to=(w.endAt+8*3600000)/43200000-1;
 return {...original,to,days:Math.max(0,w.endAt-w.startAt)/86400000};
}
function stamp(){return loaded?JSON.stringify(cache.requests.map(r=>[r.id,r.updatedAt])):"loading";}
function schedulingConflict(p,startAt,endAt){
 if(!["生产A组","生产B组"].includes(p.team))return null;if(!loaded)fail("请销假记录尚未加载，请稍候");
 let from=Date.parse(startAt),to=Date.parse(endAt);if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)fail("排班时段无效");
 const current=Date.now();if(from<=current&&current<to)from=current;
 return cache.requests.find(r=>r.personId===p.id&&r.status==="approved"&&(()=>{const w=leaveWindow(r);return w.startAt<to&&from<w.endAt;})())||null;
}
function assertSchedule(p,startAt,endAt){if(schedulingConflict(p,startAt,endAt))fail((p.name||"该人员")+"在该排班时段请假，销假生效后才能排班");}
async function withSchedulingLock(callback){if(!navigator.locks?.request)fail("请使用支持事务锁的浏览器");return navigator.locks.request(LOCK,async()=>{await sync();return callback();});}
function cycleAt(p,day){
 const v=p.rotationLeave;if(!v?.enabled)return {error:"未享有轮休假"};
 if(!Number.isSafeInteger(v.cycleMonths)||v.cycleMonths<=0||!Number.isFinite(v.quotaDays)||v.quotaDays<=0)return {error:"轮休周期或额度待管理员设置"};
 if(!validDate(p.joinDate)||!validDate(day))return {error:"入职日期未设置，无法确定轮休周期"};
 const anchor=new Date(p.joinDate+"T00:00:00Z"),target=new Date(day+"T00:00:00Z");if(target<anchor)return {error:"所选日期早于入职日期"};
 const add=months=>{const first=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+months,1)),last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();return new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(anchor.getUTCDate(),last))).toISOString().slice(0,10);};
 let index=Math.floor(((target.getUTCFullYear()-anchor.getUTCFullYear())*12+target.getUTCMonth()-anchor.getUTCMonth())/v.cycleMonths);if(add(index*v.cycleMonths)>day)index--;
 const startDate=add(index*v.cycleMonths),nextDate=add((index+1)*v.cycleMonths),endDate=new Date(Date.parse(nextDate+"T00:00:00Z")-86400000).toISOString().slice(0,10);
 return {startDate,endDate,quota:v.quotaDays,from:Date.parse(startDate+"T00:00:00Z")/86400000*2,to:Date.parse(nextDate+"T00:00:00Z")/86400000*2-1};
}
function quota(p,day,ledger=cache,excludeId=""){
 let cycle;try{cycle=cycleAt(p,day);}catch{return {error:"轮休周期超出可计算日期范围，请管理员调整"};}if(cycle.error)return cycle;let used=0,reserved=0;
 for(const r of ledger.requests.filter(r=>r.personId===p.id&&r.type==="轮休假"&&r.id!==excludeId&&["pending","approved"].includes(r.status))){let w;try{w=r.status==="approved"?actualWindow(r):leaveWindow(r);}catch{continue;}const cycleStart=cycle.from*43200000-8*3600000,cycleEnd=(cycle.to+1)*43200000-8*3600000,amount=Math.max(0,Math.min(w.endAt,cycleEnd)-Math.max(w.startAt,cycleStart))/86400000;if(r.status==="approved")used+=amount;else reserved+=amount;}
 return {...cycle,used,reserved,remaining:Math.max(0,cycle.quota-used-reserved)};
}
function checkQuota(p,input,ledger,excludeId){const period=span(input);let cursor=period.from;while(cursor<=period.to){const day=new Date(Math.floor(cursor/2)*86400000).toISOString().slice(0,10),q=quota(p,day,ledger,excludeId);if(q.error)fail(q.error);const end=Math.min(period.to,q.to),needed=(end-cursor+1)/2;if(needed>q.remaining+1e-9)fail(q.startDate+"至"+q.endDate+"轮休余额不足（含待审批预留）");cursor=end+1;}}
async function act(type,x,role){
 if(!navigator.locks?.request)fail("请使用支持事务锁的新版浏览器");return navigator.locks.request(LOCK,async()=>{const p=identity(role),m=L.main(),ledger=await read(),at=now();let record;
 if(type==="submit"){
  if(p.boss)fail("当前入口仅处理请假审批");const clientId=String(x.clientId||"");if(!clientId)fail("申请标识无效，请刷新后重试");const previous=ledger.requests.find(r=>r.personId===p.id&&r.clientId===clientId);if(previous)return previous.id;const routing=route(p);if(routing.kind==="unconfigured")fail("当前班组审批路线未设置");if(!["轮休假","事假","病假","其他"].includes(x.type))fail("请选择请假类型");
  const period=span(x);if(String(x.reason||"").length>1000||String(x.phone||"").length>50)fail("请缩短原因或联系电话");
  const approverId=["dispatch","repair"].includes(routing.kind)?String(x.approverId||""):"";if(approverId&&!candidates(p,m).some(v=>v.id===approverId))fail("审批人不属于本路线的在岗审批人员，请重新选择");
  if(["dispatch","repair"].includes(routing.kind)&&!candidates(p,m).length)fail("当前班组没有可审批的在岗管理人员，请先由管理员配置");
  if(x.type==="轮休假")checkQuota(p,x,ledger,"");
  const conflict=ledger.requests.some(r=>r.personId===p.id&&["pending","approved"].includes(r.status)&&(()=>{try{const other=leaveWindow(r),requested=leaveWindow({startDate:x.startDate,endDate:x.endDate,startPart:x.startPart,endPart:x.endPart});return requested.startAt<other.endAt&&other.startAt<requested.endAt;}catch{return false;}})());if(conflict)fail("该时段与本人待审批或已批准的请假重复");
  
  record={id:uid(),clientId,personId:p.id,personName:p.name,personRole:p.applicationRole,team:p.team||"",route:routing,approverId,type:x.type,startDate:x.startDate,endDate:x.endDate,startPart:x.startPart,endPart:x.endPart,days:period.days,phone:String(x.phone||"").trim(),reason:String(x.reason||"").trim(),status:"pending",createdAt:at,updatedAt:at,history:[{at,by:p.id,action:"提交申请"}]};
  ledger.requests.unshift(record);
 }else{
  record=ledger.requests.find(r=>r.id===x.id);if(!record)fail("申请不存在");if(x.expectedUpdatedAt!==record.updatedAt)fail("申请已在其他页面变更，请刷新后重试");
  if(type==="readDecision"){
    if(record.personId!==p.id)fail("只能确认本人的审批结果");
    const known=new Set(decisionItems(record).map(item=>item.key)),keys=Array.isArray(x.keys)?x.keys.filter(key=>known.has(key)):[];
    record.decisionReadKeys=[...new Set([...(record.decisionReadKeys||[]),...keys])];
    await write(ledger);cache=ledger;loaded=true;return record.id;
  }
  let actionText="";
  if(type==="requestReturn"){
    if(record.personId!==p.id||record.status!=="approved")fail("只能对本人已批准的请假申请销假");
    if(record.returnRequest?.status==="pending"||record.returnRequest?.status==="approved")fail("销假已在审批或已处理");
    const returned=Date.parse(x.returnAt),w=leaveWindow(record);
    if(!Number.isFinite(returned)||returned<w.startAt)fail("请选择不早于请假开始时间的有效返岗时间");
    record.returnRequest={status:"pending",requestedReturnAt:new Date(returned).toISOString(),reason:String(x.note||"").slice(0,1000),requestedAt:at,by:p.id};actionText="提交销假";
  }else if(["approveReturn","rejectReturn","withdrawReturn"].includes(type)){
    if(record.status!=="approved"||record.returnRequest?.status!=="pending")fail("销假申请已处理，请刷新");
    if(type==="withdrawReturn"){if(record.personId!==p.id)fail("只能撤回本人销假申请");record.returnRequest.status="withdrawn";actionText="撤回销假";}
    else{
      if(!canApprove(record,p))fail("仅原审批路线有权限的管理人员可审批销假");
      record.returnRequest.status=type==="approveReturn"?"approved":"rejected";record.returnRequest.decisionAt=at;record.returnRequest.decisionBy=p.id;record.returnRequest.decisionName=p.name;record.returnRequest.decisionNote=String(x.note||"").slice(0,1000);
      if(type==="approveReturn")record.returnRequest.effectiveReturnAt=new Date(Math.max(Date.parse(at),Date.parse(record.returnRequest.requestedReturnAt))).toISOString();
      actionText=type==="approveReturn"?"批准销假":"驳回销假";
    }
  }else{
    if(record.status!=="pending")fail("该申请已处理，请刷新");
    if(type==="withdraw"){if(record.personId!==p.id)fail("只能撤回自己的申请");record.status="withdrawn";}
    else if(type==="approve"||type==="reject"){
      if(!canApprove(record,p))fail("仅本路线有权限的管理人员可审批，不能审批本人申请");
      if(type==="approve"&&!L.active(m.people.find(v=>v.id===record.personId)))fail("申请人已不在岗，请核实后处理");
      if(type==="approve"){const requested=leaveWindow(record);if(ledger.requests.some(other=>other.id!==record.id&&other.personId===record.personId&&other.status==="approved"&&(()=>{const w=leaveWindow(other);return requested.startAt<w.endAt&&w.startAt<requested.endAt;})()))fail("申请人存在尚未销假的重叠假期，请先处理销假");}
      if(type==="approve"&&record.type==="轮休假"){const applicant=m.people.find(v=>v.id===record.personId);if(!applicant)fail("申请人档案不存在");checkQuota(applicant,record,ledger,record.id);}
      record.status=type==="approve"?"approved":"rejected";record.decisionBy=p.id;record.decisionName=p.name;record.decisionAt=at;record.decisionNote=String(x.note||"").slice(0,1000);
    }else fail("未知请销假操作");
    actionText=record.status;
  }
  record.updatedAt=at;record.history.push({at,by:p.id,name:p.name,action:actionText,note:String(x.note||"").slice(0,1000),returnRequest:record.returnRequest?{...record.returnRequest}:undefined});
 }
 ledger.audit.unshift({id:uid(),at,by:p.id,name:p.name,type,requestId:record.id});await write(ledger);cache=ledger;loaded=true;return record.id;
 });}
window.MineLeave=Object.freeze({sync,ready:sync,get,identity,route,candidates,canApprove,decisionItems,unreadDecisions,span,effectiveSpan,leaveWindow,actualWindow,leaveState,stamp,schedulingConflict,assertSchedule,withSchedulingLock,quota,act});
})();
