const assert=require('node:assert/strict');const P=require('../tc01-protocol.js'),R=require('../tc01-runner.js');
const text=bytes=>Buffer.from(bytes).toString('ascii');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Synthetic BLE fixture only. These values are NOT TC-01 hardware configuration.
const profile={transport:'ble',serviceUuid:'11111111-1111-1111-1111-111111111111',writeUuid:'22222222-2222-2222-2222-222222222222',notifyUuid:null,writeMode:'response',lineEnding:''};
const block=(id,params={},children)=>({id,params,...(children?{children}:{})});
(async()=>{
 for(const [l,r,expected]of [[0,0,'0000'],[1,0,'1000'],[-1,0,'0100'],[0,1,'0010'],[0,-1,'0001'],[1,-1,'1001'],[-1,1,'0110']])assert.equal(text(P.encode(l,r,'')),'KEY_DATA='+expected);
 assert.equal(text(P.encode(0,0,'\r\n')),'KEY_DATA=0000\r\n');assert.throws(()=>P.encode(2,0,''));assert.throws(()=>P.encode(1,0,null));assert.throws(()=>P.connectionOptions({}),/待确认/);
 const writes=[];const transport={properties:{write:true},start:async()=>{},write:async b=>writes.push(text(b)),close(){},disconnect:async()=>{}};
 const link=new P.Link(transport,{profile});await link.start();assert.deepEqual(writes,['KEY_DATA=0000']);
 await Promise.all([link.setMotors(1,0),link.setMotors(-1,0),link.stopProgram()]);assert.deepEqual(writes,['KEY_DATA=0000','KEY_DATA=0000']);
 await link.setMotors(1,0,()=>false);assert.equal(writes.length,2);link.close();await link.setMotors(1,1);assert.equal(writes.length,2);
 const fixture=()=>{const states=[];let current=true;const runner=new R.Runner({setMotors:async(l,r,guard=()=>true)=>{if(guard())states.push([l,r]);}},{isCurrent:()=>current});return {states,runner,expire:()=>current=false};};
 const f=fixture();await f.runner.run([block('motor-forward-continuous',{port:'R/M2'}),block('motor-reverse',{port:'L/M1',duration:.1}),block('motor-stop',{port:'R/M2'})]);assert.deepEqual(f.states,[[0,0],[0,1],[-1,1],[0,1],[0,0],[0,0]]);
 for(const [id,direction,state] of [['combo-forward','advance',[1,1]],['combo-backward','retreat',[-1,-1]],['combo-turn-left','left',[-1,1]],['combo-turn-right','right',[1,-1]]]){
   const timed=fixture();await timed.runner.run([block(id,{duration:.1})]);assert.deepEqual(timed.states,[[0,0],state,[0,0],[0,0]]);
   const continuous=fixture();await continuous.runner.run([block('combo-continuous',{direction}),block('combo-stop')]);assert.deepEqual(continuous.states,[[0,0],state,[0,0],[0,0]]);
 }
 assert.throws(()=>R.validate([block('combo-continuous',{direction:'invalid'})]));
 assert.throws(()=>R.validate([block('combo-forward',{duration:0})]));
 const comboCancel=fixture();const comboPending=comboCancel.runner.run([block('combo-forward',{duration:10})]);await sleep(20);await comboCancel.runner.stop();await comboPending;assert.deepEqual(comboCancel.states,[[0,0],[1,1],[0,0]]);
 const loops=fixture();await loops.runner.run([block('loop-count',{count:2},[block('motor-forward-continuous',{port:'L/M1'}),block('combo-stop')])]);assert.equal(loops.states.filter(s=>s[0]===1).length,2);
 const cancelled=fixture();const pending=cancelled.runner.run([block('loop',{},[block('motor-forward-continuous',{port:'L/M1'}),block('wait-time',{duration:10})])]);await sleep(20);await cancelled.runner.stop();await pending;assert.deepEqual(cancelled.states.at(-1),[0,0]);assert.equal(cancelled.states.filter(s=>s[0]===1).length,1);
 const stale=fixture();stale.expire();await assert.rejects(stale.runner.run([block('combo-stop')]),/连接/);assert.deepEqual(stale.states,[]);
 for(const program of [[],[block('combo-power',{power:3})],[block('motor-forward',{port:'E',duration:1})],[block('motor-forward',{port:'L/M1',duration:-1})],[block('loop-count',{count:2},[])]])assert.throws(()=>R.validate(program));
 console.log('PASS TC-01: four-bit strings, missing-config gate, serial/latest-state writes, motor-state preservation, timed stop, loops/cancel, stale connection and unsupported blocks.');
})().catch(e=>{console.error(e);process.exitCode=1;});
