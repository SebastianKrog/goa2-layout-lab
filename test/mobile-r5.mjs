// R4 Windows Chromium verification. node test/mobile-r4.mjs [live|frontend-ref]
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
for (const [key, port] of Object.entries({
  DESK: 6390,
  MAIN: 6391,
  COMPARATOR: 6392,
  BASE: 6393,
  LIVE: 6394,
  BACKEND: 11390,
  BOTS: 11391,
  DEVICE: 6490,
}))
  process.env[`GOA2_LAB_${key}_PORT`] = String(port);
process.env.GOA2_LAB_DISPLAY = "browser";
process.env.GOA2_LAB_MAIN_REF = "cd5ab06f12fe255d91751f1877d3967b55374a05";
const ref = process.argv[2] || "live";
if (ref !== "live") process.env.GOA2_LAB_COMPARATOR_REF = ref;
const { startDesk } = await import("../src/desk.mjs");
const { DATA } = await import("../src/config.mjs");
const out = path.join(DATA, "reviews", "mobile-r5-" + Date.now());
await fs.mkdir(out, { recursive: true });
const desk = await startDesk({
  flags: new Set([
    "--headless",
    "--verification",
    "--no-open",
    "--no-auto-load",
  ]),
});
async function api(name, body) {
  const r = await fetch("http://127.0.0.1:6390/api/" + name, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(600000),
  });
  const value = await r.json();
  if (!r.ok) throw Error(name + ": " + JSON.stringify(value));
  return value;
}
const slot = (source, seat, profile = "portrait") => ({
  source,
  label: source === "main" ? "R3 baseline" : ref,
  profile,
  render: "2d",
  uiMode: "mobile",
  seat,
  autoSwitch: false,
});
async function load(
  id,
  seat,
  presentation,
  profile = "portrait",
  pair = false,
) {
  await api("load", {
    situationId: id,
    presentation,
    slots: [
      ...(pair ? [slot("main", seat, profile)] : []),
      slot(ref === "live" ? "live" : "comparator", seat, profile),
    ],
  });
  assert.equal(
    desk.comparison.windows.at(-1).config.seat,
    seat,
    "Use the requested viewpoint",
  );
  return desk.comparison.windows.at(-1).page;
}
const records = [];
async function hash() {
  return (await api("views")).at(-1).state.hash;
}
async function clean() {
  const s = await api("status");
  for (const w of s.windows) {
    assert.deepEqual(w.errors, []);
    assert.deepEqual(w.assets, []);
    assert.deepEqual(w.warnings, []);
  }
}
async function snap(page, name) {
  await clean();
  await page.screenshot({ path: path.join(out, name + ".png") });
  records.push({
    name,
    hash: await hash(),
    regions: await page.locator("[data-mobile-region]").evaluateAll((els) =>
      els.map((el) => ({
        name: el.dataset.mobileRegion,
        rect: el.getBoundingClientRect().toJSON(),
        visible: el.checkVisibility(),
      })),
    ),
  });
  console.log("PASS", name);
}
async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
async function board(page) {
  await settle(page);
  const nav = page.getByRole("navigation", { name: "Game views" });
  if (
    (await page
      .locator("[data-mobile-boxes]")
      .getAttribute("data-mobile-pane")) !== "board"
  )
    await nav.locator('[data-pane="board-choice"]').click();
}
async function choice(page) {
  await settle(page);
  const nav = page.getByRole("navigation", { name: "Game views" });
  if (
    (await page
      .locator("[data-mobile-boxes]")
      .getAttribute("data-mobile-pane")) !== "choice"
  )
    await nav.locator('[data-pane="board-choice"]').click();
}

