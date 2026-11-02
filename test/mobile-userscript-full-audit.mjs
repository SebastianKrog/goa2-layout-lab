// Windows browser evidence for R6; owns and closes all its services.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
for(const [key,port] of Object.entries({DESK:6520,MAIN:6521,COMPARATOR:6522,BASE:6523,LIVE:6524,BACKEND:11520,BOTS:11521,DEVICE:6620}))process.env[`GOA2_LAB_${key}_PORT`]=String(port);
process.env.GOA2_LAB_DISPLAY="browser";
process.env.GOA2_LAB_MAIN_REF="b060b9f5f12a0ccaa8eddac13d5964b4a8aeb39d";
const {startDesk}=await import("../src/desk.mjs");
const desk=await startDesk({flags:new Set(["--headless","--verification","--no-open","--no-auto-load"])});
const out=path.resolve('.layout-lab/reviews/mobile-full-audit-'+Date.now());await fs.mkdir(out,{recursive:true});
async function api(route,body){const r=await fetch('http://127.0.0.1:6520/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(600000)});const v=await r.json();if(!r.ok)throw Error(route+JSON.stringify(v));return v;}

try {
 const cases=[];
 for(const profile of ['portrait','landscape']) for(const pane of ['board','heroes','hand','deck','log','settings']) cases.push([`menu-${pane}-${profile}`,'e81bc3bd5fff','hero_arien',pane,profile,{}]);
 cases.push(
 ['action-choice','e6cf117c8910','hero_arien','choice','portrait',{}],
 ['defense','2b928b7b0ab4','hero_brogan','choice','portrait',{}],
 ['discard','30735050fbde','hero_brogan','hand','portrait',{}],
 ['actor-choice','50205badf8ea','hero_arien','choice','portrait',{}],
 ['setup-swap','3dd584bc69b4','hero_hanu','choice','portrait',{}],
 ['rune-staging','0601f17bbdab','hero_snorri','choice','portrait',{}],
 ['upgrade-staging','d296bd2e5d3d','hero_arien','choice','portrait',{}],
 ['owner-second-card','eebbbbab698b','hero_emmitt','heroes','portrait',{}],
 ['report-form','e81bc3bd5fff','hero_arien','settings','portrait',{}],
 ['share-form','e81bc3bd5fff','hero_arien','settings','portrait',{}]
 );
 const sourceRoot=path.resolve('../goa2-frontend/src');
 async function sourceHash(){const files=(await fs.readdir(sourceRoot,{recursive:true})).filter(f=>/\.(tsx?|css)$/.test(f)).sort();const hash=createHash('sha256');for(const file of files){hash.update(file);hash.update(await fs.readFile(path.join(sourceRoot,file)));}return hash.digest('hex');}
 const fixedSourceHash=await sourceHash();
 const records=[];
 for(const [name,situationId,seat,pane,profile,changes] of cases){
  assert.equal(await sourceHash(),fixedSourceHash,'Production source changed during the comparison; restart on a stable candidate.');
  try {
  await api('load',{situationId,presentation:{pane,...changes},slots:[{source:'target',label:'Userscript ad1eed5 on a3c5e0a',profile,render:'2d',uiMode:'desktop',seat,autoSwitch:false},{source:'live',label:'Native regression fixes working tree',profile,render:'2d',uiMode:'mobile',seat,autoSwitch:false}]});
  if(name==='report-form'||name==='share-form') for(const w of desk.comparison.windows) await w.page.getByRole('button',{name:name==='report-form'?'Report bug':'Share links',exact:true}).first().click({timeout:8000});
  const status=await api('status'),views=await api('views');
  assert.equal(views[0].state.hash,views[1].state.hash);assert.equal(views[0].scriptActive,true,'Userscript did not activate');
  for(const [index,w] of desk.comparison.windows.entries())await w.page.screenshot({path:path.join(out,name+(index?'-native.png':'-userscript.png')),mask:[w.page.locator('input[readonly]')]});
  assert.equal(await sourceHash(),fixedSourceHash);
  records.push({sourceHash:fixedSourceHash,name,situationId,seat,pane,profile,status:status.windows.map(w=>({config:w.config,errors:w.errors,warnings:w.warnings})),nativeStatus:await desk.comparison.windows.at(-1).page.evaluate(()=>({geometry:[...document.querySelectorAll('[data-mobile-region]')].map(el=>({region:el.dataset.mobileRegion,rect:el.getBoundingClientRect().toJSON(),background:getComputedStyle(el).backgroundColor})),awaiting:window.__GOA2_LAB_STATE__?.awaiting_input,keys:Object.keys(window.__GOA2_LAB_STATE__||{}),text:document.querySelector("[data-mobile-region=action-info]")?.innerText})),views:views.map(w=>({presentation:w.presentation,scriptActive:w.scriptActive,hash:w.state.hash}))});
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({records},null,2));console.log('CAPTURED',name,out);
  } catch(error) {records.push({name,situationId,seat,pane,profile,error:String(error.stack||error)});await fs.writeFile(path.join(out,'results.json'),JSON.stringify({records},null,2));console.log('SETUP GAP',name,error.message);}
 }
 if(records.some(record=>record.error)) process.exitCode=1;
}finally {await desk.close();}
