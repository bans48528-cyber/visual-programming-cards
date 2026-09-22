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
  function create(storage){
    function readNames(){
      try {const value=JSON.parse(storage.getItem(NAMES_KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
      catch{return {};}
    }
    return {
      getDefault(){try{return cleanId(storage.getItem(DEFAULT_KEY));}catch{return '';}},
      setDefault(deviceId){const id=cleanId(deviceId);if(!id)throw new Error('设备标识不能为空。');storage.setItem(DEFAULT_KEY,id);},
      displayName(device){const id=cleanId(device?.deviceId),custom=cleanName(readNames()[id]);return custom||cleanName(device?.name)||'小白设备';},
      customName(deviceId){return cleanName(readNames()[cleanId(deviceId)]);},
      rename(deviceId,name){
        const id=cleanId(deviceId),value=cleanName(name);if(!id)throw new Error('设备标识不能为空。');
        const names=readNames();if(value)names[id]=value;else delete names[id];storage.setItem(NAMES_KEY,JSON.stringify(names));return value;
      }
    };
  }
  return {create,DEFAULT_KEY,NAMES_KEY};
});
