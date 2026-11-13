'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const DeviceModels=require('../device-models.js'),Canvas=require('../canvas-workspace.js');
const context={DeviceModels,Receiver2226Protocol:{notice:'test-only'}};context.window=context;vm.createContext(context);
for(const name of ['xiaobai-model.js','spark-ai-model.js','lbs2206-model.js','tc01-model.js','receiver2226-model.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),context,{filename:name});
const model=context.CardModels.get('xiaobai'),cards=Object.fromEntries(Object.values(model.catalog).flatMap(c=>c.cards).map(c=>[c.id,c]));
const copy=value=>JSON.parse(JSON.stringify(value));
const newIds=['motion-wait','loop-infrared','loop-tilt','loop-time'];

test('motion states have independent stable values; tilt UI contains only the four directions',()=>{
  assert.deepEqual(copy(cards['motion-wait'].paramsSchema.state.options),[
    {value:'still',label:'平稳'},{value:'shaking',label:'持续晃动'},{value:'up',label:'向上抬一下'},{value:'down',label:'向下放一下'}]);
  assert.equal(cards['motion-wait'].paramsSchema.state.default,'still');
  assert.deepEqual(Array.from(cards['tilt-wait'].paramsSchema.direction.options,o=>o.value),['forward','backward','left','right']);
  assert.equal(cards['tilt-wait'].paramsSchema.direction.legacyValues,undefined);
  assert.equal(cards['motion-wait'].kind,undefined,'motion wait stays an ordinary action, not a loop');
});

test('three condition cards use the shared C shape and expose strict IR, four tilt and entry-time parameters',()=>{
  for(const id of newIds.slice(1))assert.equal(cards[id].kind,'loop');
  assert.equal(cards['loop-count'].kind,'loop');assert.equal(cards.loop.kind,'loop');
  const ir=cards['loop-infrared'].paramsSchema;
  assert.deepEqual(Array.from(ir.comparison.options,o=>o.value),['greater','less']);
  assert.deepEqual(copy(ir.threshold),{label:'数值',type:'number',default:50,min:0,max:100,step:1,integer:true});
  assert.deepEqual(copy(cards['loop-tilt'].paramsSchema.direction),copy(cards['tilt-wait'].paramsSchema.direction));
  const time=cards['loop-time'].paramsSchema.duration;
  assert.equal(time.default,5);assert.equal(time.min,0);assert.equal(time.max,86400);assert.equal(time.step,.1);
  for(const id of newIds.slice(1)){
    assert.match(cards[id].label,/^重复直到/);assert.equal(cards[id].conditionalLoop,true);
    assert.match(cards[id].paramHelp,/整轮/);assert.match(cards[id].paramHelp,/当前等待或无限内循环不结束则继续等待/);assert.match(cards[id].paramHelp,/停止立即生效/);
  }
  assert.match(cards['loop-infrared'].paramHelp,/严格/);assert.match(cards['loop-infrared'].paramHelp,/等于阈值不满足/);
  assert.match(cards['loop-time'].paramHelp,/进入本循环开始计时/);
});

test('all new cards reuse shipped model artwork and stay isolated from other device catalogs',()=>{
  const expected={'motion-wait':'xiaobai-accelerometer-20261111/motion-wait-still','loop-infrared':'xiaobai-20261016/infrared-wait','loop-tilt':'xiaobai-20261016/tilt-wait','loop-time':'xiaobai-20261016/wait-time'};
  for(const [id,asset] of Object.entries(expected)){
    assert.equal(model.artworkByCard[id].artIcon,asset);
    assert.ok(fs.existsSync(path.join(__dirname,'../assets/blocks',model.artworkByCard[id].artIcon+'.svg')));
  }
  for(const other of context.CardModels.list().filter(m=>m.id!=='xiaobai'))
    assert.equal(Object.values(other.catalog).flatMap(c=>c.cards).some(c=>newIds.includes(c.id)),false,other.id);
});

test('nested new loops, all motion values, positions and stable identities round trip without changing other device libraries',()=>{
  const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v))};
  const unrelated=[{id:'other',name:'Other device',modelId:'spark-ai',state:{program:[{id:'wait-time',params:{duration:7}}]}}];
  DeviceModels.createStore(storage,'spark-ai').write(unrelated);const original=storage.getItem(DeviceModels.key('spark-ai','projects'));
  const item=(id,uid,params,children)=>({id,uid,params,...(children?{children}:{})});
  const nodes=['still','shaking','up','down'].map((state,i)=>item('motion-wait','motion-'+i,{state}));
  const nested=item('loop-infrared','ir',{comparison:'less',threshold:0},[
    item('loop-tilt','tilt',{direction:'right'},[item('loop-time','time',{duration:5.5},nodes)])]);
  const doc=Canvas.normalize({...Canvas.create(),groups:[{id:'group',startId:'head',x:-112.5,y:345.25,items:[nested]}],viewport:{x:84,y:-200,scale:.65},selectedGroupId:'group'});
  const store=DeviceModels.createStore(storage,'xiaobai'),project={id:'new-loops',name:'条件循环',modelId:'xiaobai',state:doc};
  store.write([project]);assert.deepEqual(store.read(),[project]);assert.deepEqual(Canvas.normalize(store.read()[0].state),doc);
  assert.equal(storage.getItem(DeviceModels.key('spark-ai','projects')),original);
});
