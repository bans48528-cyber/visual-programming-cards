const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {fork}=require('node:child_process');
const path=require('node:path');
const generate=require('../program-codegen.cjs');
function compile(program) {
  return new Promise((resolve,reject)=>{
    const child=fork(path.join(__dirname,'../compiler-worker.cjs'),[],{silent:true});
    const timer=setTimeout(()=>{child.kill();reject(Error('compiler timeout'));},15000);
    child.on('message',r=>{clearTimeout(timer);r.error?reject(Error(r.error)):resolve(r);});
    child.on('error',reject);
    child.on('exit',()=>{clearTimeout(timer);reject(Error('compiler exited'));});
    child.send(program);
  });
}
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage();await page.goto('http://127.0.0.1:4173/#editor');
    const cards=await page.evaluate(()=>Object.values(categories).flatMap(c=>c.cards.map(c=>createProgramItem(c.id))));
    const byId=Object.fromEntries(cards.map(c=>[c.id,c]));
    for(const card of cards) {
      const result=await compile([card]);
      assert.equal(Buffer.from(result.bytecode,'base64').subarray(0,4).toString('hex'),'0f70796f');
      console.log('PASS native compile '+card.id);
    }
    const moves=['combo-forward','combo-backward','combo-turn-left','combo-turn-right','combo-stop'].map(id=>byId[id]);
    for(const mode of ['3','0','1','2']) {
      const setting={...byId['combo-direction'],params:{mode}};
      const ordered=[byId['combo-forward'],setting,byId['combo-continuous'],byId['combo-stop']];
      assert.ok(generate(ordered).includes(`_motor.mov_dir_power_seconds("advance", combo_power, 1)\n_motor.pair(4, 5, ${mode})\n_motor.mov_dir_power`));
      await compile(ordered);
    }
    assert.throws(()=>generate([{...byId['combo-direction'],params:{mode:'4'}}]),/旋转方向/);
    const movement=generate(moves);
    assert.equal(movement.match(/_motor.pair\(4, 5, 1\)/g).length,1);
    for(const direction of ['advance','retreat','left','right']) assert.ok(movement.includes(`("${direction}", combo_power, 1)`));
    assert.ok(movement.endsWith('_motor.mov_stop()\n'));
    for(const direction of ['advance','retreat','left','right']) {
      assert.ok(generate([{...byId['combo-continuous'],params:{direction}}]).includes(`_motor.mov_dir_power("${direction}", combo_power)`));
    }
    const continuing=generate([byId['motor-forward-continuous'],byId['ultrasonic-sensor'],byId['motor-stop'],byId['motor-reverse-continuous'],byId['motor-stop'],byId['combo-continuous'],byId['wait-time'],byId['combo-stop']]);
    assert.ok(continuing.includes('_motor.run_power(4, motor_power)\nwhile not (_ultrasion.cmp_value'));
    assert.ok(continuing.includes('_motor.run_power(4, -motor_power)\n_motor.stop(4)'));
    assert.ok(continuing.endsWith('_motor.mov_dir_power("advance", combo_power)\n_os.sleep_s(1)\n_motor.mov_stop()\n'));
    assert.throws(()=>generate([{...byId['combo-continuous'],params:{direction:'invalid'}}]),/方向/);
    for(const [index,port] of ['A','B','C','D'].entries()) {
      assert.equal(generate([{...byId['ultrasonic-sensor'],params:{port,operator:'==',distance:10}}]),`while not (_ultrasion.cmp_value(${index}, "==", 10)):\n    _os.sleep_s(0.001)\n`);
      assert.match(generate([{...byId['grayscale-sensor'],params:{port,operator:'>',value:500}}]),/_color.cmp_lux/);
      assert.match(generate([{...byId['button-sensor'],params:{port,state:'松开'}}]),/while not \(not _touch.state/);
    }
    assert.match(generate([{...byId['host-button'],params:{button:'右键'}}]),/_key.key_mast\("right", 1\)/);
    const asymmetric=Array(25).fill(0);asymmetric[0]=1;asymmetric[9]=1;
    assert.equal(generate([{...byId['matrix-display'],params:{pattern:asymmetric}}]),'_matrix.show(0x00, 0x01, 0x10, 0x00, 0x00, 0x00, 0x00)\n');
    for(const [i,note] of ['c','d','e','f','g','a','b'].entries()) {
      const item={...byId['play-note'],params:{note:String(i+1),beats:'0.5'}};
      assert.equal(generate([item]),`_beep.play_muic("${note}", 0.5)\n`);
      await compile([item]);
    }
    const nested=[{...byId['loop-count'],children:[{...byId['loop-count'],children:cards.filter(c=>!['loop','loop-count'].includes(c.id))}]},byId['combo-stop']];
    const result=await compile(nested);assert.ok(result.source.endsWith('_motor.mov_stop()\n'));
    assert.throws(()=>generate([{...byId['loop-count'],children:[{id:'unknown'}]}]),/积木 1.1/);
    assert.throws(()=>generate([{...byId['matrix-display'],params:{pattern:[1]}}]),/25/);
    assert.throws(()=>generate([{...byId['ultrasonic-sensor'],params:{port:'A',operator:'bad',distance:10}}]),/比较符号/);
    assert.throws(()=>generate([{...byId['play-note'],params:{note:'bad'}}]),/音符/);
    console.log('PASS all mappings, ports, directions, padded matrix, notes, nested mixed native compile, rejection paths');
    await page.close();
    for(const [width,height] of [[1280,800],[390,844],[844,390]]) {
      const p=await browser.newPage({viewport:{width,height}});
      await p.goto('http://127.0.0.1:4173/#editor');await p.evaluate(()=>addCard('play-note'));
      await p.getByRole('button',{name:'编辑演奏音参数'}).click();
      await p.getByRole('button',{name:'7',exact:true}).click();
      assert.equal(await p.evaluate(()=>program[0].params.note),'7');
      await p.getByRole('button',{name:'0.5拍',exact:true}).click();
      assert.equal(await p.evaluate(()=>program[0].params.beats),'0.5');
      const box=await p.locator('#paramEditor').boundingBox();
      assert.ok(box.x>=0 && box.y>=0 && box.x+box.width<=width+1 && box.y+box.height<=height+1);
      await p.screenshot({path:`C:/Users/64264/AppData/Local/Temp/all-cards-note-${width}.png`});
      await p.evaluate(()=>{closeParamEditor();addCard('combo-continuous');});
      await p.getByRole('button',{name:'编辑组合持续移动参数',exact:true}).click();
      await p.getByRole('button',{name:'右转',exact:true}).click();
      assert.equal(await p.evaluate(()=>program[1].params.direction),'right');
      assert.equal(await p.getByRole('button',{name:'右转',exact:true}).getAttribute('aria-pressed'),'true');
      await p.screenshot({path:`C:/Users/64264/AppData/Local/Temp/continuous-${width}.png`});
      await p.evaluate(()=>{closeParamEditor();program=[];renderProgram();addCard('combo-direction');});
      await p.getByRole('button',{name:'编辑组合电机方向参数',exact:true}).click();
      for(const [label,mode] of [['全部正向','3'],['左电机反向','0'],['右电机反向','1'],['全部反向','2']]) {
        await p.getByRole('button',{name:label,exact:true}).click();
        assert.equal(await p.evaluate(()=>program[0].params.mode),mode);
      }
      const directionBox=await p.locator('#paramEditor').boundingBox();
      assert.ok(directionBox.x>=0 && directionBox.x+directionBox.width<=width+1);
      const savedDirection=await p.evaluate(()=>getProgramSnapshot());
      await p.evaluate(()=>{closeParamEditor();document.getElementById('saveBtn').click();program=[];renderProgram();loadProgram();});
      assert.equal(await p.evaluate(()=>getProgramSnapshot()),savedDirection);
      await p.getByRole('button',{name:'编辑组合电机方向参数',exact:true}).click();
      await p.screenshot({path:`C:/Users/64264/AppData/Local/Temp/combo-direction-${width}.png`});
      await p.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
