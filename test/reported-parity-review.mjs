import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import {firefox} from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import {startDesk} from "../desk.mjs";
import {DATA,ROOT} from "../config.mjs";
import {showPane} from "../presentation.mjs";
const app=await startDesk({flags:new Set(["--verification","--headless","--no-open"])});
const c=app.comparison;
const out=path.join(DATA,"reviews/reported-parity",process.env.GOA2_REVIEW_TAG||"before");
await fs.mkdir(out,{recursive:true});
try {
 const situations=await c.api("/situations",undefined,"GET");
 const situation=situations.find(s=>s.id==="a00000000001");
 await c.load(situation.id,[{source:"live",layout:"mobile"},{source:"target",layout:"desktop"}].map(s=>({...s,profile:"portrait",render:"2d",seat:"hero_arien"})),{},situation);
 const record={reference:c.status(),captures:[],reports:[]};
 const files=execFileSync("git",["ls-files","-m","-o","--exclude-standard","--","src","scripts"],{cwd:ROOT,encoding:"utf8",windowsHide:true}).trim().split(/\r?\n/).filter(Boolean);
 record.sourceFiles=await Promise.all(files.map(async file=>({file,sha256:createHash("sha256").update(await fs.readFile(path.join(ROOT,file))).digest("hex")})));
 const save=()=>fs.writeFile(path.join(out,"review.json"),JSON.stringify(record,null,2));
 const baselineHashes=await Promise.all(c.windows.map(w=>c.api(`/games/${w.clone.game_id}`,undefined,"GET").then(r=>r.hash)));
 assert.equal(baselineHashes[0],baselineHashes[1]);
 for(const [profile,size] of [["phone",{width:378,height:781}],["compact",{width:360,height:800}],["landscape",{width:844,height:390}]]) {
  for(const w of c.windows) await w.page.setViewportSize(size);
  for(const pane of ["board","heroes","settings"]) {
   for(const [index,w] of c.windows.entries()) {
    await showPane(w.page,pane,w.config);
    await w.page.waitForTimeout(350);
    await w.page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(i=>i.getBoundingClientRect().width>0 && i.getBoundingClientRect().height>0).map(i=>i.decode().catch(()=>{throw Error("Image did not load: "+new URL(i.src).pathname);})));});
    const file=`${profile}-${pane}-${index===0?"native":"target"}.png`;
    await w.page.screenshot({path:path.join(out,file)});
    const metrics=await w.page.evaluate(()=>[...document.querySelectorAll('header,.m2-hud,.m2-hud-top,#goa2-m2-nav,nav,[data-mobile-board-summary],#goa2-m2-summary,#goa2-m2-settings,[data-mobile-panel="settings"],[data-mobile-hero],.m2-hero-dashboard')].map(e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return {tag:e.tagName,id:e.id,classes:e.className,box:{x:r.x,y:r.y,width:r.width,height:r.height},font:s.font,background:s.backgroundColor,border:s.border,padding:s.padding,grid:s.gridTemplateColumns,display:s.display,children:[...e.children].slice(0,8).map(child=>{const r=child.getBoundingClientRect();return {tag:child.tagName,classes:child.className,box:{x:r.x,y:r.y,width:r.width,height:r.height},font:getComputedStyle(child).font,grid:getComputedStyle(child).gridTemplateColumns,children:[...child.children].slice(0,8).map(e=>({classes:e.className,width:e.getBoundingClientRect().width,font:getComputedStyle(e).font}))};}),text:e.textContent.slice(0,150)};}));
    const selectors=index===0 ? (pane==="board" ? ['header','[data-mobile-board-summary]','nav[aria-label="Game views"]'] : pane==="heroes" ? ['[data-mobile-hero]'] : ['[data-mobile-panel="settings"]']) : (pane==="board" ? ['.m2-hud','#goa2-m2-summary','#goa2-m2-nav'] : pane==="heroes" ? ['[data-m2="hero"]:has(> .m2-hero-dashboard)'] : ['#goa2-m2-settings']);
    for(const [part,selector] of selectors.entries()) {
      const element=w.page.locator(selector).first();
      if(await element.isVisible()) await element.screenshot({path:path.join(out,`${profile}-${pane}-${index}-part-${part}.png`),animations:"disabled"});
    }
    record.captures.push({profile,pane,index,file,metrics});
    await save();
    if (index===0 && pane==="board") {
      assert.equal(await w.page.getByRole("button",{name:"Rotate board right",exact:true}).count(),0);
      assert.equal(await w.page.getByRole("button",{name:"Fit board",exact:true}).count(),0);
      assert.equal(await w.page.getByRole("button",{name:"Reset board zoom, pan and rotation",exact:true}).count(),1);
    }
    if (pane==="settings") {
      await w.page.evaluate((index)=> {const e=document.querySelector(index===0?'[data-mobile-panel="settings"]':'#goa2-m2-settings'); if(e) e.scrollTop=e.scrollHeight;},index);
      await w.page.screenshot({path:path.join(out,`${profile}-settings-bottom-${index}.png`)});
    }
   }
   const snapshots=await Promise.all(c.windows.map((w,index)=>w.page.evaluate(({index,pane})=>{
     const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
     const rows=[...document.querySelectorAll(index===0?'[data-mobile-board-summary] > div':'#goa2-m2-summary > article')];
     return {nav:box(document.querySelector(index===0?'nav[aria-label="Game views"]':'#goa2-m2-nav')),rows:pane==='board'?rows.map(e=>({box:box(e),columns:getComputedStyle(e).gridTemplateColumns.split(' ').map(parseFloat)})):[]};
   },{index,pane})));
   for(const key of ['x','y','width','height']) assert.ok(Math.abs(snapshots[0].nav[key]-snapshots[1].nav[key])<=1,`${profile}/${pane} navigation ${key}`);
   if(pane==='board') for(let row=0;row<snapshots[0].rows.length;row++) {
     const a=snapshots[0].rows[row],b=snapshots[1].rows[row];
     assert.ok(b,'Matching hero row');
     for(const key of ['x','y','width','height']) assert.ok(Math.abs(a.box[key]-b.box[key])<=1,`${profile}/row${row}/${key}: ${a.box[key]} vs ${b.box[key]}`);
     for(let col=0;col<6;col++) assert.ok(Math.abs(a.columns[col]-b.columns[col])<=1,`${profile}/row${row}/col${col}: ${a.columns[col]} vs ${b.columns[col]}`);
   }
   record.captures.push({profile,pane,geometry:snapshots}); await save();
   assert.deepEqual(await Promise.all(c.windows.map(w=>c.api(`/games/${w.clone.game_id}`,undefined,"GET").then(r=>r.hash))),baselineHashes);
  }
 }
 // Dynamic public-roster variants use real saved situations, not mock game facts.
 for(const [id,seat] of [["f2728687d079","hero_gydion"],["09fa8b1ac243","hero_snorri"],["a00000000002","hero_arien"]]) {
  const situation=situations.find(s=>s.id===id); assert.ok(situation,id);
  await c.load(id,[{source:"live",layout:"mobile"},{source:"target",layout:"desktop"}].map(w=>({...w,profile:"portrait",render:"2d",seat})),{},situation);
  const hashes=await Promise.all(c.windows.map(w=>c.api(`/games/${w.clone.game_id}`,undefined,"GET").then(r=>r.hash)));
  assert.equal(hashes[0],hashes[1]);
  for(const pane of ["board","heroes"]) for(const [index,w] of c.windows.entries()) {
    await showPane(w.page,pane,w.config);
    await w.page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(i=>i.getBoundingClientRect().width>0&&i.getBoundingClientRect().height>0).map(i=>i.decode().catch(()=>{throw Error("Image did not load: "+new URL(i.src).pathname);})));});
    await w.page.screenshot({path:path.join(out,`${id}-${pane}-${index}.png`),animations:"disabled"});
    record.captures.push({situationId:id,pane,index,hash:hashes[index]}); await save();
  }
 }
 // Reopen actual user report checkpoints, keeping all gameplay unsubmitted.
 for (const id of ["39181d023f93","5d8b4356efe9"]) {
  const situation=await c.api("/import",{content:JSON.parse(await fs.readFile(path.join(DATA,"reports/device",id,"situation.json"),"utf8"))});
  await c.load(situation.id,[{source:"live",layout:"mobile",profile:"portrait",render:"2d",seat:"hero_arien"}],{},situation);
  const win=c.windows[0]; const n=win.page;
  await n.setViewportSize({width:378,height:781});
  const original=(await c.api(`/games/${win.clone.game_id}`,undefined,"GET")).hash;
  const choose=()=>n.getByRole("button",{name:/^Choose /});
  await choose().first().waitFor();
  const all=await choose().evaluateAll(es=>es.map(e=>({id:e.closest('[data-deck-card]').dataset.deckCard,label:e.getAttribute('aria-label')})));
  await choose().first().click();
  await n.waitForFunction(()=>document.querySelectorAll('[data-staged-upgrade]').length===1);
  await n.getByText("Checking available upgrades…",{exact:true}).waitFor({state:"hidden"});
  if (id==="39181d023f93") {
    const alternative=all.find(card=>card.id!==all[0].id);
    await n.getByRole("button",{name:alternative.label,exact:true}).click();
    await n.waitForFunction(id=>document.querySelector('[data-staged-upgrade]')?.getAttribute('data-staged-upgrade')===id,alternative.id);
    assert.equal(await n.locator('[data-staged-upgrade]').count(),1);
  } else {
    while(await n.locator('[data-staged-upgrade]').count()<3) {
      await n.getByText("Checking available upgrades…",{exact:true}).waitFor({state:"hidden"});
      const available=n.locator('[data-deck-card][data-state="Available"] > button[aria-label^="Choose "]');
      await available.first().click();
    }
    await n.getByText("Checking available upgrades…",{exact:true}).waitFor({state:"hidden"});
    const queue=await n.locator('[data-staged-upgrade]').evaluateAll(es=>es.map(e=>e.getAttribute('data-staged-upgrade')));
    await n.locator(`[data-deck-card="${queue[0]}"] > button`).click();
    const boosted=n.locator('[aria-label="Upgrade preview"] [data-upgraded] b');
    assert.ok(await boosted.count()>0,"Selected preview has item-affected values");
    assert.equal(await boosted.first().evaluate(e=>getComputedStyle(e).color),"rgb(255, 224, 156)");
  }
  const nav=await n.locator('nav[aria-label="Game views"]').boundingBox();
  assert.ok(nav.height<=48,`Phone footer height ${nav.height}`);
  assert.equal((await c.api(`/games/${win.clone.game_id}`,undefined,"GET")).hash,original);
  await n.screenshot({path:path.join(out,`report-${id}-chromium.png`)});
  if(id==="5d8b4356efe9") {
    const browser=await firefox.launch({headless:true});
    try {
      const phone=await browser.newPage({viewport:{width:378,height:781},deviceScaleFactor:1,hasTouch:true});
      await phone.goto(n.url());
      await phone.locator('[data-mobile-upgrade-picker]').waitFor();
      await phone.waitForLoadState("networkidle");
      await phone.getByText("Checking available upgrades…",{exact:true}).waitFor({state:"hidden"});
      const footer=await phone.locator('nav[aria-label="Game views"]').boundingBox();
      assert.ok(footer.height<=48,`Firefox footer height ${footer.height}`);
      await phone.screenshot({path:path.join(out,'report-footer-firefox.png')});
      record.reports.push({id,firefoxFooter:footer});
    } finally {await browser.close();}
  }
  record.reports.push({id,unchangedHash:original,footer:nav}); await save();
 }
 await save();
 console.log("Evidence:",out);
} finally {await app.close();}
