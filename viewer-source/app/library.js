let pending;
export function loadLibrary() {
  return pending ||= (async()=>{
    const records=await Promise.all(['/library/manifest.json','/custom-library/manifest.json'].map(async url=>{
      const response=await fetch(url);if(!response.ok)throw new Error('无法读取本地零件清单：'+url);
      const text=await response.text();return {manifest:JSON.parse(text),bytes:new TextEncoder().encode(text).byteLength};
    }));
    const [standard,custom]=records;
    for(const id of Object.keys(custom.manifest.parts))if(standard.manifest.parts[id])throw new Error('零件编号重复：'+id);
    return {...standard.manifest,parts:{...standard.manifest.parts,...custom.manifest.parts},
      total_bytes:standard.manifest.asset_bytes+standard.bytes+custom.manifest.asset_bytes+custom.bytes,
      custom:custom.manifest};
  })();
}
