function database(){return new Promise((resolve,reject)=>{const req=indexedDB.open('lego-local-models',1);req.onupgradeneeded=()=>req.result.createObjectStore('models',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function transaction(mode,action){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('models',mode), request=action(tx.objectStore('models'));tx.oncomplete=()=>{db.close();resolve(request.result);};tx.onerror=()=>{db.close();reject(tx.error);};tx.onabort=()=>{db.close();reject(tx.error||new Error('本地保存失败'));};});}
export const saveModel=model=>transaction('readwrite',store=>store.put(model));
export const getModel=id=>transaction('readonly',store=>store.get(id));
export const allModels=()=>transaction('readonly',store=>store.getAll());
export const removeModel=id=>transaction('readwrite',store=>store.delete(id));
