const assert=require('node:assert/strict');
const M=require('../device-models.js');
const prefs=require('../xiaobai-device-preferences.js');
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),data};};
const state={program:[{id:'wait-time',params:{duration:1}}],stagedGroups:[]};
(async()=>{
 const s=memory();s.setItem('xiaobaiProjectsV1',JSON.stringify([{id:'old',name:'旧作品',state},{id:'blank',name:'空白',state:{program:[]}}]));
 s.setItem('xiaobaiActiveProjectV1','old');s.setItem('xiaobaiDefaultDeviceV1','BLE-A');s.setItem('xiaobaiDeviceNamesV1',JSON.stringify({'BLE-A':'客厅小白'}));
 M.migrate(s);const one=M.createStore(s,'xiaobai');assert.equal(one.read()[0].modelId,'xiaobai');assert.equal(one.read().length,1);assert.equal(one.getActive(),'old');
 assert.equal(s.getItem(M.MODEL_KEY),null);assert.ok(s.getItem('xiaobaiProjectsV1'));
 const a=prefs.create(s,'xiaobai'),b=prefs.create(s,'fixture');assert.equal(a.getDefault(),'BLE-A');assert.equal(b.getDefault(),'');b.setDefault('BLE-B');assert.equal(a.getDefault(),'BLE-A');assert.equal(b.displayName({deviceId:'BLE-A'}),'客厅小白');
 one.write([{id:'draft',modelId:'xiaobai',name:'未命名',needsName:true,draft:true,state}]);M.migrate(s);assert.equal(one.read()[0].needsName,true);assert.equal(one.read()[0].id,'draft');
 const two=M.createStore(s,'fixture');assert.deepEqual(two.read(),[]);assert.throws(()=>two.write(one.read()));
 const broken=memory();broken.setItem('xiaobaiProjectsV1','bad');assert.throws(()=>M.migrate(broken));assert.equal(broken.getItem('xiaobaiProjectsV1'),'bad');assert.equal(broken.getItem(M.key('xiaobai','projects')),null);
 for(const legacy of ['xiaobaiVisualProgramV1','xiaobaiVisualProgramLegacy']){const st=memory();st.setItem(legacy,JSON.stringify(state));M.migrate(st);assert.equal(M.createStore(st,'xiaobai').read().length,1);}
 const registry=M.createRegistry();for(const id of ['xiaobai','fixture'])registry.register({id,catalog:{},execution:{},bluetooth:{}});
 let finish,activated=[];const session=M.createSession(registry,s,{deactivate:()=>new Promise(r=>finish=r),activate:async m=>activated.push(m.id)});
 assert.equal(session.selected,false);await session.select('xiaobai');assert.equal(session.selected,true);assert.equal(M.createSession(registry,s).current.id,'xiaobai');
 const scope=session.capture();const pending=session.select('fixture');assert.equal(await session.select('xiaobai'),false);await Promise.resolve();assert.equal(scope.isCurrent(),false);assert.equal(scope.signal.aborted,true);finish();await pending;assert.equal(session.current.id,'fixture');assert.deepEqual(activated,['fixture']);
 let resolveCompile,sends=0,progress=[];const cap=session.capture();const job=M.createExecution({kind:'compiled',validate:p=>p,compile:()=>new Promise(r=>resolveCompile=r),sendProgram:async()=>{sends++;}}, {...cap,onProgress:t=>progress.push(t)});
 const running=job.run(state.program).catch(e=>e.message);const next=session.select('xiaobai');await Promise.resolve();finish();await next;const n=progress.length;resolveCompile('late-bytecode');await running;assert.equal(sends,0);assert.equal(progress.length,n);
 const upload=M.createExecution({kind:'upload',validate:p=>p,sendProgram:async(p,ctx)=>{assert.equal(p,state.program);sends++;},startProgram:async()=>sends++},{isCurrent:()=>true});await upload.run(state.program);assert.equal(sends,2);
 console.log('PASS model core: migration, drafts, program/BLE isolation, names, remembered selection, concurrent switching, late compiler cancellation and upload strategy.');
})().catch(e=>{console.error(e);process.exitCode=1;});
