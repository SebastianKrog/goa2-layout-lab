// M8 utilities: Windows Chromium with isolated services and existing library situations.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
for (const [name, port] of Object.entries({DESK:5980, BASE:5981, COMPARATOR:5982, LIVE:5983, BACKEND:10980})) process.env[`GOA2_LAB_${name}_PORT`] ??= String(port);
process.env.NODE_ENV='production'; process.env.WSLENV=[process.env.WSLENV,'NODE_ENV'].filter(Boolean).join(':');
const {startDesk}=await import('../desk.mjs');
const {DATA}=await import('../config.mjs');
const {showPane}=await import('../presentation.mjs');
const {captureReport}=await import('../report.mjs');
const desk=await startDesk({flags:new Set(['--headless','--verification','--no-open','--no-auto-load'])});
const c=desk.comparison, out=DATA+'/reviews/m8-utilities-'+Date.now(), reports=[];
await fs.mkdir(out,{recursive:true});
async function load(id,seat='hero_arien') {
 await c.load(id,[{source:'live',layout:'mobile'},{source:'target',layout:'desktop'}].map(w=>({...w,seat,profile:'portrait',render:'2d'})));
 for(const w of c.windows) await w.page.emulateMedia({reducedMotion:'reduce'});
 return c.windows[0].page;
}
const pane=(p,name)=>showPane(p,name,c.windows[0].config);
const hash=async()=> (await c.api('/games/'+c.windows[0].clone.game_id,undefined,'GET')).hash;
try {
 let n=await load('a00000000001');
 const initial=await hash();
 const svg=await n.locator('svg[data-board-map]').evaluate(el=>{el.dataset.m8Identity='retained';return true});assert.ok(svg);
 for(const [profile,size] of [['portrait',{width:390,height:844}],['compact',{width:360,height:800}],['landscape',{width:844,height:390}]]) {
  await n.setViewportSize(size); await c.windows[1].page.setViewportSize(size);
  await pane(n,'settings'); await showPane(c.windows[1].page,'settings',c.windows[1].config);
  await n.getByLabel('Spell inspection style',{exact:true}).waitFor();
  for(const w of c.windows) await w.page.evaluate(()=>{for(const el of document.querySelectorAll('[data-mobile-panel="settings"] *, #goa2-m2-settings, #goa2-m2-settings *')) el.scrollTop=0;});
  const report=await captureReport(c,[0,1]);assert.equal(report.diverged,false);reports.push({kind:'settings',profile,...report});
  await n.getByLabel('Card artwork',{exact:true}).uncheck();
  await n.getByLabel('Deck options bar',{exact:true}).uncheck();
  await n.getByLabel('Hand card size',{exact:true}).selectOption('tiny');
  await n.getByLabel('Deck view',{exact:true}).selectOption('list');
  await n.getByLabel('Text size',{exact:true}).focus(); await n.keyboard.press('End');
  assert.equal(await n.getByLabel('Text size',{exact:true}).inputValue(),'4');
  await pane(n,'hand');
  await n.locator('[data-mobile-panel="hand"] [data-card-size="tiny"]').first().waitFor();
  const font=await n.locator('[data-mobile-panel="hand"] [data-card-size="tiny"]').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));assert.ok(font>15, String(font));
  assert.equal(await n.locator('[data-mobile-panel="hand"] [class*="backdropHost"]').count(),0);
  await pane(n,'deck');
  assert.equal(await n.locator('[data-mobile-panel="deck"] [aria-label="Deck layout"]').isVisible(),false);
  await n.screenshot({path:out+'/'+profile+'-large-text-no-art.png'});
  await pane(n,'settings'); await n.getByLabel('Card artwork',{exact:true}).check();await n.getByLabel('Deck options bar',{exact:true}).check();
  await n.getByLabel('Hand card size',{exact:true}).selectOption('small');
  await n.getByLabel('Text size',{exact:true}).focus(); await n.keyboard.press('Home'); for(let i=0;i<4;i++) await n.keyboard.press('ArrowRight');
 }
 await pane(n,'deck'); await n.locator('[data-deck-card] button').first().click(); await n.getByLabel('Deck card preview',{exact:true}).waitFor();
 await n.getByLabel('Deck card preview',{exact:true}).getByRole('button',{name:/^Inspect /}).click(); await n.getByRole('dialog').waitFor();
 await n.keyboard.press('Escape');await n.getByRole('dialog').waitFor({state:'detached'});
 await n.goBack();await n.getByLabel('Deck card preview',{exact:true}).waitFor({state:'detached'});
 assert.equal(await n.locator('[data-pane="deck"]').getAttribute('aria-pressed'),'true');
 assert.equal(await hash(),initial);
 assert.equal(await n.locator('svg[data-board-map]').getAttribute('data-m8-identity'),'retained');
 await pane(n,'settings');
 await n.getByLabel('Hand card size',{exact:true}).selectOption('tiny');
 await n.reload({waitUntil:'domcontentloaded'});await c.ready(c.windows[0]);await pane(n,'settings');
 assert.equal(await n.getByLabel('Hand card size',{exact:true}).inputValue(),'tiny');
 const sound=await n.getByLabel('Sound enabled',{exact:true}).isChecked();await n.getByLabel('Sound enabled',{exact:true}).setChecked(!sound);
 assert.equal(await n.evaluate(()=>localStorage.getItem('goa2.sound.muted')),sound?'1':'0');
 await n.getByLabel('Language',{exact:true}).selectOption('pt-BR');assert.equal(await n.evaluate(()=>localStorage.getItem('goa2.locale')),'pt-BR');
 await n.getByLabel('Language',{exact:true}).selectOption('en');
 if(await n.evaluate(()=>!!document.documentElement.requestFullscreen && document.fullscreenEnabled)) {
  await n.getByRole('button',{name:'Fullscreen',exact:true}).click();await n.waitForFunction(()=>!!document.fullscreenElement);
  await n.getByRole('button',{name:'Exit fullscreen',exact:true}).click();await n.waitForFunction(()=>!document.fullscreenElement);
 }
 console.log('M8 PASS live appearance, persistence, sound/language stores, fullscreen, three viewports');
 await pane(n,'log');await n.getByRole('button',{name:'Decisions',exact:true}).click();
 await n.getByText(/^\d+ decisions$/).waitFor();
 const before=await hash();await n.getByRole('button',{name:'Refresh',exact:true}).click();await n.getByText(/^\d+ decisions$/).waitFor();assert.equal(await hash(),before);
 // Server failure and reconnect are tested at the actual fetch boundary, without changing game data.
 await n.route('**/overrides/history',route=>route.fulfill({status:503,body:'unavailable'}));
 await n.getByRole('button',{name:'Refresh',exact:true}).click();await n.getByRole('alert').filter({hasText:'Decision history unavailable'}).waitFor();
 await n.unroute('**/overrides/history');await n.getByRole('button',{name:'Refresh',exact:true}).click();await n.getByText(/^\d+ decisions$/).waitFor();
 await pane(n,'hand');await n.locator('[data-mobile-panel="hand"] [data-lab-card]').first().click();
 await n.getByRole('button',{name:/^Commit/}).click();await n.getByRole('button',{name:'Take back card',exact:true}).waitFor();
 await pane(n,'log');await n.getByText(/^[1-9]\d* decisions?$/).waitFor();
 assert.match(await n.locator('[aria-label="Game history"] li').last().textContent(),/committed/i);
 const clone=c.windows[0].clone;
 const response=await n.request.get(new URL('/api/games/'+clone.game_id+'/overrides/history',n.url()).href,{headers:{Authorization:'Bearer '+clone.spectator_token}});
 assert.equal(response.status(),200);const spectator=await response.json();assert.match(spectator.decisions.at(-1).label,/a card/);
 await n.screenshot({path:out+'/decisions.png'});
 console.log('M8 PASS authenticated decision history and explicit retry');
 n=await load('00357f1d97ab','hero_gydion'); const spellHash=await hash();
 await pane(n,'settings');await n.getByLabel('Spell inspection style',{exact:true}).selectOption('image');
 await pane(n,'board');await n.getByRole('button',{name:/Spells cast: 3/}).first().click();
 const spell=n.locator('[aria-label*="cast spells"] [aria-label^="View "]').first();await spell.click();
 await n.locator('[data-mobile-spell-preview][data-mode="image"]').waitFor();
 await n.keyboard.press('Escape');await n.locator('[data-mobile-spell-preview]').waitFor({state:'detached'});
 await n.keyboard.press('Escape');await n.locator('[aria-label*="cast spells"]').waitFor({state:'detached'});
 assert.equal(await hash(),spellHash);
 console.log('M8 PASS independent spell Image preference and layered Back/Escape');
 n=await load('d296bd2e5d3d');
 const choose=n.getByRole('button',{name:/^Choose /}).first();await choose.waitFor();await choose.click();
 await n.getByRole('button',{name:'Close upgrade card details',exact:true}).waitFor();
 const staged=await n.locator('[data-staged-upgrade]').count();assert.equal(staged,1);
 await n.keyboard.press('Escape');await n.getByRole('button',{name:'Close upgrade card details',exact:true}).waitFor({state:'detached'});
 assert.equal(await n.locator('[data-staged-upgrade]').count(),staged);
 for(const w of c.windows) assert.deepEqual(w.errors,[]);
 await fs.writeFile(out+'/results.json',JSON.stringify({reports,checks:['appearance','persistence','shared audio/locale','fullscreen','decision history/retry','spell navigation','Deck layered Back','real commit and spectator history masking','upgrade preview Escape preserves staging']},null,2));
 console.log('M8 PASS upgrade preview closes without submitting or losing staging');console.log('M8 evidence:',out);
} catch(error) {
 for(const [i,w] of c.windows.entries()) {await w.page.screenshot({path:out+'/failure-'+i+'.png'}).catch(()=>{});console.error('Render errors',i,w.errors)}
 throw error;
} finally {await desk.close()}