const fixtureIds = {};
const grantsOnly = process.argv.includes("--grants-only");
const resume = process.argv.find(arg => arg.startsWith("--resume="))?.slice(9);
const owner = async (page, selector) => assert.equal(await page.locator(selector).evaluate(el => el.closest('[data-mobile-region]').dataset.mobileRegion), 'action-info');
try {
  for (const file of ['gydion-upgrades', 'snorri-confirmation']) fixtureIds[file] = (await api('import', {content: await fs.readFile(path.join(DATA, 'situation-recipes/mobile-r5', file + '.json'), 'utf8')})).id;
  await fs.writeFile(path.join(DATA, 'reviews/mobile-r5-situations.json'), JSON.stringify(fixtureIds, null, 2));
  let page;
  if (grantsOnly) {
    // Focused verification after the shared grant adapter correction.
  } else if (resume) {
    const origin = JSON.parse(await fs.readFile(path.join(resume, 'verification-origin.json'), 'utf8'));
    assert.equal(origin.candidate, ref); assert.equal(origin.baseline, process.env.GOA2_LAB_MAIN_REF);
    const previous = JSON.parse(await fs.readFile(path.join(resume, 'failure.json'), 'utf8'));
    assert.equal(previous.records.length, 14);
    for (const record of previous.records) { records.push({...record, origin: resume}); await fs.copyFile(path.join(resume, record.name+'.png'), path.join(out, record.name+'.png')); console.log('PASS reused', record.name); }
    await fs.copyFile(path.join(resume, 'verification-origin.json'), path.join(out, 'verification-origin.json'));
  } else {
  page = await load('e6cf117c8910', 'hero_arien', {pane:'choice'});
  await page.locator('[data-mobile-region="card-focus"] [data-card-size="large"]').waitFor();
  for (const size of [{width:390,height:844},{width:844,height:390}]) {
    await page.setViewportSize(size); await settle(page);
    const rect = await page.locator('[data-mobile-region="card-focus"]').boundingBox();
    assert.ok(rect.height <= 280, JSON.stringify(rect));
    await snap(page, 'r4-card-height-' + size.width);
  }
  page = await load('2b928b7b0ab4','hero_brogan',{pane:'choice'});
  assert.equal(await page.locator('[aria-label="Game decision"] button[title^="Inspect"]').count(),0);
  await snap(page,'r4-defense');
  page = await load('30735050fbde','hero_brogan',{pane:'choice'});
  assert.equal(await page.locator('[data-mobile-panel="hand"]').isVisible(),true);
  await page.getByRole('button',{name:'Hand',exact:true}).click();
  await page.getByRole('button',{name:'Confirm discard'}).waitFor();
  await owner(page,'[aria-label="Game decision"]'); await snap(page,'r4-discard-hand');
  page = await load('50205badf8ea','hero_arien',{pane:'choice'});
  assert.equal(await page.getByRole('heading',{name:'Who acts first?'}).isVisible(),true);
  assert.ok(!(await page.locator('[data-mobile-region="message"]').textContent()).includes('hero_'));
  await snap(page,'r4-actor');
  const swaps = JSON.parse(await fs.readFile(path.join(DATA,'reviews/mobile-r4-situations.json'),'utf8'));
  for (const seat of ['hero_arien','hero_hanu']) {
    page = await load(swaps['pending-swap'],seat,{pane:'choice'});
    await owner(page,'[aria-label="Starting position"]');
    if(seat==='hero_arien') assert.equal(await page.getByRole('button',{name:/Swap with/}).count(),0);
    else {
      const a=await page.getByRole('button',{name:'Accept',exact:true}).boundingBox(), d=await page.getByRole('button',{name:'Decline',exact:true}).boundingBox();
      assert.equal(a.y,d.y); assert.ok(Math.abs(a.width-d.width)<1);
      await page.getByRole('button',{name:'Change starting position'}).click();
      await page.getByRole('button',{name:'Done adjusting'}).waitFor();
    }
    await snap(page,'r4-swap-'+seat);
  }
  for (const id of ['7596eb876af3','d296bd2e5d3d',fixtureIds['gydion-upgrades']]) {
    const seat = id===fixtureIds['gydion-upgrades']?'hero_gydion':'hero_arien';
    page=await load(id,seat,{pane:'choice'}); const before=await hash();
    const count=id==='7596eb876af3'?1:6;
    await owner(page,'[data-mobile-upgrade-picker]');
    assert.equal((await page.getByLabel('Upgrade progress').textContent()).trim(),'0/'+count);
    assert.ok(!(await page.locator('[data-mobile-upgrade-picker]').textContent()).includes('Per-tier targets'));
    for(let i=0;i<count;i++) {
      await page.waitForFunction(()=> !document.querySelector('[data-upgrade-validation]')?.textContent.includes('Checking'));
      const pick=page.locator('[data-deck-card][data-state="Available"] button[aria-label^="Choose "]').first(); await pick.waitFor(); await pick.click();
      await page.waitForFunction(n=>document.querySelectorAll('[data-staged-upgrade]').length===n,i+1);
      await settle(page);
    }
    await page.getByRole('button',{name:new RegExp('^Commit '+count+' upgrade')}).waitFor();
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>/^Commit .*upgrade/.test(b.textContent))?.disabled);
    assert.equal(await page.locator('[data-mobile-region="card-focus"] [data-card-size="large"]').count(),1);
    assert.equal(await page.locator('[data-mobile-upgrade-picker] [data-card-size="large"]').count(),0);
    await board(page); await settle(page); await choice(page);
    await page.locator('[data-mobile-boxes][data-mobile-pane="choice"]').waitFor();
    await page.locator('[data-mobile-region="card-focus"] [data-card-size="large"]').waitFor();
    assert.equal(await page.locator('[data-staged-upgrade]').count(),count);
    assert.equal(await hash(),before); await snap(page,'upgrades-'+seat+'-'+count);
  }
  page=await load('ad66cbbbda7e','hero_gydion',{pane:'hand'});
  await page.getByRole('button',{name:'Cantrip',exact:true}).click();
  await page.locator('[data-mobile-region="card-focus"]').getByRole('button',{name:'Inspect Magic Missile',exact:true}).click();
  await page.locator('[data-nested-card]').waitFor();
  const parentRect=await page.locator('[data-mobile-region="card-focus"]').boundingBox(), nestedRect=await page.locator('[data-nested-card]').boundingBox();
  assert.ok(nestedRect.y>=parentRect.y && nestedRect.y+nestedRect.height<=parentRect.y+parentRect.height+1);
  await snap(page,'bounded-nested-spell');
  page=await load('ad66cbbbda7e','hero_gydion',{pane:'deck'}); const beforeDeck=await hash();
  await page.getByRole('button',{name:'View Cantrip',exact:true}).click();
  await page.locator('[aria-label="Deck card preview"]').waitFor();
  await page.locator('[data-mobile-region="card-focus"]').getByRole('button',{name:'Inspect Magic Missile',exact:true}).click();
  await page.getByRole('dialog',{name:'Inspect Magic Missile',exact:true}).waitFor();
  assert.equal(await page.locator('[data-nested-card]').count(),0);
  for(const mode of ['List','Grid','Tree']) { await page.getByRole('button',{name:mode,exact:true}).click(); await settle(page); }
  const toggle=page.getByRole('switch',{name:'Sort by color instead of tier'});
  assert.equal(await toggle.locator('i').evaluate(el=>getComputedStyle(el,'::after').transitionDuration),'0.12s');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.ok(parseFloat(await toggle.locator('i').evaluate(el=>getComputedStyle(el,'::after').transitionDuration)) <= .00001);
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert.equal(await hash(),beforeDeck); await snap(page,'deck-cast-reference');
  page=await load('0601f17bbdab','hero_snorri',{pane:'choice'}); const beforeRunes=await hash();
  await owner(page,'[data-mobile-rune-batch]');
  await page.getByRole('button',{name:'Choose bird',exact:true}).click(); await page.getByRole('button',{name:'Choose axe',exact:true}).click(); await page.getByRole('button',{name:'Choose anvil',exact:true}).click();
  await board(page); await settle(page); await choice(page); await settle(page); assert.equal(await page.locator('[data-state="planned"]').count(),3);
  await page.locator('[data-mobile-region="card-focus"] [data-card-size="large"]').waitFor();
  assert.equal(await page.locator('[data-mobile-region="card-focus"] [data-card-size="large"]').count(),1);
  assert.equal(await hash(),beforeRunes); await snap(page,'runes-staged');
  page=await load(fixtureIds['snorri-confirmation'],'hero_snorri',{pane:'board'});
  await page.getByRole('status',{name:'Runes placed'}).waitFor(); await owner(page,'[aria-label="Runes placed"]'); await snap(page,'runes-acknowledged');
  }
  // Exact-source paired example after one local pick in each view.
  if(ref!=='live') {
    await load(fixtureIds['gydion-upgrades'],'hero_gydion',{pane:'choice'},'portrait',true);
    for(const win of desk.comparison.windows) { await win.page.getByRole('button',{name:/^Choose /}).first().click(); await win.page.locator('[data-staged-upgrade]').waitFor({state:'attached'}); await win.page.locator('[data-card-size="large"][data-upgrade-grant="true"]').waitFor(); await settle(win.page); }
    const views=await api('views'); assert.equal(views[0].state.hash,views[1].state.hash);
    await clean(); const capture=await api('capture',{indexes:[0,1]}); records.push({name:'gydion-pair',capture});
  }
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({ref,baseline:process.env.GOA2_LAB_MAIN_REF,fixtureIds,resumedFrom:resume,records},null,2));
  console.log('R5 evidence',out);
} catch(error) {
  const page=desk.comparison.windows.at(-1)?.page;
  if(page) {await page.screenshot({path:path.join(out,'failure.png')});await fs.writeFile(path.join(out,'failure.html'),await page.content());}
  await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({ref,error:String(error),records},null,2)); throw error;
} finally {await desk.close();}
