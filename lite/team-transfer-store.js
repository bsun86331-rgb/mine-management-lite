(()=>{"use strict";
const L=window.MineLogistics,teams=["生产A组","生产B组"],fail=m=>{throw Error(m);},now=()=>new Date().toISOString();
function actor(role){const p=L.context(role);if(!["在岗","已通过","休假","请假"].includes(p.status)||!teams.includes(p.team))fail("仅生产A组、生产B组在职人员可办理换组");return p;}
function read(){const m=L.main();if(m.teamTransfers!==undefined&&!Array.isArray(m.teamTransfers))fail("换组记录格式异常，请勿清除浏览器数据");return m;}
const records=m=>m.teamTransfers||[];
function candidates(p,m=read()){return m.people.filter(v=>v.id!==p.id&&L.active(v)&&v.applicationRole==="dispatch"&&v.team===p.team);}
function canApprove(r,p){return r.status==="pending"&&p.id===r.approverId&&p.id!==r.personId&&L.active(p)&&p.applicationRole==="dispatch"&&p.team===r.fromTeam;}
function summary(role){const p=actor(role),m=read(),rows=records(m);return {person:p,pending:rows.filter(r=>canApprove(r,p)).length,unread:rows.filter(r=>r.personId===p.id&&["approved","rejected"].includes(r.status)&&!r.resultReadAt).length};}
async function act(role,type,x={}){
 if(!navigator.locks?.request)fail("请使用支持事务锁的新版浏览器");
 return navigator.locks.request(L.PEOPLE,()=>{const p=actor(role),m=read(),at=now();m.teamTransfers=m.teamTransfers||[];const rows=m.teamTransfers;let r;
 if(type==="apply"){
  const clientId=String(x.clientId||"");if(!clientId||clientId.length>100)fail("申请标识无效，请刷新后重试");const old=rows.find(r=>r.personId===p.id&&r.clientId===clientId);if(old)return old.id;
  if(rows.some(r=>r.personId===p.id&&r.status==="pending"))fail("已有待审批换组申请，请勿重复提交");
  if(!teams.includes(x.toTeam)||x.toTeam===p.team)fail("请选择另一个生产班组");
  const approver=candidates(p,m).find(v=>v.id===x.approverId);if(!approver)fail("请选择当前班组在岗车队长；不能自己审批");
  const reason=String(x.reason||"").trim();if(reason.length>300)fail("换组说明最多300字");
  r={id:crypto.randomUUID(),clientId,personId:p.id,personName:p.name,personRole:p.applicationRole,fromTeam:p.team,toTeam:x.toTeam,approverId:approver.id,approverName:approver.name,reason,status:"pending",createdAt:at,updatedAt:at,history:[{at,by:p.id,name:p.name,action:"提交换组申请"}]};rows.unshift(r);
 }else if(type==="read"){for(const item of rows.filter(r=>r.personId===p.id&&["approved","rejected"].includes(r.status)&&!r.resultReadAt))item.resultReadAt=at;
 }else{
  r=rows.find(r=>r.id===x.id);if(!r)fail("申请不存在，请刷新");
  if(type==="withdraw"){if(r.personId!==p.id||r.status!=="pending")fail("只能撤回本人待审批申请");r.status="withdrawn";r.history.push({at,by:p.id,name:p.name,action:"撤回申请"});
  }else if(type==="approve"||type==="reject"){
   if(!canApprove(r,p))fail("仅申请指定的原班组在岗车队长可审批，不能审批本人申请");
   const target=m.people.find(v=>v.id===r.personId);if(!target||!["在岗","已通过","休假","请假"].includes(target.status))fail("申请人已离职、停用或状态变化，不能审批");
   if(target.team!==r.fromTeam)fail("申请人当前班组已变化，请撤回后重新申请");
   const note=String(x.note||"").trim();if(note.length>300)fail("审批说明最多300字");
   r.status=type==="approve"?"approved":"rejected";r.decidedAt=at;r.decidedBy=p.id;r.decidedName=p.name;r.decisionNote=note;r.resultReadAt=null;
   if(type==="approve"){target.team=r.toTeam;target.teamChangeHistory=[...(target.teamChangeHistory||[]),{id:r.id,fromTeam:r.fromTeam,toTeam:r.toTeam,at,by:p.id,byName:p.name,source:"team-transfer",reason:r.reason}];}
   r.history.push({at,by:p.id,name:p.name,action:type==="approve"?"同意换组，班组已更新":"驳回申请",note});
  }else fail("未知操作");r.updatedAt=at;
 }
 localStorage.setItem(L.PEOPLE,JSON.stringify(m));window.dispatchEvent(new CustomEvent("mine-team-transfer-change"));return r?.id;
 });
}
window.MineTeamTransfer=Object.freeze({actor,read,records,candidates,canApprove,summary,act});
})();