(()=>{"use strict";
function create(optionsUI={}){
 const T=window.MineTransport;
   const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const input=(name,label,value="",type="text",extra="")=>'<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value??"")+'" '+extra+'></label>';
  const select=(name,label,options,value="")=>'<label>'+label+'<select name="'+name+'">'+options.map(([v,t])=>'<option value="'+esc(v)+'"'+(String(v)===String(value)?' selected':'')+'>'+esc(t)+'</option>').join("")+'</select></label>';

 const haulSummaryFilters=optionsUI.filters||{startDate:null,endDate:null,mode:"crew",personId:"",vehicleId:""};
 const haulSummaryTitles={crew:"班组逐日车数统计",person:"人员逐日车数统计",equipment:"设备逐日车数统计"};
 const coalRatioSettings=optionsUI.settings||{period:"natural",startDay:1,endDay:31,month:null};
 let d,m,haulSummaryExportData=null;
 const toast=text=>optionsUI.toast?.(text);
 function refresh(){const data=optionsUI.data();d=data.d;m=data.m;haulSummaryExportData=null;optionsUI.exportReady?.(false);return renderHaulSummary();}
   function haulSummaryValidDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+"T00:00:00Z"))&&new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value;}
  function haulSummaryScope(){
    const today=T.date(),startDate=haulSummaryFilters.startDate||today.slice(0,7)+"-01",endDate=haulSummaryFilters.endDate||today;
    const error=!haulSummaryValidDate(startDate)||!haulSummaryValidDate(endDate)?"请选择有效的开始日期和结束日期":startDate>endDate?"开始日期不能晚于结束日期，请调整日期范围":"";
    return {startDate,endDate,error,mode:haulSummaryFilters.mode,personId:haulSummaryFilters.personId,vehicleId:haulSummaryFilters.vehicleId};
  }
  function haulSummaryContext(scope){
    const blank=()=>({total:0,crewA:0,crewB:0,otherCrew:0,haul:0,load:0,"渣":0,"煤":0,"只记车数":0,unknown:0});
    const start=Date.parse(scope.startDate+"T00:00:00Z"),end=Date.parse(scope.endDate+"T00:00:00Z"),length=scope.error?0:Math.round((end-start)/86400000)+1;
    const days=Array.from({length},(_,index)=>({workDate:new Date(start+index*86400000).toISOString().slice(0,10),...blank()})),byDate=new Map(days.map(row=>[row.workDate,row]));
    const releases=new Map(d.taskReleases.map(r=>[r.id,r])),assignments=new Map(d.assignments.map(a=>[a.id,a])),people=new Map(m.people.map(p=>[String(p.id),p])),vehicles=new Map(m.vehicles.map(v=>[String(v.id),v]));
    const trips=[...new Map(d.trips.filter(t=>t.status==="completed"&&t.mode==="gps"&&byDate.has(t.workDate)).map(t=>[t.id,t])).values()],operators=new Map();
    const operatorId=t=>{if(!operators.has(t.id))operators.set(t.id,MineTaskBoard.excavatorOperator(d,t));return operators.get(t.id);};
    return {blank,days,byDate,releases,assignments,people,vehicles,trips,operatorId};
  }
  function haulSummaryPersonGroup(scope){return {"__crew_a_persons__":"生产A组","__crew_b_persons__":"生产B组"}[scope.personId]||"";}
  function haulSummaryPersonMulti(scope){return scope.personId==="__all_persons__"||!!haulSummaryPersonGroup(scope);}
  function haulSummaryPersonMatches(id,scope,context,trip=null){
    if(scope.personId==="__all_persons__")return true;
    const team=haulSummaryPersonGroup(scope);
    if(!team)return id!=null&&id!==""&&String(id)===scope.personId;
    const person=context.people.get(String(id));
    const sourceTeam=trip?(context.releases.get(trip.releaseId)?.team||context.assignments.get(trip.assignmentId)?.team):"";
    return (person?.team||sourceTeam)===team;
  }
  function haulSummaryOptions(scope,context){
    const entries=new Map(),add=(id,name,description)=>{if(id!=null&&id!==""&&!entries.has(String(id)))entries.set(String(id),{name:name||String(id),label:(name||String(id))+(description?" · "+description:"")+"（"+id+"）"});};
    if(scope.mode==="person"){
      for(const p of m.people.filter(p=>["driver","excavator"].includes(p.applicationRole)))add(p.id,p.name,p.role);
      for(const t of context.trips){
        const driver=context.people.get(String(t.personId));add(t.personId,driver?.name||t.personName,driver?.role||"汽车司机");
        const id=context.operatorId(t),operator=context.people.get(String(id)),source=context.releases.get(t.releaseId),group=source?.groups?.find(g=>g.excavatorId===t.excavatorId);
        const actual=d.shifts.find(s=>s.kind==="excavator"&&s.personId===id&&s.vehicleId===t.excavatorId&&s.workDate===t.workDate&&s.shiftName===t.shiftName);
        add(id,operator?.name||actual?.personName||(group?.excavatorDriverId===id?group.excavatorDriverName:""),operator?.role||"挖机司机");
      }
      if(scope.personId&&!haulSummaryPersonMulti(scope)&&!entries.has(scope.personId)){const p=context.people.get(scope.personId);add(scope.personId,p?.name,p?.role||"原人员");}
    }else if(scope.mode==="equipment"){
      for(const v of m.vehicles.filter(v=>T.isExcavator(v)||T.isHaulTruck(v)))add(v.id,v.code||v.name,v.category||v.model);
      for(const t of context.trips){
        const truck=context.vehicles.get(String(t.vehicleId)),exc=context.vehicles.get(String(t.excavatorId));
        add(t.vehicleId,truck?.code||t.vehicleCode,truck?.category||truck?.model||"汽车");
        add(t.excavatorId,exc?.code||t.excavatorCode,exc?.category||exc?.model||"挖机");
      }
      if(scope.vehicleId&&!["__all_excavators__","__all_trucks__"].includes(scope.vehicleId)&&!entries.has(scope.vehicleId)){const v=context.vehicles.get(scope.vehicleId);add(scope.vehicleId,v?.code||v?.name,v?.category||v?.model||"原设备");}
    }
    return [...entries.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name,"zh-CN",{numeric:true})||a[0].localeCompare(b[0])).map(([id,value])=>[id,value.label]);
  }
  function haulSummaryData(scope,context){
    const totals=context.blank();
    for(const t of context.trips){
      let hauling=false,loading=false;
      if(scope.mode==="person"){
        const all=scope.personId==="__all_persons__",operatorId=context.operatorId(t);
        hauling=t.personId!=null&&t.personId!==""&&haulSummaryPersonMatches(t.personId,scope,context,t);
        loading=operatorId!=null&&operatorId!==""&&haulSummaryPersonMatches(operatorId,scope,context,t);
        const unassigned=(t.personId==null||t.personId==="")&&(operatorId==null||operatorId==="")&&haulSummaryPersonMulti(scope)&&haulSummaryPersonMatches(null,scope,context,t);
        if(!scope.personId||(!all&&!hauling&&!loading&&!unassigned))continue;
      }else if(scope.mode==="equipment"){
        hauling=scope.vehicleId==="__all_trucks__"?(t.vehicleId!=null&&t.vehicleId!==""):scope.vehicleId==="__all_excavators__"?false:String(t.vehicleId)===scope.vehicleId;loading=scope.vehicleId==="__all_excavators__"?(t.excavatorId!=null&&t.excavatorId!==""):scope.vehicleId==="__all_trucks__"?false:String(t.excavatorId)===scope.vehicleId;
        if(!scope.vehicleId||(!hauling&&!loading))continue;
      }
      const team=context.releases.get(t.releaseId)?.team||context.assignments.get(t.assignmentId)?.team||context.people.get(String(t.personId))?.team;
      const crew=team==="生产A组"?"crewA":team==="生产B组"?"crewB":"otherCrew",material=T.materialTypes.includes(t.material)?t.material:"unknown",row=context.byDate.get(t.workDate);
      row.total++;row[crew]++;row[material]++;totals.total++;totals[crew]++;totals[material]++;
      if(hauling){row.haul++;totals.haul++;}if(loading){row.load++;totals.load++;}
    }
    return {days:context.days,totals};
  }
  function haulSummaryPeopleRows(context,options,scope){
    const nameCounts=new Map();
    for(const [id,label] of options){const name=context.people.get(id)?.name||label;nameCounts.set(name,(nameCounts.get(name)||0)+1);}
    const people=new Map(options.map(([id,label])=>{const name=context.people.get(id)?.name||label;return [id,{id,name:name+(nameCounts.get(name)>1?"（"+id+"）":"")}];}));
    const rows=new Map(),key=(date,id)=>JSON.stringify([date,id]);
    for(const day of context.days)for(const person of people.values())if(haulSummaryPersonMatches(person.id,scope,context))rows.set(key(day.workDate,person.id),{workDate:day.workDate,personId:person.id,personName:person.name,...context.blank()});
    for(const trip of context.trips){
      const operator=context.operatorId(trip),driver=trip.personId,actualIds=[...new Set([driver,operator].filter(id=>id!=null&&id!=="").map(String))],ids=actualIds.filter(id=>haulSummaryPersonMatches(id,scope,context,trip));
      if(!actualIds.length&&haulSummaryPersonMatches(null,scope,context,trip))ids.push("__unassigned_person__");
      for(const id of ids){
        const rowKey=key(trip.workDate,id);
        if(!rows.has(rowKey))rows.set(rowKey,{workDate:trip.workDate,personId:id,personName:people.get(id)?.name||"历史未归属",...context.blank()});
        const row=rows.get(rowKey),material=T.materialTypes.includes(trip.material)?trip.material:"unknown";
        row.total++;row[material]++;
        if(driver!=null&&driver!==""&&String(driver)===id)row.haul++;
        if(operator!=null&&operator!==""&&String(operator)===id)row.load++;
      }
    }
    return [...rows.values()].sort((a,b)=>a.workDate.localeCompare(b.workDate)||a.personName.localeCompare(b.personName,"zh-CN",{numeric:true})||a.personId.localeCompare(b.personId));
  }
  function renderCoalRatio(scope,entityName){
    const settings=coalRatioSettings,month=settings.month||T.date().slice(0,7),year=Number(month.slice(0,4)),monthIndex=Number(month.slice(5,7))-1;
    const dateAt=(offset,day)=>{const last=new Date(Date.UTC(year,monthIndex+offset+1,0)).getUTCDate();return new Date(Date.UTC(year,monthIndex+offset,Math.min(day,last))).toISOString().slice(0,10);};
    const custom=settings.period==="custom",startDate=dateAt(0,custom?settings.startDay:1),endDate=custom?dateAt(settings.endDay<settings.startDay?1:0,settings.endDay):dateAt(0,31);
    const ratioScope={...scope,startDate,endDate,error:"",personId:scope.personId||"__all_persons__",mode:scope.mode==="equipment"&&!scope.vehicleId?"crew":scope.mode},context=haulSummaryContext(ratioScope),{totals}=haulSummaryData(ratioScope,context),percent=totals.total?(totals["煤"]/totals.total*100).toFixed(2)+"%":"—";
    const dayOptions=Array.from({length:31},(_,i)=>[String(i+1),String(i+1)+"号"]);
    return '<section class="coal-ratio-panel" aria-label="煤渣比例"><div class="coal-ratio-heading"><h2>煤渣比例</h2><span>'+esc(scope.mode==="crew"?"班组汇总":scope.mode==="person"?(scope.personId?entityName:"全员"):(scope.vehicleId?entityName:"全部设备"))+' · '+esc(startDate)+' 至 '+esc(endDate)+'</span></div><div class="coal-ratio-values"><div><span>渣车数</span><strong>'+totals["渣"]+'<small> 车</small></strong></div><div><span>煤车数</span><strong>'+totals["煤"]+'<small> 车</small></strong></div><div><span>煤占总车数</span><strong>'+percent+'</strong></div></div><div class="coal-ratio-controls">'+select("coalRatioPeriod","统计周期",[["natural","自然月"],["custom","自定义每月几号到几号"]],settings.period)+input("coalRatioMonth","统计月份",month,"month")+(custom?select("coalRatioStartDay","每月开始日",dayOptions,settings.startDay)+select("coalRatioEndDay","每月结束日",dayOptions,settings.endDay):"")+'</div><p class="help">煤占比＝煤车数 ÷ 总车数；总车数含渣、煤、只记车数及历史未分类，每趟只计一次。'+(totals.total?"":"暂无有效车次，比例显示“—”。")+(custom?"结束日小于开始日时跨至次月，月份没有对应日期时取当月最后一天。":"自然月按当月1日至最后一天统计。")+'</p></section>';
  }
  function renderHaulSummary(){
    const scope=haulSummaryScope(),context=haulSummaryContext(scope),options=haulSummaryOptions(scope,context),{days,totals}=haulSummaryData(scope,context),today=T.date(),showOther=totals.otherCrew>0,showUnknown=totals.unknown>0;

    const entityId=scope.mode==="person"?scope.personId:scope.vehicleId,entityName=scope.mode==="person"?(entityId==="__all_persons__"?"全员":haulSummaryPersonGroup(scope)||context.people.get(entityId)?.name||options.find(([id])=>id===entityId)?.[1]||entityId):(entityId==="__all_excavators__"?"全部挖机":entityId==="__all_trucks__"?"全部汽车":context.vehicles.get(entityId)?.code||context.vehicles.get(entityId)?.name||options.find(([id])=>id===entityId)?.[1]||entityId);
    const modeLabel=scope.mode==="crew"?"生产A组 / 生产B组":scope.mode==="person"?(entityId?"人员："+entityName:"按人名逐日统计"):(entityId?"设备："+entityName:"按设备逐日统计");
    optionsUI.subtitle?.(scope.startDate+" 至 "+scope.endDate+" · "+modeLabel);
    const tabs='<div class="haul-summary-mode-tabs" role="group" aria-label="逐日统计方式">'+[["crew","班组逐日统计"],["person","按人名逐日统计"],["equipment","按设备逐日统计"]].map(([key,label])=>'<button type="button" data-action="haulSummaryMode" data-id="'+key+'" class="'+(scope.mode===key?"":"soft")+'" aria-pressed="'+(scope.mode===key)+'">'+label+'</button>').join("")+'</div>';
    const subject=scope.mode==="person"?select("haulSummaryPerson","人员",[["","请选择人员（选填）"],["__all_persons__","全员"],["__crew_a_persons__","生产A组"],["__crew_b_persons__","生产B组"],...options],scope.personId):scope.mode==="equipment"?select("haulSummaryVehicle","设备",[["","请选择设备（选填）"],["__all_excavators__","全部挖机"],["__all_trucks__","全部汽车"],...options],scope.vehicleId):"";
    const ratioPanel=renderCoalRatio(scope,entityName);
    const filters='<div class="haul-summary-filters haul-month-filter">'+subject+input("haulSummaryStartDate","开始日期",scope.startDate,"date")+input("haulSummaryEndDate","结束日期",scope.endDate,"date")+'</div>',toolbar='<div class="haul-summary-toolbar">'+tabs+filters+'</div>';
    if(scope.error)return '<section class="haul-summary">'+ratioPanel+toolbar+'<section class="panel"><p class="haul-summary-range-error" role="alert">'+esc(scope.error)+'</p></section></section>';
    if(scope.mode!=="crew"&&!entityId)return '<section class="haul-summary">'+ratioPanel+toolbar+'<section class="panel"><p class="help">请选择'+(scope.mode==="person"?"人员":"设备")+'，查看所选日期范围每天的车数及区间合计。</p></section></section>';
    let line;
    if(scope.mode==="crew")line='<span>生产A组 <b>'+totals.crewA+'</b> 车</span><span>生产B组 <b>'+totals.crewB+'</b> 车</span>'+(showOther?'<span>其他/未归属 <b>'+totals.otherCrew+'</b> 车</span>':"")+'<strong>区间合计 <b>'+totals.total+'</b> 车</strong>';
    else if(scope.mode==="person")line='<span>'+esc(entityName)+'</span><span>拉运 <b>'+totals.haul+'</b> 车</span><span>装车 <b>'+totals.load+'</b> 车</span><strong>区间合计 <b>'+totals.total+'</b> 车</strong>';
    else line='<span>'+esc(entityName)+'</span>'+T.materialTypes.map(name=>'<span>'+esc(name)+' <b>'+totals[name]+'</b> 车</span>').join("")+'<strong>区间合计 <b>'+totals.total+'</b> 车</strong>';
    const roleColumns=scope.mode==="crew"?[["crewA","生产A组"],["crewB","生产B组"],...(showOther?[["otherCrew","其他/未归属"]]:[])]:scope.mode==="person"?[["haul","拉运车数"],["load","装车车数"]]:[];
    const columns=[...roleColumns,...T.materialTypes.map(name=>[name,name]),...(showUnknown?[["unknown","历史未分类"]]:[])];
    const allPeople=scope.mode==="person"&&haulSummaryPersonMulti(scope),displayRows=allPeople?haulSummaryPeopleRows(context,options,scope):days;
    haulSummaryExportData={scope,modeLabel,allPeople,totals,columns,context,options,rows:displayRows.map(row=>({...row,future:row.workDate>today&&row.total===0}))};
    optionsUI.exportReady?.(true);
    const head='<th>日期</th>'+(allPeople?'<th>姓名</th>':"")+columns.map(([key,label])=>'<th class="haul-summary-number'+(["crewA","crewB"].includes(key)?' haul-crew-heading':'')+'">'+esc(label)+'</th>').join("")+'<th class="haul-summary-number">当日合计</th>';
    const body=displayRows.map(row=>{
      const future=row.workDate>today&&row.total===0,value=n=>future?"—":n;
      return '<tr class="'+(future?"haul-summary-future":row.workDate===today?"haul-summary-today":"")+'"><td>'+esc(row.workDate)+'</td>'+(allPeople?'<td>'+esc(row.personName)+'</td>':"")+columns.map(([key])=>'<td class="haul-summary-number">'+(scope.mode==="crew"&&["crewA","crewB"].includes(key)?'<button type="button" class="haul-summary-day-link" data-action="haulSummaryDay" data-id="'+esc(row.workDate+"|"+(key==="crewA"?"生产A组":"生产B组"))+'" aria-label="'+esc(row.workDate+" "+(key==="crewA"?"生产A组":"生产B组")+" "+row[key]+"车，查看当天任务看板")+'">'+value(row[key])+'</button>':value(row[key]))+'</td>').join("")+'<td class="haul-summary-number haul-summary-total">'+value(row.total)+'</td></tr>';
    }).join("");
    const footer='<tr><td'+(allPeople?' colspan="2"':"")+'>'+(allPeople?'区间合计（车次去重）':'区间合计')+'</td>'+columns.map(([key])=>'<td class="haul-summary-number">'+totals[key]+'</td>').join("")+'<td class="haul-summary-number">'+totals.total+'</td></tr>';
    return '<section class="haul-summary">'+ratioPanel+toolbar+'<div class="haul-summary-line haul-crew-strip">'+line+'</div><section class="panel"><div class="table-wrap"><table class="haul-summary-table haul-crew-month-table" aria-label="'+esc(haulSummaryTitles[scope.mode])+'"><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody><tfoot>'+footer+'</tfoot></table></div></section><p class="help">单位：车。夜班按开始日归属，跨月仍计入开始日所在月份。仅统计已完成的真实定位车次，非卸载区完成同样计入；每趟在合计中只计一次。未来日期暂无记录时显示“—”。'+(scope.mode==="person"?' 拉运按实际汽车驾驶员统计，装车按实际装载挖机及其对应司机统计，包含临时挖机装载。':scope.mode==="equipment"?' 按车次记录中的实际汽车或实际装载挖机统计，包含临时挖机装载。':"")+(allPeople?' 所选范围人员按日期和姓名逐行展示，含零车数司机；同一趟分别归属汽车司机和挖机司机，个人行不可相加作为总车数，底部合计按实际车次去重。':"")+(scope.mode==="crew"&&showOther?' 旧记录的其他或未归属班组车次单独列出。':"")+(showUnknown?' 旧物料未归入统一三类时单独显示“历史未分类”。':"")+'</p></section>';
  }
  function personnelMatrixSheets(report){
    const {scope,context,options}=report,all=haulSummaryPersonMulti(scope),today=T.date();
    return [["driver","汽车司机汇总","汽车拉运车数统计表","haul"],["excavator","挖机司机汇总","挖机装车数统计表","load"]].map(([roleCode,name,heading,kind])=>{
      const people=new Map(),add=(id,label,trip=null)=>{if(id==null||id===""||(!all&&String(id)!==scope.personId)||!haulSummaryPersonMatches(id,scope,context,trip))return;id=String(id);if(!people.has(id))people.set(id,{id,name:context.people.get(id)?.name||label||id,counts:new Map()});};
      for(const p of m.people)if(p.applicationRole===roleCode)add(p.id,p.name);
      for(const t of context.trips){
        const id=kind==="haul"?t.personId:context.operatorId(t),hasEquipment=kind==="haul"?t.vehicleId:t.excavatorId;
        if(!hasEquipment||!haulSummaryPersonMatches(id,scope,context,t))continue;
        if(id==null||id===""){if(all)add("__unassigned_"+kind+"__","历史未归属",t);}
        else add(id,options.find(([key])=>key===String(id))?.[1],t);
        const row=people.get(id==null||id===""?"__unassigned_"+kind+"__":String(id));
        if(row)row.counts.set(t.workDate,(row.counts.get(t.workDate)||0)+1);
      }
      const duplicateNames=new Map();for(const p of people.values())duplicateNames.set(p.name,(duplicateNames.get(p.name)||0)+1);
      const records=[...people.values()].sort((a,b)=>a.name.localeCompare(b.name,"zh-CN",{numeric:true})||a.id.localeCompare(b.id)).map(p=>({name:p.name+(duplicateNames.get(p.name)>1?"（"+p.id+"）":""),values:context.days.map(day=>day.workDate>today&&!p.counts.has(day.workDate)?null:p.counts.get(day.workDate)||0)}));
      const crossYear=scope.startDate.slice(0,4)!==scope.endDate.slice(0,4);
      const dates=context.days.map(day=>crossYear?day.workDate:Number(day.workDate.slice(5,7))+"月"+Number(day.workDate.slice(8,10))+"日");
      return {name,title:scope.startDate+"至"+scope.endDate+" "+heading,dates,records,matrix:true,notes:["单位：车。"+(haulSummaryPersonGroup(scope)||(all?"全部人员":"当前所选人员"))+"；按班次开始日归属，仅统计已完成真实定位车次。",kind==="haul"?"汽车司机按每趟实际驾驶员统计。":"挖机司机按实际装载设备对应司机统计，包含临时挖机。","无车数显示0，未来暂无记录留空；汽车与挖机分别统计，同一趟不能将两张表相加作为总拉运数。"]};
    });
  }
  function exportHaulSummary(){
    refresh();
    const report=haulSummaryExportData;
    if(!report)return toast("请先选择有效的日期范围和统计对象");
    if(!window.MineTableExport)return toast("导出组件尚未加载，请刷新页面");
    const {scope,modeLabel,allPeople,totals,columns}=report;
    const fields=[["日期",r=>r.workDate,26,"date"],...(allPeople?[["姓名",r=>r.personName,24]]:[]),...columns.map(([key,label])=>[label,r=>r.future?null:r[key],18,"integer"]),["当日合计",r=>r.future?null:r.total,18,"integer"]];
    const rows=[...report.rows,{...totals,workDate:allPeople?"区间合计（车次去重）":"区间合计",personName:""}];
    const notes=["单位：车。仅统计已完成的真实定位车次，按班次开始日归属；未来日期暂无记录的数值留空。",...(scope.mode==="person"?["拉运按实际汽车司机、装车按实际装载挖机对应司机归属，包含临时挖机。"]:[]),...(allPeople?["所选范围人员按日期和姓名列出，含零车数人员；同一趟分别归属汽车和挖机司机，个人行不能相加作为总车数，区间合计按实际车次去重。"]:[]),...(scope.mode==="equipment"?["按车次实际汽车或实际装载挖机归集，包含临时挖机。"]:[]),...(totals.unknown?["历史未分类车次保留在单独分类和合计中。"]:[])];
    const title=(haulSummaryTitles[scope.mode]+"_"+scope.startDate+"至"+scope.endDate+"_"+modeLabel).replace(/[\\/:*?"<>|\[\]]/g,"_");
    try{if(scope.mode==="person")window.MineTableExport.downloadSheets([{name:"人员逐日明细",columns:fields,records:rows,title,notes},...personnelMatrixSheets(report)],title);else window.MineTableExport.download(fields,rows,title,{notes});toast("Excel 已导出");}catch(error){toast("导出失败："+error.message);}
  }

 return Object.freeze({render:refresh,export:exportHaulSummary,filters:haulSummaryFilters,settings:coalRatioSettings});
}
window.MineHaulReport=Object.freeze({create,validDate:value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+"T00:00:00Z"))&&new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value});
})();