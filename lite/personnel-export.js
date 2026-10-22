(() => {
  "use strict";
  const roles = {driver:"司机端",excavator:"挖机端",assistant:"辅助司机端",assistant_loader:"辅助司机端",assistant_fuel:"辅助司机端",assistant_water:"辅助司机端",assistant_grader:"辅助司机端",assistant_dump:"辅助司机端",dispatch:"中层管理端",manager:"管理端",middle:"中层管理端",middle_repair_manager:"修理端",repair_worker:"修理端",middle_finance:"中层管理端",middle_survey:"中层管理端",middle_store:"中层管理端",middle_statistics:"中层管理端",middle_logistics:"中层管理端",boss:"Boss端"};
  const actions = {deactivate:"停用",restore:"恢复启用",depart:"办理离职",rehire:"发起返聘审核"};
  const encode = text => new TextEncoder().encode(text);
  const xml = value => String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,"").replace(/[&<>"']/g,char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[char]));
  const colName = index => { let name=""; for(let n=index+1;n;n=Math.floor((n-1)/26)) name=String.fromCharCode(65+(n-1)%26)+name; return name; };
  const asDate = value => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match) return null;
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    const date=new Date(Date.UTC(year,month-1,day));
    return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day && year>=1900 ? date.getTime()/86400000+25569 : null;
  };
  const localParts = value => {
    const date = value instanceof Date ? value : new Date(value);
    if(!Number.isFinite(date.getTime())) return null;
    return Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Ulaanbaatar",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  };
  const asDateTime = value => {
    if(!value) return null;
    const parts=localParts(value);
    return parts ? Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second))/86400000+25569 : null;
  };
  const fields = [
    ["档案编号",p=>p.id,16],["员工编号",p=>p.employeeId || p.staffNo || p.id,16],
    ["姓名",p=>p.name,14],["手机号",p=>p.phone,20],
    ["岗位",p=>p.applicationRole==="dispatch"?"车队长":p.role,18],["申请端口",p=>roles[p.applicationRole] || p.applicationRole,18],
    ["人员类别",p=>p.personType || p.category,16],["所属班组",p=>p.team,18],
    ["国籍",p=>p.nationality,14],["民族",p=>p.ethnicity,14],
    ["入职日期",p=>p.joinDate,16,"date"],["身份证号",p=>p.idNumber,25],
    ["护照号",p=>p.passport,22],["银行卡号",p=>p.bankNumber,27],
    ["开户行",p=>p.bankName,24],["紧急联系人",p=>p.emergencyName,18],
    ["紧急联系人电话",p=>p.emergencyPhone,22],["人员状态",p=>p.status,16],
    ["资料核对状态",p=>p.reviewed===true ? "已核对" : "未核对",18],
    ["停用前状态",p=>p.statusBeforeDisable,18],
    ["最近离职日期",p=>p.departureDate,18,"date"],["最近离职原因",p=>p.departureReason,36],
    ["备注",p=>p.note,42]
  ];
  const vehicleFields = [
    ["档案ID",v=>v.id,22],["车辆编号",v=>v.code,20],["车辆名称",v=>v.name,26],
    ["设备类别",v=>v.category || v.model,20],["大架号 / 车架号",v=>v.vin,28],
    ["发动机号",v=>v.engineNumber,25],["车牌号",v=>v.plate,20],
    ["所属公司 / 车队",v=>v.team,26],["载重 / 斗容",v=>v.capacity,20],
    ["燃油类型",v=>v.fuelType || "未填写",16],["入场日期",v=>v.entryDate,18,"date"],
    ["设备状态",v=>v.status,16],["备注",v=>v.note,42]
  ];
  const historyFields = [
    ["档案编号",r=>r.person.id,16],["员工编号",r=>r.person.employeeId || r.person.staffNo || r.person.id,16],
    ["姓名",r=>r.person.name,14],["操作",r=>actions[r.entry.action] || r.entry.action,20],
    ["变更前状态",r=>r.entry.fromStatus,18],["变更后状态",r=>r.entry.toStatus,18],
    ["操作时间（乌兰巴托时间）",r=>r.entry.at,30,"datetime"],
    ["离职日期",r=>r.entry.departureDate,16,"date"],["离职原因",r=>r.entry.reason,42]
  ];
  function cell(value,reference,kind,header=false) {
    if(header) return '<c r="'+reference+'" s="1" t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>';
    if(value===null || value===undefined || value==="") return '<c r="'+reference+'" s="0"/>';
    if(kind==="number"||kind==="integer"){
      if(typeof value!=="number"||!Number.isFinite(value))throw new Error("导出数值无效，请核实库存数据");
      return '<c r="'+reference+'" s="'+(kind==="integer"?6:5)+'"><v>'+value+'</v></c>';
    }
    const numeric = kind==="date" ? asDate(value) : kind==="datetime" ? asDateTime(value) : null;
    if(numeric!==null) return '<c r="'+reference+'" s="'+(kind==="date" ? 2 : 3)+'"><v>'+numeric+'</v></c>';
    const text=String(value);
    if(text.length>32767) throw new Error("有文字字段超过 Excel 单元格长度限制，请缩短后重试。");
    return '<c r="'+reference+'" s="0" t="inlineStr"><is><t xml:space="preserve">'+xml(text)+'</t></is></c>';
  }
  function worksheet(columns,records,title,notes=[]) {
    if(records.length+notes.length>1048574) throw new Error("记录数量超过 Excel 单个工作表上限。");
    const lastCol=colName(columns.length-1),dataEnd=lastCol+(records.length+2),end=lastCol+(records.length+2+notes.length);
    const titleRow='<row r="1" ht="38" customHeight="1"><c r="A1" s="4" t="inlineStr"><is><t>'+xml(title)+'</t></is></c></row>';
    const header='<row r="2" ht="28" customHeight="1">'+columns.map((field,i)=>cell(field[0],colName(i)+"2",null,true)).join("")+'</row>';
    const rows=records.map((record,row)=>'<row r="'+(row+3)+'">'+columns.map((field,col)=>cell(field[1](record),colName(col)+(row+3),field[3])).join("")+'</row>').join("");
    const noteRows=notes.map((note,index)=>{const row=records.length+3+index;return '<row r="'+row+'" ht="48" customHeight="1">'+cell(note,"A"+row)+'</row>';}).join("");
    const noteMerges=notes.map((note,index)=>{const row=records.length+3+index;return '<mergeCell ref="A'+row+':'+lastCol+row+'"/>';}).join("");
    const widths=columns.map((field,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+field[2]+'" customWidth="1"/>').join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:'+end+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A3" sqref="A3"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="21"/><cols>'+widths+'</cols><sheetData>'+titleRow+header+rows+noteRows+'</sheetData><autoFilter ref="A2:'+dataEnd+'"/><mergeCells count="'+(1+notes.length)+'"><mergeCell ref="A1:'+lastCol+'1"/>'+noteMerges+'</mergeCells></worksheet>';
  }
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font><font><b/><sz val="18"/><color rgb="FF173D31"/><name val="Microsoft YaHei"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF176B4A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFC000"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="13"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1" applyFill="1" applyFont="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1" applyFont="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyFill="1" applyFont="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyFill="1" applyFont="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyFill="1" applyFont="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="3" borderId="1" xfId="0" applyBorder="1" applyFill="1" applyFont="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyBorder="1" applyFill="1" applyFont="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyBorder="1" applyFill="1" applyFont="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const crcTable = Array.from({length:256},(_,index)=>{let value=index;for(let bit=0;bit<8;bit++)value=(value&1) ? 0xedb88320^(value>>>1) : value>>>1;return value>>>0;});
  const crc32 = bytes => {let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
  function zip(files) {
    const local=[],central=[];let offset=0;
    for(const [name,contents] of files){
      const filename=encode(name),data=encode(contents),crc=crc32(data);
      const head=new Uint8Array(30),h=new DataView(head.buffer);
      h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(12,0x0021,true);
      h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,filename.length,true);
      local.push(head,filename,data);
      const directory=new Uint8Array(46),d=new DataView(directory.buffer);
      d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x0800,true);d.setUint16(14,0x0021,true);
      d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,filename.length,true);d.setUint32(42,offset,true);
      central.push(directory,filename);offset+=head.length+filename.length+data.length;
    }
    const centralLength=central.reduce((sum,part)=>sum+part.length,0);
    const end=new Uint8Array(22),v=new DataView(end.buffer);
    v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralLength,true);v.setUint32(16,offset,true);
    const result=new Uint8Array(offset+centralLength+end.length);let cursor=0;
    for(const part of [...local,...central,end]){result.set(part,cursor);cursor+=part.length;}
    return result;
  }
  function matrixWorksheet(spec){
    const {dates,records,title,notes=[]}=spec;
    if(!dates.length||dates.length+2>16384)throw new Error("日期列数量超出Excel限制，请缩短日期范围。");
    if(records.length+notes.length+3>1048576)throw new Error("人员数量超过Excel限制。");
    const last=colName(dates.length+1),totalRow=records.length+3,number=(value,ref,style=8,formula="")=>'<c r="'+ref+'" s="'+style+'">'+(formula?'<f>'+xml(formula)+'</f>':"")+(value==null?"":'<v>'+value+'</v>')+'</c>';
    const text=(value,ref,style)=>'<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>';
    const titleRow='<row r="1" ht="34" customHeight="1">'+text(title,"A1",12)+'</row>';
    const headers='<row r="2" ht="28" customHeight="1">'+text("姓名","A2",9)+dates.map((date,index)=>text(date,colName(index+1)+"2",9)).join("")+text("合计",last+"2",11)+'</row>';
    const rows=records.map((record,index)=>{const row=index+3,total=record.values.reduce((sum,value)=>sum+(value||0),0);return '<row r="'+row+'" ht="23" customHeight="1">'+text(record.name,"A"+row,7)+record.values.map((value,col)=>number(value,colName(col+1)+row)).join("")+number(total,last+row,10,"SUM(B"+row+":"+colName(dates.length)+row+")")+'</row>';}).join("");
    const sums=dates.map((date,col)=>records.reduce((sum,record)=>sum+(record.values[col]||0),0));
    const footer='<row r="'+totalRow+'" ht="25" customHeight="1">'+text("合计","A"+totalRow,9)+sums.map((value,col)=>number(value,colName(col+1)+totalRow,8,records.length?"SUM("+colName(col+1)+"3:"+colName(col+1)+(totalRow-1)+")":"0")).join("")+number(sums.reduce((a,b)=>a+b,0),last+totalRow,10,"SUM(B"+totalRow+":"+colName(dates.length)+totalRow+")")+'</row>';
    const noteRows=notes.map((note,index)=>{const row=totalRow+index+1;return '<row r="'+row+'" ht="42" customHeight="1">'+cell(note,"A"+row)+'</row>';}).join("");
    const merges='<mergeCell ref="A1:'+last+'1"/>'+notes.map((note,index)=>{const row=totalRow+index+1;return '<mergeCell ref="A'+row+':'+last+row+'"/>';}).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:'+last+(totalRow+notes.length)+'"/><sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="2" topLeftCell="B3" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="B3" sqref="B3"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="23"/><cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="'+(dates.length+1)+'" width="11" customWidth="1"/><col min="'+(dates.length+2)+'" max="'+(dates.length+2)+'" width="13" customWidth="1"/></cols><sheetData>'+titleRow+headers+rows+footer+noteRows+'</sheetData><autoFilter ref="A2:'+last+(records.length+2)+'"/><mergeCells count="'+(notes.length+1)+'">'+merges+'</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="8" orientation="landscape"/></worksheet>';
  }
  function buildWorkbook(people) {
    if(!Array.isArray(people) || !people.length) throw new Error("暂无人员档案可导出。");
    const history=people.flatMap(person=>(Array.isArray(person.employmentHistory)?person.employmentHistory:[]).map(entry=>({person,entry})));
    const sheets=[["人员档案",worksheet(fields,people,"矿山管理系统人员档案")],["任职状态记录",worksheet(historyFields,history,"矿山管理系统人员任职状态记录")]];
    return createWorkbook(sheets);
  }
  function buildVehicleWorkbook(vehicles) {
    if(!Array.isArray(vehicles) || !vehicles.length) throw new Error("暂无车辆档案可导出。");
    return createWorkbook([["车辆档案",worksheet(vehicleFields,vehicles,"矿山管理系统车辆档案")]]);
  }
  function createWorkbook(sheets) {
    const contentTypes='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((sheet,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("")+'</Types>';
    const workbook='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheets.map((sheet,i)=>'<sheet name="'+xml(sheet[0])+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join("")+'</sheets></workbook>';
    const relations='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((sheet,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join("")+'<Relationship Id="rId'+(sheets.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    return zip([["[Content_Types].xml",contentTypes],["_rels/.rels",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],["xl/workbook.xml",workbook],["xl/_rels/workbook.xml.rels",relations],["xl/styles.xml",styles],...sheets.map((sheet,i)=>["xl/worksheets/sheet"+(i+1)+".xml",sheet[1]])]);
  }
  function download(people) { return downloadFile(buildWorkbook(people),"人员档案"); }
  function downloadVehicles(vehicles) { return downloadFile(buildVehicleWorkbook(vehicles),"车辆档案"); }
  function downloadFile(bytes,prefix) {
    const parts=localParts(new Date());
    const filename=prefix+"_"+parts.year+"-"+parts.month+"-"+parts.day+"_"+parts.hour+parts.minute+parts.second+".xlsx";
    const url=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const link=document.createElement("a");
    link.href=url;link.download=filename;document.body.appendChild(link);
    try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
    return filename;
  }
  window.MineTableExport={downloadSheets:(specs,title)=>downloadFile(createWorkbook(specs.map(spec=>[spec.name,spec.matrix?matrixWorksheet(spec):worksheet(spec.columns,spec.records,spec.title,spec.notes||[])])),title),download:(columns,records,title,options={})=>{if(!records.length)throw new Error("暂无记录可导出");return downloadFile(createWorkbook([[title.slice(0,31),worksheet(columns,records,title,options.notes||[])]]),title);}};
  window.MinePersonnelExport={buildWorkbook,download};
  window.MineVehicleExport={buildWorkbook:buildVehicleWorkbook,download:downloadVehicles};
})();
