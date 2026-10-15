/* Shared browser-local logistics ledger. Quantities and money use integer hundredths. */
(() => {
  "use strict";
  const KEY="mine-management-lite-logistics-v1", PEOPLE="mine-management-lite-records-v1", CURRENT="mine-management-lite-current-application";
  const active=p=>p&&["在岗","已通过"].includes(p.status);
  const id=()=>crypto.randomUUID(), now=()=>new Date().toISOString();
  const fail=message=>{throw new Error(message);};
  function read(key,fallback){const raw=localStorage.getItem(key);if(!raw)return fallback;try{return JSON.parse(raw);}catch{fail("保存数据无法读取，请保留浏览器数据并联系管理员处理。");}}
  function main(){const d=read(PEOPLE,{people:[],vehicles:[],supplies:[]});if(!d||!Array.isArray(d.people))fail("人员数据格式异常");return d;}
  function get(){const d=read(KEY,{version:1,items:[],requests:[],loans:[],returns:[],claims:[],exits:[],messages:[],ledger:[],legacy:[]});for(const k of ["items","requests","loans","returns","claims","exits","messages","ledger","legacy"])if(!Array.isArray(d[k]))fail("后勤台账格式异常，请勿清除浏览器数据");return d;}
  function fixed(value,label="数量",zero=false){const text=String(value??"").trim();if(!/^\d+(\.\d{1,2})?$/.test(text))fail(label+"须为最多两位小数的非负数");const v=Math.round(Number(text)*100);if(!Number.isSafeInteger(v)||v>10000000000||(!zero&&v<=0))fail(label+"超出范围");return v;}
  const num=n=>(n/100).toFixed(2).replace(/\.00$/,"").replace(/(\.\d)0$/,"$1");
  const amount=(q,p)=>{const product=q*p;if(!Number.isSafeInteger(product))fail("赔偿金额超出范围");return Math.round(product/100);};
  const text=(v,label,max=300)=>{const s=String(v??"").trim();if(!s||s.length>max)fail("请填写"+label+"（最多"+max+"字）");return s;};
  const SESSION="mine-management-lite-role-sessions-v1";
  function currentId(role){let sessions={};try{sessions=JSON.parse(sessionStorage.getItem(SESSION)||"{}");}catch{}return sessions[role]||localStorage.getItem(CURRENT);}
  function selectSession(person,updateCurrent=true){let sessions={};try{sessions=JSON.parse(sessionStorage.getItem(SESSION)||"{}");}catch{}sessions[person.applicationRole]=person.id;sessionStorage.setItem(SESSION,JSON.stringify(sessions));if(updateCurrent)localStorage.setItem(CURRENT,person.id);}
  function context(role){const p=main().people.find(p=>p.id===currentId(role));if(!p||p.applicationRole!==role)fail("本人登记已切换，请返回首页重新进入本人端口");if(!["在岗","已通过","休假","停用","离职"].includes(p.status))fail("入职资料尚未审核通过");return p;}
  const openExit=(d,pid)=>d.exits.find(x=>x.personId===pid&&x.status==="open");
  const outstanding=l=>l.qty-l.returned-l.writtenOff;
  const reserved=(d,itemId,exclude)=>d.requests.filter(r=>r.id!==exclude&&["submitted","ready","recall"].includes(r.status)).reduce((s,r)=>s+r.lines.filter(l=>l.itemId===itemId).reduce((a,l)=>a+l.qty,0),0);
  const available=(d,itemId,exclude)=>{const item=d.items.find(i=>i.id===itemId);return item?item.stock-reserved(d,itemId,exclude):0;};
  function notify(d,target,body,ref){d.messages.unshift({id:id(),target,body,ref,at:now(),readBy:[]});}
  function log(d,actor,type,detail,extra={}){d.ledger.unshift({id:id(),at:now(),actor:actor.admin?"管理员":actor.person.name,actorId:actor.admin?"admin":actor.person.id,type,detail,...extra});}
  function legacyRows(m,d){return (m.supplies||[]).map((r,i)=>({...r,legacyId:String(r.id||("legacy-"+i)),resolution:d.legacy.find(l=>l.id===String(r.id||("legacy-"+i)))}));}
  function clearance(d,m,pid){const p=m.people.find(p=>p.id===pid);return {
    exit:openExit(d,pid),
    requests:d.requests.filter(r=>r.personId===pid&&["submitted","ready","recall"].includes(r.status)),
    loans:d.loans.filter(l=>l.personId===pid&&outstanding(l)>0),
    returns:d.returns.filter(r=>r.personId===pid&&r.status==="pending"),
    claims:d.claims.filter(c=>c.personId===pid&&c.status!=="finance_approved"),
    legacy:legacyRows(m,d).filter(r=>!r.resolution&&(r.personId===pid||(!r.personId&&r.person===p?.name)))
  };}
  const cleared=c=>![c.requests,c.loans,c.returns,c.claims,c.legacy].some(a=>a.length);
  function auth(actor,m){if(actor?.admin){if(window.MineLogisticsAdmin!==true)fail("请先验证管理员密码");return {admin:true};}const p=m.people.find(p=>p.id===currentId(actor?.role));if(!p||p.id!==actor?.personId||p.applicationRole!==actor?.role)fail("本人登记已切换，请重新进入");if(!["在岗","已通过","休假","停用","离职"].includes(p.status))fail("当前人员状态不能操作");return {person:p};}
  const keeper=a=>{if(!active(a.person)||a.person.applicationRole!=="middle_store")fail("仅在岗后勤库管可操作");};
  const finance=a=>{if(!active(a.person)||a.person.applicationRole!=="middle_finance")fail("仅在岗财务可复核");};
  const admin=a=>{if(!a.admin)fail("仅管理员可办理离职");};
  const owner=(a,pid)=>{if(a.person?.id!==pid)fail("只能操作本人记录");};
  function normalizeLines(d,lines,exclude){if(!Array.isArray(lines)||!lines.length||lines.length>30)fail("请选择1至30项物资");const seen=new Set();return lines.map(l=>{const item=d.items.find(i=>i.id===l.itemId);if(!item||!item.enabled)fail("物资不存在或已停用");if(seen.has(item.id))fail("同一种物资请合并数量");seen.add(item.id);const qty=fixed(l.qty);if(available(d,item.id,exclude)<qty)fail(item.name+"库存不足，可用 "+num(available(d,item.id,exclude))+" "+item.unit);return {itemId:item.id,name:item.name,spec:item.spec,unit:item.unit,recoverable:item.recoverable,unitPrice:item.unitPrice,currency:item.currency,qty};});}
  function pendingQty(d,loanId){return d.returns.filter(r=>r.loanId===loanId&&r.status==="pending").reduce((s,r)=>s+r.qty,0)+d.claims.filter(c=>c.loanId===loanId&&c.status==="employee_confirmed").reduce((s,c)=>s+c.qty,0);}
  function dispatch(d,m,a,type,x){
    if(a.person?.status==="离职"&&type!=="read")fail("正式离职后仅可查看历史");
    const find=(kind,key)=>d[kind].find(v=>v.id===key)||fail("记录不存在，请刷新");
    const note=()=>text(x.reason,"原因");
    if(type==="saveItem"){
      keeper(a);const name=text(x.name,"物资名称",60),spec=String(x.spec||"").trim().slice(0,80),unit=text(x.unit,"单位",10);
      if(d.items.some(i=>i.id!==x.id&&i.name===name&&i.spec===spec))fail("同名同规格物资已存在");
      const recoverable=x.recoverable===true,unitPrice=fixed(x.price,"赔偿单价",!recoverable),currency=String(x.currency||"");if(!["CNY","MNT","USD"].includes(currency))fail("请选择币种");
      let item=x.id?find("items",x.id):null;
      if(item&&item.recoverable!==recoverable&&(item.stock||d.requests.some(r=>["submitted","ready"].includes(r.status)&&r.lines.some(l=>l.itemId===item.id))||d.loans.some(l=>l.itemId===item.id)))fail("已有库存或领用记录，不能改变回收属性，请另建物资");
      if(item&&d.requests.some(r=>["submitted","ready","recall"].includes(r.status)&&r.lines.some(l=>l.itemId===item.id))&&(item.name!==name||item.spec!==spec||item.unit!==unit||item.unitPrice!==unitPrice||item.currency!==currency))fail("物资存在预留申请，请处理完毕后再修改档案");
      if(item&&item.unit!==unit&&(item.stock||d.loans.some(l=>l.itemId===item.id)))fail("已有库存/台账不能改变单位，请另建物资");
      if(!item){item={id:id(),stock:0,damaged:0,createdAt:now()};d.items.push(item);}
      Object.assign(item,{name,spec,unit,recoverable,unitPrice,currency,enabled:x.enabled!==false});log(d,a,"物资档案",name+" · "+spec);return item.id;
    }
    if(type==="stock"){
      keeper(a);const item=find("items",x.itemId),qty=fixed(x.qty),reason=note();if(!["in","subtract"].includes(x.mode))fail("未知库存操作");const delta=x.mode==="in"?qty:-qty;if(item.stock+delta<reserved(d,item.id))fail("调整后库存不能低于已预留数量");item.stock+=delta;log(d,a,delta>0?"入库":"盘点减少",item.name+"："+num(delta)+item.unit+"；"+reason,{itemId:item.id,delta});return;
    }
    if(type==="request"){
      if(!active(a.person)||openExit(d,a.person.id))fail("当前不能新增申请：请确认在岗且未进入离职清算");
      const lines=normalizeLines(d,x.lines),r={id:id(),personId:a.person.id,personName:a.person.name,lines,status:"submitted",at:now(),note:String(x.note||"").trim().slice(0,300),history:[]};d.requests.unshift(r);notify(d,"keeper",a.person.name+"提交了物资申请",r.id);log(d,a,"申请预留",lines.map(l=>l.name+"×"+num(l.qty)).join("、"),{requestId:r.id});return r.id;
    }
    if(type==="shortage"){
      if(!active(a.person)||openExit(d,a.person.id))fail("当前不能提交缺货需求");
      const missing=(x.lines||[]).map(l=>{const i=d.items.find(i=>i.id===l.itemId);if(!i)return null;const qty=fixed(l.qty);return qty>available(d,i.id)?i.name+"需求 "+num(qty)+" "+i.unit+"，可用 "+num(available(d,i.id)):null;}).filter(Boolean);
      if(!missing.length)fail("库存已变化，请刷新后重新申请");const body=a.person.name+"的缺货需求："+missing.join("；")+"（未创建领用单、未预留库存）";
      if(!d.messages.some(msg=>msg.target==="keeper"&&msg.body===body&&Date.now()-Date.parse(msg.at)<300000)){notify(d,"keeper",body,id());log(d,a,"缺货提醒",body);}return;
    }
    if(["adjust","ready","cancel","reject","dispute","confirm","recall","ackRecall"].includes(type)){
      const r=find("requests",x.id);
      if(type==="cancel"){owner(a,r.personId);if(r.status!=="submitted")fail("已交付物资请联系库管处理，不能自行取消");r.status="cancelled";notify(d,"keeper",r.personName+"取消了申请",r.id);}
      if(type==="reject"){keeper(a);if(r.status!=="submitted")fail("只能驳回尚未交付的申请");r.reason=note();r.status="rejected";notify(d,r.personId,"物资申请被驳回："+r.reason,r.id);}
      if(type==="adjust"){
        keeper(a);if(!["submitted","ready"].includes(r.status))fail("已结束单据不能修改");
        const lines=normalizeLines(d,x.lines,r.id),reason=note();if(openExit(d,r.personId)&&lines.some(l=>l.qty>(r.lines.find(old=>old.itemId===l.itemId)?.qty||0)))fail("离职清算期间只能减少已交付明细，不能增加或更换物资");r.history.push({at:now(),by:a.person.id,old:r.lines,next:lines,reason});r.lines=lines;r.dispute="";notify(d,r.personId,"库管调整了发放明细，请重新核对："+reason,r.id);
      }
      if(type==="ready"){keeper(a);if(r.status!=="submitted")fail("申请状态已变化");const p=m.people.find(p=>p.id===r.personId);if(!active(p)||openExit(d,r.personId))fail("人员已不能领用，请驳回未交付申请");r.status="ready";r.deliveredAt=now();r.keeperId=a.person.id;notify(d,r.personId,"库管已交付物资，请当面核对并确认领取",r.id);}
      if(type==="dispute"){owner(a,r.personId);if(r.status!=="ready")fail("此单不在待确认状态");r.dispute=note();notify(d,"keeper",r.personName+"对发放提出异议："+r.dispute,r.id);}
      if(type==="recall"){keeper(a);if(r.status!=="ready")fail("只能撤销待本人确认的交付");r.recallReason=note();r.status="recall";notify(d,r.personId,"库管申请撤销交付，请确认未领取或已退回全部物资："+r.recallReason,r.id);}
      if(type==="ackRecall"){owner(a,r.personId);if(r.status!=="recall")fail("撤销状态已变化");r.status="cancelled";r.reason="本人确认未领取或已退回全部物资；"+r.recallReason;notify(d,"keeper",r.personName+"确认撤销交付，预留已释放",r.id);}
      if(type==="confirm"){
        owner(a,r.personId);if(r.status!=="ready")fail("此单已处理，不能重复出库");if(r.dispute)fail("请先由库管处理发放异议");
        for(const line of r.lines){const item=find("items",line.itemId);if(item.stock<line.qty)fail(item.name+"库存不足");item.stock-=line.qty;if(line.recoverable)d.loans.push({...line,id:id(),personId:r.personId,personName:r.personName,returned:0,writtenOff:0,requestId:r.id,at:now()});log(d,a,"确认出库",line.name+"×"+num(line.qty),{itemId:item.id,delta:-line.qty,requestId:r.id});}
        r.status="issued";r.confirmedAt=now();notify(d,"keeper",r.personName+"已确认领取，出库完成",r.id);
      }
      if(type!=="confirm")log(d,a,{adjust:"调整发放",ready:"库管交付",cancel:"取消申请",reject:"驳回申请",dispute:"领取异议",recall:"请求撤销交付",ackRecall:"本人确认撤销交付"}[type],r.personName,{requestId:r.id});return;
    }
    if(type==="return"||type==="nonreturn"){
      const l=find("loans",x.loanId);owner(a,l.personId);const qty=fixed(x.qty);if(qty>outstanding(l)-pendingQty(d,l.id))fail("数量超过可处理的持有量，或已有归还/赔偿待办");
      if(type==="return"){const r={id:id(),loanId:l.id,personId:l.personId,qty,status:"pending",at:now()};d.returns.unshift(r);notify(d,"keeper",a.person.name+"申请归还 "+l.name+"×"+num(qty),r.id);log(d,a,"申请归还",l.name+"×"+num(qty));}
      else {if(!openExit(d,l.personId))fail("请先由管理员发起离职清算");if(!l.unitPrice)fail("历史物资赔偿价格缺失，请联系库管核实");const c={id:id(),loanId:l.id,personId:l.personId,personName:l.personName,name:l.name,unit:l.unit,qty,unitPrice:l.unitPrice,currency:l.currency,amount:amount(qty,l.unitPrice),reason:note(),status:"employee_confirmed",at:now()};d.claims.unshift(c);notify(d,"keeper",a.person.name+"确认不归还 "+l.name+"，请核实",c.id);log(d,a,"员工确认赔偿",l.name+"×"+num(qty)+"；"+num(c.amount)+c.currency,{claimId:c.id});}return;
    }
    if(type==="receiveReturn"){
      keeper(a);const r=find("returns",x.id),l=find("loans",r.loanId);if(r.status!=="pending")fail("归还已处理");if(x.accept===false){r.status="rejected";r.reason=note();notify(d,r.personId,"归还未通过："+r.reason,r.id);}
      else {if(r.qty>outstanding(l))fail("持有量已变化");const item=find("items",l.itemId);r.condition=x.condition==="damaged"?"damaged":"usable";r.reason=note();l.returned+=r.qty;r.status="accepted";if(r.condition==="usable")item.stock+=r.qty;else item.damaged+=r.qty;log(d,a,r.condition==="usable"?"归还入库":"损坏归还待处理",l.name+"×"+num(r.qty)+"；"+r.reason,{itemId:item.id,delta:r.condition==="usable"?r.qty:0});notify(d,r.personId,"库管已验收归还："+l.name,r.id);}r.processedAt=now();return;
    }
    if(type==="verifyClaim"){
      keeper(a);const c=find("claims",x.id),l=find("loans",c.loanId);if(c.status!=="employee_confirmed")fail("赔偿状态已变化");if(c.qty>outstanding(l))fail("持有数量已变化");c.keeperNote=note();c.status="keeper_verified";c.keeperId=a.person.id;c.verifiedAt=now();l.writtenOff+=c.qty;log(d,a,"资产报损",c.name+"×"+num(c.qty)+"，不重复扣仓库库存",{claimId:c.id,itemId:l.itemId,delta:0});notify(d,"finance",c.personName+"的物资赔偿待复核",c.id);notify(d,c.personId,"库管已核实不归还物资，等待财务复核",c.id);return;
    }
    if(type==="reviewClaim"){
      finance(a);const c=find("claims",x.id),l=find("loans",c.loanId);if(c.status!=="keeper_verified")fail("此赔偿已处理或尚未经库管核实");c.financeNote=note();c.financeId=a.person.id;c.reviewedAt=now();if(x.accept===true){c.status="finance_approved";notify(d,c.personId,"物资赔偿复核通过，已列入待扣款清单（尚未扣工资）",c.id);notify(d,"keeper",c.personName+"的赔偿复核通过",c.id);}else{c.status="employee_confirmed";l.writtenOff-=c.qty;notify(d,"keeper","财务退回赔偿："+c.financeNote,c.id);notify(d,c.personId,"财务退回赔偿，由库管重新核实",c.id);}log(d,a,x.accept?"财务复核通过":"财务退回",c.personName+"；"+num(c.amount)+c.currency+"；"+c.financeNote,{claimId:c.id});return;
    }
    if(type==="withdrawClaim"){
      const c=find("claims",x.id);owner(a,c.personId);if(c.status!=="employee_confirmed")fail("已核实的赔偿请联系库管、财务处理");d.claims.splice(d.claims.indexOf(c),1);log(d,a,"撤回未核实赔偿",c.name,{claimId:c.id});notify(d,"keeper",c.personName+"撤回不归还确认，需重新处理归还",c.id);return;
    }
    if(type==="legacy"){
      keeper(a);const old=legacyRows(m,d).find(r=>r.legacyId===x.id);if(!old||old.resolution)fail("旧记录已核实或不存在");const p=m.people.find(p=>p.id===x.personId);if(!p)fail("请明确旧记录所属人员");const reason=note();
      if(x.mode==="loan"){const item=find("items",x.itemId);if(!item.recoverable)fail("请选择可回收物资");const qty=fixed(x.qty);d.loans.push({id:id(),personId:p.id,personName:p.name,itemId:item.id,name:item.name,spec:item.spec,unit:item.unit,recoverable:true,unitPrice:item.unitPrice,currency:item.currency,qty,returned:0,writtenOff:0,at:now(),legacyId:old.legacyId});}
      else if(x.mode!=="closed")fail("请选择核实结果");d.legacy.push({id:old.legacyId,personId:p.id,mode:x.mode,reason,at:now(),by:a.person.id});log(d,a,"旧领用核实",old.name+" → "+p.name+"；"+reason);return;
    }
    if(type==="beginExit"){
      admin(a);const p=m.people.find(p=>p.id===x.personId);if(!p||!["在岗","已通过","休假","停用"].includes(p.status))fail("该人员当前不能办理离职");const date=text(x.date,"离职日期",10),reason=note();if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>new Date().toLocaleDateString("sv-SE"))fail("离职日期无效或晚于今天");
      let ex=openExit(d,p.id);if(!ex){ex={id:id(),personId:p.id,status:"open",at:now()};d.exits.unshift(ex);}Object.assign(ex,{date,reason});
      for(const r of d.requests.filter(r=>r.personId===p.id&&r.status==="submitted")){r.status="cancelled";r.reason="发起离职清算，释放未交付预留";log(d,a,"清算取消预留",p.name,{requestId:r.id});}
      notify(d,p.id,"请办理离职物资清算：归还可回收物资；不归还需本人确认赔偿",ex.id);notify(d,"keeper",p.name+"发起离职清算，请核对物资",ex.id);log(d,a,"发起离职清算",p.name+"；"+reason);return;
    }
    if(type==="cancelExit"){admin(a);const ex=openExit(d,x.personId);if(!ex)fail("没有进行中的清算");if(d.claims.some(c=>c.personId===x.personId&&c.at>=ex.at))fail("本次清算存在赔偿记录，不能直接取消，请先处理赔偿");ex.status="cancelled";ex.cancelReason=note();notify(d,x.personId,"管理员已取消离职清算",ex.id);log(d,a,"取消离职清算",ex.cancelReason);return;}
    if(type==="finalizeExit"){
      admin(a);const c=clearance(d,m,x.personId);if(!c.exit||!cleared(c))fail("物资清算未完成，不能办理离职");const p=m.people.find(p=>p.id===x.personId);if(!p||!["在岗","已通过","休假","停用"].includes(p.status))fail("人员状态已变化，请刷新");const previous=p.status;p.status="离职";p.reviewed=false;p.departureDate=c.exit.date;p.departureReason=c.exit.reason;p.employmentHistory=[...(p.employmentHistory||[]),{action:"depart",fromStatus:previous,toStatus:"离职",at:now(),departureDate:p.departureDate,reason:p.departureReason}];c.exit.status="closed";c.exit.closedAt=now();notify(d,p.id,"离职已办结，个人领用历史保留",c.exit.id);log(d,a,"正式办理离职",p.name);return {peopleChanged:true};
    }
    if(type==="read"){const target=a.admin?"admin":a.person.id;for(const msg of d.messages.filter(v=>v.target===target||(active(a.person)&&v.target===(a.person.applicationRole==="middle_store"?"keeper":a.person.applicationRole==="middle_finance"?"finance":""))))if(!msg.readBy.includes(target))msg.readBy.push(target);return;}
    fail("未知操作");
  }
  async function act(type,args,actor){if(!navigator.locks?.request)fail("请使用支持事务锁的新版浏览器操作库存");return navigator.locks.request(KEY,async()=>{const d=get(),m=main(),a=auth(actor,m),before=localStorage.getItem(PEOPLE);const result=dispatch(d,m,a,type,args||{});
      for(const i of d.items){if(!Number.isSafeInteger(i.stock)||i.stock<reserved(d,i.id)||!Number.isSafeInteger(i.damaged)||i.damaged<0)fail("库存校验失败，操作未保存");}
      for(const l of d.loans){if(![l.qty,l.returned,l.writtenOff].every(v=>Number.isSafeInteger(v)&&v>=0)||outstanding(l)<0)fail("持有台账校验失败，操作未保存");}
      let changed=false;try{if(result?.peopleChanged){localStorage.setItem(PEOPLE,JSON.stringify(m));changed=true;}localStorage.setItem(KEY,JSON.stringify(d));}catch(error){if(changed){if(before===null)localStorage.removeItem(PEOPLE);else localStorage.setItem(PEOPLE,before);}throw new Error("保存失败，操作未完成："+error.message);}window.dispatchEvent(new CustomEvent("mine-logistics-change"));return result;});}
  window.MineLogistics={KEY,PEOPLE,get,main,context,currentId,selectSession,act,active,num,fixed,amount,available,reserved,outstanding,openExit,clearance,cleared,legacyRows};
})();

