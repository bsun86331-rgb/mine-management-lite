(()=>{"use strict";
const finite=value=>value!==""&&value!=null&&Number.isFinite(Number(value))&&Number(value)>=0;
const metric=v=>/挖|装载|铲车|推土/.test(String(v?.category||v?.model||""))?"hours":"km";
const unit=v=>metric(v)==="hours"?"小时":"公里";
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value))&&Number.isFinite(Date.parse(value+"T00:00:00Z"))&&new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value;}
function latest(d,v){return (d.meterReadings||[]).filter(r=>r.vehicleId===v.id&&r.metric===metric(v)).slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||Number(b.sequence||0)-Number(a.sequence||0))[0]||null;}
function config(d,v){return (d.maintenanceConfigs||[]).find(c=>c.vehicleId===v.id&&c.metric===metric(v))||null;}
function number(value,label,optional=false){if(optional&&(value===""||value==null))return null;if(!finite(value))throw Error(label+"请填写大于等于0的数字");return Number(value);}
function photo(files){if(!Array.isArray(files)||files.length>1)throw Error("请上传一张仪表照片");for(const f of files)if(!f?.id||!String(f.type).startsWith("image/")||!Number.isFinite(f.size)||f.size<=0||f.size>10*1024*1024)throw Error("请上传10MB以内的仪表照片");return files;}
function reading(d,v,value,files,required=false){const blank=value===""||value==null,images=photo(files||[]);if(blank){if(required||images.length)throw Error("请填写当前"+unit(v)+"读数");return null;}const val=number(value,"当前"+unit(v));if(required&&!images.length)throw Error("请拍摄或上传仪表照片");const previous=latest(d,v);if(previous&&val<previous.value)throw Error("当前读数不能小于上次记录的"+previous.value+" "+unit(v));return {metric:metric(v),value:val,attachments:images};}
function status(d,v,today){const c=config(d,v),r=latest(d,v),result={kind:"unset",label:"待设置",unit:unit(v),metric:metric(v),current:r?.value??null,config:c,reading:r,reasons:[]};if(!c)return result;
 const checks=[];let missing=false;const warn=(c.warningPercent??10)/100;
 if(c.intervalMeter!=null){if(r==null||c.lastServiceMeter==null){missing=true;}else checks.push({used:r.value-c.lastServiceMeter,limit:c.intervalMeter,remaining:c.intervalMeter-(r.value-c.lastServiceMeter),unit:unit(v)});}
 result.checks=checks;result.reasons=checks.map(x=>"剩余 "+x.remaining+" "+x.unit);
 if(checks.some(x=>x.used>=x.limit)){result.kind="overdue";result.label="到期/超保养";}else if(checks.some(x=>x.remaining<=x.limit*warn)){result.kind="near";result.label="接近保养";}else if(missing||!checks.length){result.kind="unset";result.label=missing?"待补保养资料":"待设置";}else{result.kind="normal";result.label="正常";}return result;}
window.MineServiceCare=Object.freeze({metric,unit,validDate,latest,config,number,photo,reading,status});
})();