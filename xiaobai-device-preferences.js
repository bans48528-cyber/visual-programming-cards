(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.XiaobaiDevicePreferences=api;
})(globalThis,function(){
  'use strict';
  const DEFAULT_KEY='xiaobaiDefaultDeviceV1';
  const NAMES_KEY='xiaobaiDeviceNamesV1';
  function cleanId(value){return typeof value==='string'?value.trim():'';}
  function cleanName(value){return typeof value==='string'?value.trim().slice(0,24):'';}
  function cleanRadioName(value){return typeof value==='string'?value.split('\0',1)[0].replace(/[\x00-\x1f\x7f-\x9f]/g,'').trim().slice(0,24):'';}
  function describeName(device,custom=''){
    const advertisedName=typeof device?.advertisedName==='string'?device.advertisedName:'';
    const cachedName=typeof device?.cachedName==='string'?device.cachedName:'';
    const radioName=cleanRadioName(device?.name)||cleanRadioName(advertisedName)||cleanRadioName(cachedName);
    const radioSource=['advertisement','system-cache','unnamed'].includes(device?.nameSource)?device.nameSource:radioName?'unknown':'unnamed';
    const radioLabel=radioSource==='advertisement'?(device?.nameObservation==='last-scan'?'最近扫描广播名':'广播名'):radioSource==='system-cache'?'系统缓存名':radioSource==='unnamed'?'未读取名称':'设备名称';
    const alias=cleanName(custom),name=alias||radioName||'小白设备',source=alias?'alias':radioSource;
    return{name,source,sourceLabel:alias?'本机备注':radioLabel,radioName,radioLabel,advertisedName,cachedName,
      description:alias?`本机备注 · ${radioLabel}：${radioName||'未知'}`:`${radioLabel}：${radioName||'未知'}`};
  }
  function create(storage,modelId='xiaobai'){
    const defaultKey='cardModel:'+modelId+':bluetooth:v1';
    if(modelId==='xiaobai'&&storage.getItem(defaultKey)===null&&storage.getItem(DEFAULT_KEY)) storage.setItem(defaultKey,storage.getItem(DEFAULT_KEY));
    function readNames(){
      try {const value=JSON.parse(storage.getItem(NAMES_KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
      catch{return {};}
    }
    return {
      getDefault(){try{return cleanId(storage.getItem(defaultKey));}catch{return '';}},
      setDefault(deviceId){const id=cleanId(deviceId);if(!id)throw new Error('设备标识不能为空。');storage.setItem(defaultKey,id);},
      displayName(device){return describeName(device,readNames()[cleanId(device?.deviceId)]).name;},
      describeName(device){return describeName(device,readNames()[cleanId(device?.deviceId)]);},
      customName(deviceId){return cleanName(readNames()[cleanId(deviceId)]);},
      rename(deviceId,name){
        const id=cleanId(deviceId),value=cleanName(name);if(!id)throw new Error('设备标识不能为空。');
        const names=readNames();if(value)names[id]=value;else delete names[id];storage.setItem(NAMES_KEY,JSON.stringify(names));return value;
      }
    };
  }
  return {create,describeName,cleanRadioName,DEFAULT_KEY,NAMES_KEY};
});
