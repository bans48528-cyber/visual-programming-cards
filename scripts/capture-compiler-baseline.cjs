// Capture desktop reference outputs without sending anything to hardware.
// Usage: node scripts/capture-compiler-baseline.cjs [output-directory]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {fork} = require('node:child_process');
const {createHash} = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'artifacts/compiler-baseline'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const end = app.indexOf('    const flatCards =');
assert.ok(end > 0, 'Cannot locate the declarative card catalog');
// Evaluate only the trusted repository's data declarations, never user code.
const catalog = vm.runInNewContext(app.slice(0, end) + '\nObject.values(categories).flatMap(c => c.cards)', {}, {timeout:1000});
const make = (id, params={}, children=[]) => {
  const card = catalog.find(c=>c.id===id);
  assert.ok(card, id);
  const item = {id};
  if (card.paramsSchema) item.params = Object.fromEntries(Object.entries(card.paramsSchema).map(([k,d])=>[k,JSON.parse(JSON.stringify(d.default))]));
  if (item.params) Object.assign(item.params,params);
  if (card.kind==='loop') item.children=children;
  return item;
};
function compile(program) {
  return new Promise((resolve,reject)=>{
    const child=fork(path.join(root,'compiler-worker.cjs'),[],{silent:true,windowsHide:true});
    let settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('Desktop compile timed out'));},15000);
    // The installed compiler prints source to stdout. Drain without logging it.
    child.stdout.resume();child.stderr.resume();
    child.on('message',r=>finish(r.error?new Error(r.error):null,r));
    child.on('error',e=>finish(e));
    child.on('exit',()=>finish(new Error('Desktop compiler exited before returning a result')));
    child.send(program);
  });
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const cases=catalog.map(c=>({name:c.id,program:[make(c.id)]}));
  cases.push(
    {name:'nested-loops',program:[make('loop-count',{count:4},[make('loop-count',{count:2},[make('motor-forward',{duration:2.5}),make('wait-time',{duration:0.1})]),make('motor-stop')])]},
    {name:'fractional-duration',program:[make('motor-forward',{duration:0.1}),make('wait-time',{duration:2.5}),make('motor-reverse',{duration:86400})]},
    {name:'sensor-boundaries',program:[make('ultrasonic-sensor',{distance:100,operator:'>'}),make('grayscale-sensor',{value:0,operator:'=='}),make('motor-stop')]},
    {name:'matrix-asymmetric',program:[make('matrix-display',{pattern:Array.from({length:25},(_,i)=>i===0||i===9?1:0)})]},
    {name:'combo-power-order',program:[make('combo-power',{power:'75'}),make('combo-direction',{mode:'2'}),make('combo-forward',{duration:3.5}),make('combo-stop')]},
    {name:'large-program',program:Array.from({length:128},()=>make('wait-time',{duration:0.1}))}
  );
  const entries=[];
  for(const sample of cases) {
    const first=await compile(sample.program),second=await compile(sample.program);
    const bytes=Buffer.from(first.bytecode,'base64');
    assert.equal(bytes.subarray(0,4).toString('hex'),'0f70796f');
    assert.equal(first.bytecode,second.bytecode,'Non-deterministic output: '+sample.name);
    fs.writeFileSync(path.join(out,sample.name+'.json'),JSON.stringify(sample.program,null,2));
    fs.writeFileSync(path.join(out,sample.name+'.py'),first.source);
    fs.writeFileSync(path.join(out,sample.name+'.py.o'),bytes);
    entries.push({name:sample.name,bytes:bytes.length,sha256:sha(bytes),sourceSha256:sha(first.source),repeatEqual:true});
  }
  const addon=process.env.PIKA_ADDON_PATH||'E:/Spark AI 1.1.9/Spark-AI/resources/app.asar.unpacked/node_modules/pika-bytecode-gen-napi/build/Release/pika_bytecode_gen.node';
  const report={date:new Date().toISOString(),generatorSha256:sha(fs.readFileSync(path.join(root,'program-codegen.cjs'))),desktopAddonSha256:sha(fs.readFileSync(addon)),cardCount:catalog.length,cases:entries,scope:'Desktop reference only; no rebuilt core, Android compiler or physical peripheral verified.'};
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`PASS ${entries.length} desktop fixtures (${catalog.length} cards), each compiled twice with identical bytes.\n${out}`);
})().catch(e=>{console.error(e);process.exitCode=1;});
