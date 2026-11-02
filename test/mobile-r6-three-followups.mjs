import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
for(const [k,v] of Object.entries({DESK:6520,MAIN:6521,COMPARATOR:6522,BASE:6523,LIVE:6524,BACKEND:11520,BOTS:11521,DEVICE:6620}))process.env[`GOA2_LAB_${k}_PORT`]=String(v);
process.env.GOA2_LAB_DISPLAY='browser';
process.env.GOA2_LAB_MAIN_REF='b060b9f5f12a0ccaa8eddac13d5964b4a8aeb39d';
const {startDesk}=await import('../src/desk.mjs');
const desk=await startDesk({flags:new Set(['--headless','--verification','--no-open','--no-auto-load'])});
const out=path.resolve('.layout-lab/reviews/mobile-final-regressions-'+Date.now());await fs.mkdir(out,{recursive:true});
const src=path.resolve('../goa2-frontend/src');
async function hash(){const h=createHash('sha256');for(const f of (await fs.readdir(src,{recursive:true})).filter(f=>/\.(tsx?|css)$/.test(f)).sort()){h.update(f);h.update(await fs.readFile(path.join(src,f)));}return h.digest('hex');}
const sourceHash=await hash();const records=[];
async function api(route,body){const r=await fetch('http://127.0.0.1:6520/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(600000)});const v=await r.json();if(!r.ok)throw Error(route+JSON.stringify(v));return v;}
async function load(id,seat,pane,profile='portrait',changes={}){assert.equal(await hash(),sourceHash);await api('load',{situationId:id,presentation:{pane,...changes},slots:[{source:'live',label:'Final R6 regression candidate',profile,render:'2d',uiMode:'mobile',seat,autoSwitch:false}]});const w=desk.comparison.windows.at(-1);const s=(await api('status')).windows.at(-1);assert.deepEqual(s.errors,[]);assert.deepEqual(s.assets,[]);return w.page;}
async function record(name,p,data={}){assert.equal(await hash(),sourceHash);await p.screenshot({path:path.join(out,name+'.png')});records.push({name,...data});await fs.writeFile(path.join(out,'results.json'),JSON.stringify({sourceHash,records},null,2));console.log('PASS',name,out);}
try {
 await api('synchronize',{mode:'none'});
 let p=await load('0601f17bbdab','hero_snorri','choice');
 const slots=p.locator('[aria-label="Rune arrangement"]');await slots.waitFor();
 assert.equal(await slots.locator('[aria-current="step"]').evaluate(e=>getComputedStyle(e).borderColor),'rgb(255, 255, 255)');
 await record('rune-empty-slots',p);
 for(const name of ['bird','axe','anvil'])await p.getByRole('button',{name:'Choose '+name,exact:true}).click();
 await p.getByRole('button',{name:'Commit runes',exact:true}).waitFor();
 assert.equal(await slots.locator('[aria-current="step"]').count(),0);
 await record('rune-complete-slots',p);
 p=await load('2addc83d5f5f','hero_snorri','choice','landscape',{inspectedCard:'oath_of_perseverance'});
 const reader=p.locator('[data-mobile-region="card-focus"]');await reader.locator('[data-lab-mobile-inspection]').waitFor();
 const geometry=await p.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect().toJSON();return{message:r('[data-mobile-region="message"]'),focus:r('[data-mobile-region="card-focus"]'),workspace:r('[data-mobile-region="board"]'),nav:r('[data-mobile-region="menu"]'),background:getComputedStyle(document.querySelector('[data-mobile-region="card-focus"]')).backgroundColor};});
 assert.ok(geometry.message.width<422);
 assert.ok(Math.abs(geometry.focus.bottom-geometry.workspace.bottom)<1);assert.equal(geometry.background,'rgb(17, 25, 37)');
 await record('landscape-left-message-opaque-reader',p,{geometry});
}catch(e){console.error(e.stack);await fs.writeFile(path.join(out,'failure.txt'),e.stack);process.exitCode=1;}finally{await desk.close();}
