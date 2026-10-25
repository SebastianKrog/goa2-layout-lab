import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
for(const [name,port] of Object.entries({DESK:6310,MAIN:6311,COMPARATOR:6312,BASE:6313,LIVE:6314,BACKEND:11310,BOTS:11311,DEVICE:6410}))process.env[`GOA2_LAB_${name}_PORT`]=String(port);
process.env.GOA2_LAB_DISPLAY='browser';process.env.GOA2_LAB_MAIN_REF='076e927ca91af3b0c8591c286549f04a04bc3af2';process.env.GOA2_LAB_COMPARATOR_REF=process.argv[2]||'009233f45069a9868a8221f57740b0515d56360e';
const {startDesk}=await import('../src/desk.mjs');const {DATA}=await import('../src/config.mjs');
const output=path.join(DATA,'reviews','mobile-r3-'+Date.now());await fs.mkdir(output,{recursive:true});const desk=await startDesk({flags:new Set(['--headless','--verification','--no-open','--no-auto-load'])});
const records=[];async function api(route,body){const r=await fetch('http://127.0.0.1:6310/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(600000)});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;}
async function load(id,seat,presentation,profile='portrait',pair=false){await api('load',{situationId:id,presentation,slots:[...(pair?[{source:'main',label:'R2',profile,render:'2d',uiMode:'mobile',seat}]:[]),{source:'comparator',label:'R3',profile,render:'2d',uiMode:'mobile',seat}]});return desk.comparison.windows.at(-1).page;}
async function geometry(page,key){const r=await page.evaluate(()=>({regions:[...document.querySelectorAll('[data-mobile-region]')].map(el=>({name:el.dataset.mobileRegion,visible:el.checkVisibility(),...el.getBoundingClientRect().toJSON(),background:getComputedStyle(el).backgroundColor})),readers:[...document.querySelectorAll('[role="dialog"]')].filter(el=>el.checkVisibility()).map(el=>({label:el.getAttribute('aria-label'),modal:el.getAttribute('aria-modal'),region:el.closest('[data-mobile-region]')?.dataset.mobileRegion})),ticker:document.querySelectorAll('[data-mobile-region="message"] [role="status"]').length,headerTickers:document.querySelectorAll('[data-mobile-region="header"] [role="status"]').length}));assert.equal(r.regions.length,6);assert.equal(new Set(r.regions.map(r=>r.name)).size,6);assert.equal(r.ticker,1);assert.equal(r.headerTickers,0);await page.screenshot({path:path.join(output,key+'.png')});records.push({key,...r});return r;}
async function clean(){const s=await api('status');for(const w of s.windows){assert.deepEqual(w.errors,[]);assert.deepEqual(w.assets,[]);assert.deepEqual(w.warnings,[]);}}
try{
 for(const profile of (process.argv.includes('--references-only')?[]:['portrait','landscape'])){
  const page=await load('e81bc3bd5fff','hero_arien',{pane:'hand',selectedCard:'noble_blade'},profile,true);
  await page.locator('[data-mobile-region="card-focus"] [aria-label="Inspect Noble Blade"]').waitFor();
  const r=await geometry(page,'hand-'+profile),focus=r.regions.find(r=>r.name==='card-focus'),info=r.regions.find(r=>r.name==='action-info'),message=r.regions.find(r=>r.name==='message'),menu=r.regions.find(r=>r.name==='menu');
  assert.equal(r.readers.filter(r=>r.region==='card-focus').length,1);assert.ok(r.readers.every(r=>r.modal==='false'));
  if(profile==='portrait')assert.ok(focus.bottom<=info.top+1);else{assert.ok(focus.right<=info.left+1);assert.ok(menu.x>=info.right);assert.ok(message.right<=info.left+1);}
  const capture=await api('capture',{indexes:[0,1]});assert.equal(capture.diverged,false);records.push({key:'comparison-'+profile,capture});
  const views=await api('views');assert.equal(views[0].state.hash,views[1].state.hash);
  await page.evaluate(()=>{window.__r3Board=document.querySelector('svg[data-board-map]');window.__r3Message=document.querySelector('[data-mobile-region="message"] [role="status"]');});
  const nav=page.getByRole('navigation',{name:'Game views'});
  await nav.getByRole('button',{name:'Hand',exact:true}).click();
  const boardBox=await page.locator('svg[data-board-map]').boundingBox();
  const oldCamera=await page.locator('svg[data-board-map]').evaluate(el=>el.style.transform);
  await page.mouse.move(boardBox.x+boardBox.width*.5,boardBox.y+boardBox.height*.2);await page.mouse.wheel(0,-300);
  await page.waitForFunction(old=>document.querySelector('svg[data-board-map]').style.transform!==old,oldCamera);
  await page.evaluate(()=>window.__r3Camera=document.querySelector('svg[data-board-map]').style.transform);
  await nav.getByRole('button',{name:'Hand',exact:true}).click();
  await page.getByRole('button',{name:'Noble Blade',exact:true}).click();
  await nav.getByRole('button',{name:'Heroes',exact:true}).click();await nav.getByRole('button',{name:'Hand',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__r3Board===document.querySelector('svg[data-board-map]')&&window.__r3Message===document.querySelector('[data-mobile-region="message"] [role="status"]')),true);
  assert.equal(await page.evaluate(()=>window.__r3Camera===document.querySelector('svg[data-board-map]').style.transform),true,'Manual camera transform survives menu/focus changes');
  await page.getByRole('button',{name:'Noble Blade',exact:true}).click();await page.keyboard.press('Enter');assert.equal((await api('views'))[1].state.hash,views[1].state.hash);
  // Changing viewport changes arrangement without remounting Board or clearing local focus.
  await page.setViewportSize(profile==='portrait'?{width:844,height:390}:{width:390,height:844});await page.locator('[data-mobile-region="card-focus"] [aria-label="Inspect Noble Blade"]').waitFor();assert.equal(await page.evaluate(()=>window.__r3Board===document.querySelector('svg[data-board-map]')),true);await geometry(page,'rotated-from-'+profile);await clean();console.log('PASS',profile);
 }
 let page=await load('7cc3ce17c3e7','hero_brogan',{pane:'heroes'});const before=(await api('views'))[0].state.hash;
 const source=page.locator('[data-mobile-panel="heroes"] [aria-label^="Inspect "]').first();await source.click();await page.locator('[data-mobile-region="card-focus"] [role="dialog"]').waitFor();await geometry(page,'history-focus');assert.equal((await api('views'))[0].state.hash,before);await clean();
 for(const id of ['dbd50506df47','ad66cbbbda7e']){
  page=await load(id,'hero_gydion',id==='ad66cbbbda7e'?{pane:'hand',selectedCard:'cantrip'}:{pane:'hand',inspectionMobile:'cantrip'});await page.locator('[data-mobile-region="card-focus"] [aria-label="Inspect Cantrip"]').waitFor();
  const ref=page.locator('[data-mobile-region="card-focus"] [aria-label^="Inspect "][data-card-interaction]').first();const label=await ref.getAttribute('aria-label');
  await page.setViewportSize({width:390,height:640});
  await page.evaluate(()=>{const p=document.querySelector('[data-mobile-region="card-focus"] [role="dialog"]');window.__r3Parent=p;const scroll=p.querySelector('[class*="readerCard_"]');window.__r3Scroller=scroll;scroll.scrollTop=40;window.__r3ParentScroll=scroll.scrollTop;});
  assert.ok(await page.evaluate(()=>window.__r3ParentScroll>0),'A real overflowing parent is required for scroll retention');const hash=(await api('views'))[0].state.hash;await ref.click();await page.locator('[data-nested-card]').waitFor();
  const r=await geometry(page,'gydion-'+id);assert.equal(r.readers.filter(r=>r.modal==='true').length,1);assert.ok(r.readers.every(r=>r.region==='card-focus'));
  const bounds=await page.locator('[data-nested-card]').evaluate(el=>({child:el.getBoundingClientRect().toJSON(),parent:el.closest('[data-mobile-region="card-focus"]').getBoundingClientRect().toJSON()}));assert.ok(bounds.child.left>=bounds.parent.left&&bounds.child.right<=bounds.parent.right&&bounds.child.top>=bounds.parent.top&&bounds.child.bottom<=bounds.parent.bottom);
  await page.getByRole('button',{name:'Back to Cantrip',exact:true}).click();await page.locator('[data-nested-card]').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.__r3Parent===document.querySelector('[data-mobile-region="card-focus"] [role="dialog"]')&&window.__r3Scroller.scrollTop===window.__r3ParentScroll),true);assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),label);assert.equal((await api('views'))[0].state.hash,hash);await clean();console.log('PASS',id);
 }
 page=await load('5949a8eccf40','hero_wasp',{pane:'heroes',spellBrowserMobile:{heroId:'hero_gydion'}});await page.locator('[data-mobile-region="action-info"] [data-lab-mobile-spells]').waitFor();const spell=page.locator('[data-lab-preview-spell]').first();await spell.click();await page.locator('[data-mobile-region="card-focus"] [data-mobile-spell-preview]').waitFor();const r=await geometry(page,'public-spells');assert.equal(r.readers.filter(r=>r.region==='card-focus').length,1);assert.ok(r.readers.every(r=>r.modal==='false'));assert.equal(await page.locator('[data-mobile-region="action-info"] [data-card-size="large"]').count(),0);await clean();
 await fs.writeFile(path.join(output,'results.json'),JSON.stringify({source:process.env.GOA2_LAB_COMPARATOR_REF,baseline:process.env.GOA2_LAB_MAIN_REF,records},null,2));console.log('R3 evidence',output);
}catch(error){await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),records},null,2));const page=desk.comparison.windows.at(-1)?.page;if(page){await page.screenshot({path:path.join(output,'failure.png')});await fs.writeFile(path.join(output,'failure.html'),await page.content());}throw error;}finally{await desk.close();}
