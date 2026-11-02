import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { devicePresentationWarnings, restoreMobilePane } from '../src/presentation-plan.mjs';
import { Reviews } from '../src/reviews.mjs';
import { inspectionOptions } from '../src/inspection.mjs';

const warnings = [
  'Viewpoint is configured separately and was skipped in this Presentation.',
  'Presentation change scroll is unsupported and was skipped.',
  'Presentation change windowScroll is unsupported and was skipped.',
];
test('device defaults do not obscure real restoration failures', () => {
  const intended = { viewpoint:'hero_arien', warnings:[...warnings,'Card: unavailable'] };
  assert.deepEqual(devicePresentationWarnings(intended,{scroll:[],windowScroll:{x:0,y:0}},{seat:'hero_arien'}),['Card: unavailable']);
  assert.deepEqual(devicePresentationWarnings(intended,{scroll:[{top:20}],windowScroll:{x:0,y:50}},{seat:'hero_other'}),[...warnings,'Card: unavailable']);
});
test('opening a review device passes sparse changes and keeps viewpoint on the slot', () => {
  const review = Object.create(Reviews.prototype);
  review.current = {active:true,id:'run',index:0,entries:[{situation:{id:'fixture',review_snapshot:{runId:'run'}},viewpoint:'hero_arien',presentation:{schema:2,sessionState:{pane:'choice'}}}]};
  review.plan = () => ({config:{seat:'hero_arien'},presentation:{schema:2,viewpoint:'hero_arien',sessionState:{pane:'choice',scroll:[],windowScroll:{x:0,y:0}},userState:{}}});
  const body = review.deviceBody({slot:{source:'comparator'}});
  assert.equal(body.slot.seat,'hero_arien');
  assert.deepEqual(body.presentation,{schema:2,sessionState:{pane:'choice'},userState:{}});
  assert.deepEqual(inspectionOptions(body).presentation.warnings || [],[]);
  assert.deepEqual(body.reviewSnapshot,{runId:'run'});
});
test('device Choice uses the shared Board/Choice control and actual pane state', async () => {
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent(`<main aria-label="Mobile game" data-mobile-pane="board"><button data-pane="board-choice" aria-pressed="false">Choice</button><button data-pane="hand" aria-pressed="false">Hand</button></main><script>window.commands=0;const root=document.querySelector('main');for(const button of document.querySelectorAll('button'))button.onclick=()=>setTimeout(()=>{const next=button.dataset.pane==='board-choice'?(root.dataset.mobilePane==='choice'?'board':'choice'):(root.dataset.mobilePane==='hand'?'board':'hand');root.dataset.mobilePane=next;for(const b of document.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.pane===(next==='choice'?'board-choice':next)));},20);<\/script>`);
    for(const name of ['choice','board','hand','board']) {
      await page.evaluate(async ({source,name})=>{
        const restore=eval('('+source+')');
        const until=async read=>{const end=performance.now()+1000;while(performance.now()<end){const value=read();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error('Unavailable');};
        const visible=selector=>document.querySelector(selector);
        await restore(name,{until,visible});
      },{source:restoreMobilePane.toString(),name});
      assert.equal(await page.locator('main').getAttribute('data-mobile-pane'),name);
    }
    assert.equal(await page.evaluate(()=>window.commands),0);
  } finally {await browser.close();}
});
