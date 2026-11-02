// Prepare the R6 human review on an owned native desk. No gameplay is submitted.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin=process.argv[2]||'http://127.0.0.1:6480';
async function api(route,body){const r=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(600000)});const v=await r.json();if(!r.ok)throw Error(route+JSON.stringify(v));return v;}
assert.ok(!(await api('status')).reviewRun?.active,'Preserve active review');
const f={};
for(const slug of ['mixed-upgrades','snorri-level-up','timed-tie','reverse-time','gydion-active','gydion-expired','spell-event']) {
 const content=await fs.readFile(`.layout-lab/situation-recipes/mobile-r6/${slug}.json`,'utf8');
 f[slug]=(await api('import',{content})).id;
}
const entries=[
 [f['mixed-upgrades'],'hero_hanu','heroes','Upgrade peer pending and one accepted; permitted player names, neutral unknown completion. Open Settings/report/share without submitting.'],
 ['ee0dd0fe03ce','hero_arien','board','Long waiting Message: one pause-scroll-pause-reset cycle, expansion, then changed-message restart on a disposable clone.'],
 ['eebbbbab698b','hero_emmitt','heroes','Owner second-card choice and first committed card; meaningful status, history and source sheen.'],
 ['eebbbbab698b','spectator','heroes','Same checkpoint, separate permitted observer inspection: commitment remains masked and cannot be opened.'],
 [f['snorri-level-up'],'hero_snorri','heroes','Retained rune slots in Level Up: no active rune label or gold highlight.'],
 [f['timed-tie'],'hero_arien','board','Timed team tie: idle forecast, running synchronized clock, NOW/TIE/order in focus and portrait navigation.'],
 [f['reverse-time'],'hero_emmitt','board','Real reversed initiative: ascending public queue, tie groups, coin lookahead and actor across focus changes.'],
 [f['gydion-active'],'hero_gydion','heroes','Two active spells: matching pips and cast-list glow, white inspected sheen, resize for small/normal markers and inspect portrait overlays.'],
 [f['gydion-expired'],'hero_gydion','heroes','Matching history after real expiry: no lingering pips/card glow; normal availability and sheen remain independent.'],
 ['3536c730ea73','hero_razzle','heroes','Bounty and Poison attached to an owned piece: Board, Heroes and focused portrait markers at the agreed reference scale.'],
 [f['spell-event'],'hero_gydion','choice','Disposable clone: select Shield and explicitly Confirm choice to emit SPELL_CAST; inspect notification caster/spell/owner and open its sole Card Focus.']
].map(([situationId,viewpoint,pane,goal])=>({situationId,viewpoint,presentation:{pane},goal}));
const slots=[{source:'live',label:'R6 portrait — working tree',profile:'portrait',render:'2d',uiMode:'mobile',seat:'hero_hanu',autoSwitch:false},{source:'live',label:'R6 landscape — working tree',profile:'landscape',render:'2d',uiMode:'mobile',seat:'hero_hanu',autoSwitch:false}];
await api('synchronize',{mode:'api'});await api('cheats',{show:false});
await api('review-runs/start',{name:'Mobile box refactor — R6: Roster, forecast, markers, notification and motion',performedBy:'human',entries:entries.map(({goal,...entry})=>entry),slots});
const status=await api('status'),views=await api('views');assert.equal(status.reviewRun.total,11);assert.equal(status.reviewRun.index,0);assert.equal(views[0].state.hash,views[1].state.hash);
for(const w of status.windows){assert.equal(w.config.source,'live');assert.deepEqual(w.errors,[]);assert.deepEqual(w.assets,[]);assert.deepEqual(w.warnings,[]);}
await fs.writeFile('.layout-lab/reviews/mobile-r6-handoff.json',JSON.stringify({origin,candidate:'live working tree based on cb0e95f; R5 fixes included',reviewRun:status.reviewRun,entries,uniqueSituations:10,note:'Eleven inspections: Emmitt has separate owner and observer setups.',humanEvaluation:'ready; not evaluated',stop:'POST '+origin+'/api/shutdown {}'},null,2));
console.log(JSON.stringify({origin,run:status.reviewRun.id,inspections:11,uniqueSituations:10}));
