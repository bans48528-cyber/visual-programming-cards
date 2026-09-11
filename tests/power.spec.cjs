const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const b=await chromium.launch({channel:'msedge',headless:true});
  try {for(const [width,height] of [[1280,800],[390,844],[844,390]]) for (const kind of ['motor','combo']) {
    const p=await b.newPage({viewport:{width,height}});
    await p.goto('http://127.0.0.1:4173/');
    await p.locator('#newProject').click();
    await p.locator('.home-dialog input').fill('功率测试');
    await p.locator('.home-dialog [type=submit]').click();
    await p.evaluate(kind=>addCard(`${kind}-power`),kind);
    await p.getByRole('button',{name:kind==='motor'?'编辑电机功率参数':'编辑组合电机功率参数',exact:true}).click();
    await p.getByRole('button',{name:'75%',exact:true}).click();
    assert.equal(await p.getByRole('button',{name:'H',exact:true}).count(),0);
    assert.deepEqual(await p.evaluate(()=>program[0].params),{power:'75'});
    const box=await p.locator('#paramEditor').boundingBox();
    assert.ok(box.x>=0 && box.x+box.width<=width+1 && box.y>=0 && box.y+box.height<=height+1);
    await p.screenshot({path:`C:/Users/64264/AppData/Local/Temp/${kind}-power-${width}.png`});
    await p.evaluate(()=>closeParamEditor());
    await p.locator('#saveBtn').click();await p.reload();
    assert.deepEqual(await p.evaluate(()=>program[0].params),{power:'75'});
    console.log('PASS power controls, bounds and persistence '+width);await p.close();
  }} finally {await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
