'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../canvas-workspace.js');
const item=uid=>({uid,id:'send-message',params:{message:5}});
const group=(id,trigger,items=[item(id+'-1')])=>({id,startId:id+'-head',x:90,y:140,items,...(trigger===undefined?{}:{trigger})});
const document=(...groups)=>({...M.create(),groups});

test('message trigger, nested parameters, stable IDs and view survive a save/load round trip',()=>{
 const doc=document(group('a',{type:'message',message:6},[{uid:'loop',id:'loop-count',params:{count:3},children:[item('nested')]}]));
 doc.viewport={x:-120,y:60,scale:.75};
 const restored=M.normalize(JSON.parse(JSON.stringify(doc)));
 assert.deepEqual(restored,doc);assert.equal(M.validate(restored).ok,true);
 const changed=M.setTrigger(doc,'a',{type:'message',message:2});
 assert.equal(doc.groups[0].trigger.message,6);assert.equal(changed.groups[0].trigger.message,2);
 const normal=M.setTrigger(changed,'a',null);
 assert.equal(Object.hasOwn(normal.groups[0],'trigger'),false);assert.equal(M.validate(normal).ok,true);
});

test('whole-head detach/drop preserves message while an ordinary suffix carries no trigger',()=>{
 const doc=document(group('a',{type:'message',message:5},[item('first'),item('second')]));
 const whole=M.extract(doc,{groupId:'a',nodeId:'a-head'});
 assert.deepEqual(whole.payload.trigger,{type:'message',message:5});
 const moved=M.drop(whole.doc,whole.payload,{x:350,y:-40});
 assert.equal(moved.ok,true);assert.deepEqual(moved.doc.groups[0].trigger,doc.groups[0].trigger);
 const suffix=M.extract(doc,{groupId:'a',nodeId:'second'});
 assert.equal(Object.hasOwn(suffix.payload,'trigger'),false);
 assert.deepEqual(suffix.doc.groups[0].trigger,doc.groups[0].trigger);
 const loose=M.drop(suffix.doc,suffix.payload,{x:450,y:300});
 assert.equal(loose.ok,true);assert.equal(loose.doc.groups.filter(g=>g.trigger).length,1);
});

test('message head prepends to a headless group, but never creates two heads',()=>{
 const target={id:'loose',startId:null,x:300,y:140,items:[item('loose-1')]};
 const source=document(group('a',{type:'message',message:3}),target);
 const extracted=M.extract(source,{groupId:'a',nodeId:'a-head'});
 const joined=M.drop(extracted.doc,extracted.payload,{groupId:'loose',parentUid:null,index:0});
 assert.equal(joined.ok,true);assert.equal(joined.doc.groups[0].startId,'a-head');
 assert.deepEqual(joined.doc.groups[0].trigger,{type:'message',message:3});
 assert.deepEqual(joined.doc.groups[0].items.map(i=>i.uid),['a-1','loose-1']);
 const headed=document(group('b'));
 assert.equal(M.drop(headed,extracted.payload,{groupId:'b',parentUid:null,index:0}).ok,false);
});

test('malformed persisted trigger remains invalid rather than becoming an immediate head',()=>{
 for(const trigger of [{type:'message',message:0},{type:'message',message:7},{type:'message',message:'1'},{type:'unknown'},'message']){
  const doc=M.normalize(document(group('a',trigger)));
  assert.deepEqual(doc.groups[0].trigger,trigger);assert.equal(M.validate(doc).ok,false);
  assert.equal(M.setTrigger(doc,'a',{type:'message',message:9}),doc);
 }
 const headless=document({...group('a',{type:'message',message:1}),startId:null});
 assert.equal(M.validate(headless).ok,false);
 assert.equal(M.setTrigger(headless,'a',null),headless);
});
