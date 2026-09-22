const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    for(const width of [1280,844,390,320]) {
      const page=await browser.newPage({viewport:{width,height:800}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(()=>{
        const device=new EventTarget();device.id='mock-controller';device.name='Spark_AI';
        const characteristic=new EventTarget();
        characteristic.properties={notify:true,writeWithoutResponse:true};
        characteristic.startNotifications=async()=>characteristic;
        window.reportDeviceState=state=>{
          const bytes=new TextEncoder().encode(JSON.stringify({WillAiState:state})+'\r\n');
          characteristic.value=new DataView(bytes.buffer);
          characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
        };
        characteristic.writeValueWithoutResponse=async bytes=>{window.lastBluetoothWrite=Array.from(bytes);};
        const service={getCharacteristic:async()=>characteristic};
        window.bluetoothTestMode='ok';
        device.gatt={connected:false,getPrimaryService:async()=>service,async connect(){if(window.bluetoothTestMode==='fail')throw new DOMException('offline','NetworkError');this.connected=true;return this;},disconnect(){this.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));}};
        window.bluetoothTestDevice=device;
        Object.defineProperty(navigator,'bluetooth',{configurable:true,value:{
          async getDevices(){return[];},
          async requestDevice(options){window.bluetoothRequest=options;if(window.bluetoothTestMode==='cancel')throw new DOMException('cancelled','NotFoundError');return device;}
        }});
      });
      await page.goto('http://127.0.0.1:4173/#editor');
      const iconColor=()=>page.locator('#bluetoothBtn').evaluate(e=>getComputedStyle(e).color);
      assert.equal(await iconColor(),'rgb(122, 131, 141)');
      assert.equal(await page.locator('#deviceStatus').textContent(),'设备未连接');
      assert.equal(await page.locator('#bluetoothBtn').getAttribute('aria-label'),'蓝牙未连接');
      assert.equal((await page.request.get('http://127.0.0.1:4173/assets/toolbar/bluetooth.svg')).ok(),true);
      assert.deepEqual(await page.evaluate(()=>({
        motors:['motor-forward','motor-reverse','motor-stop'].map(id=>createProgramItem(id).params.port),
        portLabels:cardById['motor-forward'].paramsSchema.port.options.map(value=>getParamOptionDisplay(cardById['motor-forward'].paramsSchema.port,value)),
        categories:Object.fromEntries(Object.entries(categories).map(([key,group])=>[key,group.cards.length]))
      })),{motors:['L/M1','L/M1','L/M1'],portLabels:['L','R'],categories:{motor:6,combo:7,logic:4,dynamic:5}});
      await page.evaluate(()=>addCard('motor-forward'));
      await page.locator('#bluetoothBtn').click();
      await page.locator('.bt-search').click();
      assert.equal(await page.locator('.bt-device small').textContent(),'已连接');
      assert.equal(await page.evaluate(()=>window.bluetoothRequest.filters[0].name),'Spark_AI');
      assert.equal(await page.evaluate(()=>window.lastBluetoothWrite[4]),0xd0);
      await page.locator('.bt-back').click();
      assert.equal(await page.locator('#deviceStatus').textContent(),'等待状态上报');
      await page.evaluate(()=>window.reportDeviceState('run'));
      assert.equal(await page.locator('#deviceStatus').textContent(),'设备运行中');
      await page.screenshot({path:path.join(os.tmpdir(),`cards-device-status-${width}.png`)});
      const bounds=await page.locator('.topbar > *').evaluateAll(elements=>elements.map(e=>{
        const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};
      }));
      for(const r of bounds) assert.ok(r.x>=0 && r.right<=width+1);
      const header=await page.locator('.topbar').boundingBox();
      for(const r of bounds) assert.ok(r.bottom<=header.y+header.height,'topbar content clipped');
      for(let i=0;i<bounds.length;i++) for(let j=i+1;j<bounds.length;j++) {
        const a=bounds[i],b=bounds[j];
        assert.ok(a.right<=b.x || b.right<=a.x || a.bottom<=b.y || b.bottom<=a.y,'topbar overlaps');
      }
      await page.waitForFunction(()=>document.getElementById('deviceStatus').dataset.state==='stale');
      await page.evaluate(()=>window.reportDeviceState('stop'));
      assert.equal(await page.locator('#deviceStatus').textContent(),'设备已停止');
      await page.evaluate(()=>window.reportDeviceState('unknown'));
      assert.equal(await page.locator('#deviceStatus').textContent(),'等待状态上报');
      assert.equal(await page.locator('#chain > .program-block').count(),1);
      assert.equal(await page.locator('#bluetoothBtn').evaluate(e=>e.classList.contains('is-connected')),true);
      assert.equal(await iconColor(),'rgb(19, 128, 86)');
      await page.locator('#bluetoothBtn').click();
      await page.getByRole('button',{name:'断开',exact:true}).click();
      assert.equal(await page.locator('.bt-device small').textContent(),'未连接');
      assert.equal(await page.locator('#deviceStatus').textContent(),'设备未连接');
      assert.equal(await iconColor(),'rgb(122, 131, 141)');
      await page.evaluate(()=>{
        const original=window.bluetoothTestDevice.gatt.connect;
        window.bluetoothTestDevice.gatt.connect=async function(){
          await new Promise(resolve=>window.finishTestConnection=resolve);
          this.connect=original;
          return original.call(this);
        };
      });
      await page.getByRole('button',{name:'连接',exact:true}).click();
      assert.equal(await iconColor(),'rgb(0, 144, 245)');
      assert.equal(await page.locator('#bluetoothBtn').getAttribute('aria-label'),'蓝牙正在连接');
      await page.evaluate(()=>window.finishTestConnection());
      await page.getByRole('button',{name:'断开',exact:true}).click();
      await page.evaluate(()=>window.bluetoothTestMode='fail');
      await page.getByRole('button',{name:'连接',exact:true}).click();
      assert.match(await page.locator('.bt-message').textContent(),/连接失败/);
      await page.evaluate(()=>window.bluetoothTestMode='cancel');
      await page.locator('.bt-search').click();
      assert.match(await page.locator('.bt-message').textContent(),/未选择/);
      await page.evaluate(()=>window.bluetoothTestMode='ok');
      await page.getByRole('button',{name:'连接',exact:true}).click();
      await page.evaluate(()=>window.bluetoothTestDevice.gatt.disconnect());
      assert.match(await page.locator('.bt-message').textContent(),/已断开/);
      await page.screenshot({path:path.join(os.tmpdir(),`cards-bluetooth-${width}.png`)});
      const rect=await page.locator('.bt-content').boundingBox();assert.ok(rect.x+rect.width<=width+1);
      assert.deepEqual(errors,[]);
      console.log(`PASS ${width}: navigation, mocked connection/disconnection, cancellation, failure, disconnect event`);
      await page.close();
    }
    const page=await browser.newPage();
    await page.addInitScript(()=>Object.defineProperty(navigator,'bluetooth',{value:undefined}));
    await page.goto('http://127.0.0.1:4173/#bluetooth');
    assert.equal(await page.locator('.bt-search').isDisabled(),true);
    assert.match(await page.locator('.bt-message').textContent(),/不支持/);
    await page.locator('.bt-back').click();
    await page.locator('#startBlock').waitFor({state:'visible'});
    assert.equal(await page.locator('#startBlock').isVisible(),true);
    console.log('PASS unsupported browser and direct route');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
