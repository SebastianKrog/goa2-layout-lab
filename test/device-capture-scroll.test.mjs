import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,firefox} from 'playwright';
import {PNG} from 'pngjs';
import {deviceImageBundle} from '../src/device-screenshot.mjs';
for(const [name,type] of [['Chromium',chromium],['Firefox',firefox]]) test(name+' report capture retains region size, font size and a scrolled display-contents workflow',async()=>{
 const browser=await type.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:220,height:400}});
  await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;width:220px;height:400px}main{display:flex;flex-direction:column;height:400px}header{height:40px;flex:none;background:red}section{height:313px;flex:none;overflow:auto;background:white}fieldset{display:contents;border:0;padding:0;margin:0}article{height:600px;background:linear-gradient(blue 0 100px,lime 100px 600px);font:13.8px sans-serif}footer{height:47px;flex:none;background:yellow}</style><main data-mobile-boxes><header data-mobile-region="header"></header><section data-mobile-region="action-info"><fieldset><article>Original text</article></fieldset></section><footer data-mobile-region="menu"></footer></main>`);
  await page.locator('section').evaluate(el=>el.scrollTop=120);
  await page.addScriptTag({content:await deviceImageBundle()});
  const data=await page.evaluate(()=>window.htmlToImage.toPng(document.body,{width:220,height:400,pixelRatio:1}));
  const png=PNG.sync.read(Buffer.from(data.split(',')[1],'base64'));
  const pixel=(x,y)=>[...png.data.subarray((y*png.width+x)*4,(y*png.width+x)*4+3)];
  assert.deepEqual(pixel(110,60),[0,255,0]);
  assert.deepEqual(pixel(110,354),[255,255,0]);
  assert.equal(await page.locator('section').evaluate(el=>el.scrollTop),120);
 } finally {await browser.close();}
});
