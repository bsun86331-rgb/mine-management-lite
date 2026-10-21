(()=>{"use strict";
const T=window.MineTransport,L=window.MineLogistics,$=id=>document.getElementById(id),role=new URLSearchParams(location.search).get("role");
const allowed=["driver","excavator","dispatch","assistant","assistant_loader","assistant_fuel","assistant_water","assistant_grader","assistant_dump","middle","middle_repair_manager","middle_finance","middle_survey","middle_store","middle_statistics","middle_logistics","admin","boss"];
let identity=null,history=null,busy=false,signature="";
function access(){
 if(!allowed.includes(role))throw Error("请从本人工作主页打开车数统计表");
 let p;
 if(role==="admin"||role==="boss"){
  const flag=role==="admin"?"MineLogisticsAdmin":"MineLeaveBoss";
  if(parent===window||parent.location.origin!==location.origin||parent[flag]!==true)throw Error("请登录对应管理端后打开车数统计表");
  p={id:role,applicationRole:role,name:role==="admin"?"管理员":"Boss"};
 }else{p=L.context(role);if(!["在岗","已通过","休假","请假"].includes(p.status))throw Error("当前人员状态不能查看车数统计表");}
 if(identity&&identity!==p.id)throw Error("本人登记已变化，请重新打开统计表");identity=p.id;return p;
}
window.MineSharedTaskAccess=access;
function toast(text){$("toast").textContent=text;$("toast").classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>$("toast").classList.remove("show"),4500);}
const report=MineHaulReport.create({data:()=>{access();return {d:T.get(),m:L.main()};},subtitle:text=>$("subtitle").textContent=text,exportReady:ready=>$("exportHaulSummary").disabled=!ready,toast});
function paint(){const p=access();$("reportError").textContent="";$("exportHaulSummary").hidden=!!history;
 if(history){$("subtitle").textContent=history.workDate+" · "+history.team;$("report").innerHTML=MineTaskBoard.render(T.get(),L.main(),p,{readOnly:true,shared:true,history,hideTitle:true});}
 else $("report").innerHTML=report.render();
}
function fail(e){$("report").textContent="";$("subtitle").textContent="";$("reportError").textContent=e.message;$("exportHaulSummary").disabled=true;signature="";}
async function refresh(force=false){if(busy)return;busy=true;try{access();await T.sync();const key=T.stamp()+JSON.stringify(L.main())+T.date();if(force||key!==signature){paint();signature=key;}}catch(e){fail(e);}finally{busy=false;}}
$("exportHaulSummary").onclick=()=>{try{access();report.export();}catch(e){fail(e);}};
$("back").onclick=()=>{if(parent!==window)parent.postMessage({type:"mine-close-haul-report"},location.origin);else location.href=role==="admin"?"management.html":role==="boss"?"boss.html":role==="middle_store"?"logistics.html?role=middle_store":["driver","excavator","dispatch"].includes(role)?"transport.html?role="+encodeURIComponent(role):"portal.html?role="+encodeURIComponent(role||"");};
document.addEventListener("click",event=>{const b=event.target.closest("[data-action]");if(!b)return;try{access();const action=b.dataset.action,key=b.dataset.id;
 if(action==="haulSummaryMode"&&["crew","person","equipment"].includes(key)){report.filters.mode=key;paint();}
 if(action==="haulSummaryDay"){const [workDate,team]=String(key||"").split("|");if(!MineHaulReport.validDate(workDate)||!["生产A组","生产B组"].includes(team))return;history={workDate,team};paint();}
 if(action==="backHaulSummary"||action==="exitHaulHistory"){history=null;paint();}
}catch(e){fail(e);}});
document.addEventListener("change",event=>{try{access();const name=event.target.name,value=event.target.value;
 const fields={haulSummaryStartDate:"startDate",haulSummaryEndDate:"endDate",haulSummaryPerson:"personId",haulSummaryVehicle:"vehicleId"};
 if(fields[name]){report.filters[fields[name]]=name.endsWith("Date")?(MineHaulReport.validDate(value)?value:null):String(value||"");paint();return;}
 if(name==="coalRatioPeriod")report.settings.period=value==="custom"?"custom":"natural";
 else if(name==="coalRatioMonth")report.settings.month=MineHaulReport.validDate(value+"-01")?value:null;
 else if(name==="coalRatioStartDay"||name==="coalRatioEndDay"){const day=Number(value);if(Number.isInteger(day)&&day>=1&&day<=31)report.settings[name==="coalRatioStartDay"?"startDay":"endDay"]=day;}
 else return;paint();
}catch(e){fail(e);}});
window.addEventListener("focus",()=>refresh());window.addEventListener("storage",()=>refresh());setInterval(()=>refresh(),1000);refresh(true);
})();