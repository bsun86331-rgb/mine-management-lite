(()=>{"use strict";
const role=new URLSearchParams(location.search).get("role"),host=document.getElementById("board");let identity=null,signature="",busy=false;
window.MineSharedTaskAccess=()=>{
 let p;
 if(role==="admin"||role==="boss"){
  const flag=role==="admin"?"MineLogisticsAdmin":"MineLeaveBoss";
  if(parent===window||parent.location.origin!==location.origin||parent[flag]!==true)throw Error("请登录对应管理端后打开共享任务看板");
  p={id:role,applicationRole:role,name:role==="admin"?"管理员":"Boss"};
 }else{p=MineLogistics.context(role);if(!["在岗","已通过","休假","请假"].includes(p.status))throw Error("当前人员状态不能查看任务看板");}
 if(identity&&identity!==p.id)throw Error("本人登记已变化，请重新打开看板");identity=p.id;return p;
};
async function render(){if(busy)return;busy=true;try{const p=MineSharedTaskAccess();await MineTransport.sync();const d=MineTransport.get(),m=MineLogistics.main(),key=MineTransport.stamp()+MineTaskBoard.clockKey(d)+JSON.stringify(m)+p.id;if(signature!==key){host.innerHTML=MineTaskBoard.render(d,m,p,{readOnly:true,shared:true,hideTitle:true});signature=key;}}catch(e){host.textContent=e.message;signature="";}finally{busy=false;}}
window.addEventListener("focus",render);window.addEventListener("storage",render);setInterval(render,1000);render();})();