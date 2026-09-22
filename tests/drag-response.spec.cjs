const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const BASE='http://127.0.0.1:4173/dist/#editor';
async function shortDrag(page,session,selector){
  const rect=await page.locator(selector).first().boundingBox();
  const x=rect.x+rect.width/2,y=rect.y+Math.min(22,rect.height/3);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+6}]});
  const active=await page.evaluate(()=>Boolean(document.querySelector('.ghost')));
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>!document.querySelector('.ghost'));
  return active;
}
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true});
    const page=await context.newPage();await page.goto(BASE);
    const session=await context.newCDPSession(page);
    assert.equal(await shortDrag(page,session,'#palette [data-card-id="motor-forward"]'),true,'palette block responds within 6 px');
    await page.locator('#palette [data-card-id="motor-forward"]').click();
    await page.waitForFunction(()=>document.querySelector('.chain .program-block[data-card-id="motor-forward"]'));
    assert.equal(await shortDrag(page,session,'.chain .program-block[data-card-id="motor-forward"]'),true,'program block responds within 6 px');
    await context.close();console.log('PASS touch drag starts within 6 px from palette and program.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
