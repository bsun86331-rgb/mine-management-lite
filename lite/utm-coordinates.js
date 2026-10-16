/* WGS84 / UTM adapter. Projection: vendored Proj4js 2.22.0 (MIT). */
(() => {
  "use strict";
  const fail=m=>{throw new Error(m);};
  const number=(v,label,min,max)=>{if(v===""||v==null)return null;const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)fail(label+"超出有效范围");return n;};
  function zoneFor(lat,lng){let zone=Math.min(60,Math.max(1,Math.floor((lng+180)/6)+1));
    if(lat>=56&&lat<64&&lng>=3&&lng<12)zone=32;
    if(lat>=72&&lat<84&&lng>=0&&lng<42)zone=lng<9?31:lng<21?33:lng<33?35:37;
    return zone;
  }
  function projection(zone,hemisphere){if(typeof window.proj4!=="function")fail("UTM转换组件未加载，请刷新页面");return "+proj=utm +zone="+zone+(hemisphere==="S"?" +south":"")+" +datum=WGS84 +units=m +no_defs";}
  function fromWGS84(lat,lng){
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat< -80||lat>84||lng< -180||lng>180)fail("位置超出UTM适用范围（南纬80°至北纬84°）");
    const zone=zoneFor(lat,lng),hemisphere=lat<0?"S":"N",xy=window.proj4("EPSG:4326",projection(zone,hemisphere),[lng,lat]);
    if(!xy.every(Number.isFinite))fail("当前位置无法转换为UTM");
    return {zone,hemisphere,easting:xy[0],northing:xy[1],datum:"WGS84"};
  }
  function toWGS84(values){
    const zone=number(values.zone,"UTM分区",1,60),easting=number(values.easting,"横坐标X",0,1000000),northing=number(values.northing,"纵坐标Y",0,10000000),hemisphere=String(values.hemisphere||"");
    if(zone!=null&&!Number.isInteger(zone))fail("UTM分区应为1至60的整数");
    if(hemisphere&&!["N","S"].includes(hemisphere))fail("UTM半球请选择北半球或南半球");
    const utm={zone,hemisphere,easting,northing,datum:"WGS84"};
    if(zone==null||easting==null||northing==null||!hemisphere)return {utm,lat:null,lng:null};
    const ll=window.proj4(projection(zone,hemisphere),"EPSG:4326",[easting,northing]),lng=ll[0],lat=ll[1];
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat< -80.0000001||lat>84.0000001||lng< -180||lng>180||(hemisphere==="N"&&lat< -0.0000001)||(hemisphere==="S"&&lat>0.0000001))fail("UTM坐标与分区/半球不匹配，请核对");
    return {utm,lat,lng};
  }
  function zoneCoordinates(zone){if(zone.utm)return {...zone.utm};try{return fromWGS84(zone.lat,zone.lng);}catch{return {zone:null,hemisphere:"",easting:null,northing:null};}}
  window.MineUTM=Object.freeze({fromWGS84,toWGS84,zoneCoordinates});
})();
