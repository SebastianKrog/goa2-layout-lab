import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { ROOT, PATCH, DATA } from "../src/config.mjs";
const { createServer, transformWithEsbuild } = await import(
  pathToFileURL(path.join(ROOT, "node_modules/vite/dist/node/index.js"))
);
const { build } = await import(
  pathToFileURL(path.join(ROOT, "node_modules/esbuild/lib/main.js"))
);
const referenceCss = await fs.readFile(
  path.join(PATCH, "src/styles.css"),
  "utf8",
);
const referenceBundle = await build({
  stdin: {
    contents:
      "import * as cards from './src/cards.js';import {updateCardRow} from './src/card-rows.js';import {spellTinyCard} from './src/spells.js';window.r2Reference={...cards,updateCardRow,spellTinyCard};",
    resolveDir: PATCH,
  },
  bundle: true,
  write: false,
  format: "iife",
  loader: { ".css": "text" },
  plugins: [
    {
      name: "renderer-only-reference",
      setup(b) {
        b.onLoad(
          { filter: /[\\/](?:runtime|ui|navigation|react|settings|deck)\.js$/ },
          (args) => {
            if (!args.path.startsWith(PATCH)) return;
            const name = path.basename(args.path);
            const stubs = {
              "runtime.js":
                "export const root=document.documentElement,ac=new AbortController(),uiState={};export const c=n=>'[class*=\"_'+n+'_\"]',q=(s,e=document)=>e.querySelector(s);",
              "ui.js":
                "export const detailsPanel=document.createElement('div');export const on=(el,type,fn)=>el.addEventListener(type,fn);export const addExtra=()=>{};",
              "navigation.js":
                "export const dismiss=()=>{},openNestedCard=()=>{};",
              "react.js": "export const componentProp=()=>null;",
              "settings.js":
                "export const handCardSize=()=>window.r2HandSize||'small';",
              "deck.js": "export const renderedCard=()=>null;",
            };
            return { contents: stubs[name], loader: "js" };
          },
        );
      },
    },
  ],
});
const sourceRef = process.argv.find((a) => a.startsWith("--ref="))?.slice(6);
const label = process.argv[2] || "before";
const output = path.join(DATA, "reviews", "mobile-r2-renderers", label);
await fs.mkdir(output, { recursive: true });
const moduleSource = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {card,game} from '/src/hooks/__fixtures__/gameController.ts';
import {MobileCardFace} from '/src/components/mobile/MobileCardFace.tsx';
import {MobileDeckMicro} from '/src/components/mobile/MobileDeckMicro.tsx';
import {MobileHistoryCard} from '/src/components/mobile/MobileHistoryCard.tsx';
import {MobileNanoCard} from '/src/components/mobile/MobileNanoCard.tsx';
import {MobilePresentationProvider} from '/src/components/mobile/MobilePresentationProvider.tsx';
import {ensurePrintSignsReady} from '/src/i18n/printSigns.ts';
const view=game(),hero=view.teams.RED.heroes[0];hero.id='hero_arien';hero.items={ATTACK:2,DEFENSE:1};
const base={...card('r2_fixture'),name:'Renderer fixture',secondary_actions:{MOVEMENT:2,DEFENSE:3},range_value:2,is_ranged:true};
const cards=[{...base,id:'art',name:'Artwork fixture',image_id:'Gold',effect_text:'Fixture rules.'},{...base,id:'missing_art',image_id:'r2_missing',effect_text:'Fixture rules.'},{...base,id:'vantage_point',name:'Vantage Point',color:'BLUE'},{...base,id:'silver',color:'SILVER',tier:'UNTIERED'},{...base,id:'basic',color:'GOLD',tier:'UNTIERED'},...['RED','BLUE','GREEN'].flatMap(color=>['I','II','III'].map(tier=>({...base,id:color+tier,color,tier}))),{...base,id:'ultimate',name:'Ultimate',color:'PURPLE',tier:'IV',primary_action:'SKILL',primary_action_value:null,secondary_actions:{},range_value:null,is_ranged:false,initiative:0}, {...base,id:'skill_defense',primary_action:'DEFENSE_SKILL',primary_action_value:0}, {...base,id:'masked',name:'Private hidden identity',is_facedown:true}, ...[1,3,4].map(rank=>({...base,id:'spell'+rank,name:'Spell fixture',spell_rank:rank,state:'SPELLBOOK'}))];
hero.hand=cards;
const specs=cards.flatMap(c=>(['art','missing_art'].includes(c.id)?['small','tiny','large']:c.spell_rank!=null?['tiny','large']:['small','tiny','mini','micro','board','extended','nano',...(c.id==='basic'?['large']:[])]).map(size=>({card:c,size,key:c.id+'-'+size})));
if(${JSON.stringify(process.argv.includes("--diagnose"))})specs.splice(0,specs.length,...specs.filter(s=>['basic-small','basic-tiny','basic-mini','basic-large','spell3-large','spell1-large','spell4-large','ultimate-extended','REDII-extended','skill_defense-board','skill_defense-micro','skill_defense-nano'].includes(s.key)));window.fixtureSpecs=specs.map(s=>({key:s.key,size:s.size,card:s.card}));
const reference=new URLSearchParams(location.search).has('reference');
if(reference){
 document.documentElement.dataset.m2Active='';
 await import('/r2-reference.js');document.getElementById('goa2-m2-style')?.remove();document.documentElement.classList.add('r2-reference');const sheet=document.createElement('style');sheet.textContent=${JSON.stringify(referenceCss.replaceAll("&", "html.r2-reference"))};document.head.append(sheet);const ref=window.r2Reference,rows=ref;
 for(const spec of specs){const host=document.createElement('section');host.dataset.fixture=spec.key;host.style.width='356px';host.style.minHeight='24px';host.style.height=spec.size==='large'?'220px':(['small','tiny','mini'].includes(spec.size)?(spec.size==='small'?'42px':spec.size==='tiny'?'28px':'24px'):'24px');host.style.marginBottom='12px';if(['small','tiny'].includes(spec.size))host.setAttribute('data-m2','hand-list');if(['mini','large'].includes(spec.size)){host.id='goa2-m2-hero-display';host.style.setProperty('display','block','important');host.style.position='static';host.style.inset='auto';host.style.padding='0';host.style.border='0';host.style.background='transparent';}document.body.append(host);let el;
 if(['micro','board'].includes(spec.size))el=ref.miniatureCard(spec.card,hero.items,spec.size==='micro');
 else if(spec.size==='extended')el=ref.extendedMicroCard(spec.card,'ATTACK');
 else if(spec.size==='nano')el=spec.card.id==='ultimate'?ref.ultimateIndicator({level:1}):ref.nanoCard(spec.card,hero.items);
 else if(spec.size==='large')el=ref.textCard(spec.card,'deck',null,'hero_arien','ATTACK');
 else if(spec.card.spell_rank!=null)el=ref.spellTinyCard(spec.card);else {el=document.createElement('div');el.style.height='100%';host.append(el);window.r2HandSize=spec.size==='tiny'?'tiny':'small';rows.updateCardRow(el,spec.card,hero.items,spec.size==='small'?'small':'mini');if(spec.card.image_id)ref.appendCardArtwork(el.querySelector('.m2-list-band'),spec.card,null,'hero_arien');}
 host.append(el);}
}else{
 createRoot(document.getElementById('root')).render(<MobilePresentationProvider view={view} myHeroId={hero.id} gameId='renderer-fixtures' request={null} inspect={()=>{}}>{specs.map(s=><section data-fixture={s.key} key={s.key} style={{width:356,marginBottom:12,height:s.size==='large'?220:s.size==='small'?42:s.size==='tiny'?28:24}}>{s.size==='extended'?<MobileDeckMicro card={s.card} grant='ATTACK'/>:s.size==='nano'?<MobileNanoCard card={s.card} hero={hero}/>:['micro','board'].includes(s.size)?<MobileHistoryCard card={s.card} hero={hero} compact={s.size==='board'}/>:<MobileCardFace card={s.card} hero={hero} renderContext={s.size==='large'?'deck':'gameplay'} grant={s.size==='large'?'ATTACK':undefined} known={s.card.id==='masked'?false:undefined} size={s.size} artwork={s.card.spell_rank==null&&(s.size==='tiny'||!!s.card.image_id)}/>}</section>)}</MobilePresentationProvider>);
}
window.renderMotion=async()=>{
 const {MobileCardInteraction}=await import('/src/components/mobile/MobileCardInteraction.tsx');const {MobileCardDot}=await import('/src/components/mobile/MobileCardDot.tsx');
 document.querySelectorAll('[data-fixture]').forEach(el=>el.remove());const host=document.createElement('section');host.dataset.r2Motion='';host.style.cssText='display:flex;align-items:center;gap:24px;padding:16px;width:350px;background:#101722';document.body.append(host);window.motionEvents={inspect:0,stage:0};
 createRoot(host).render(<><MobileCardInteraction card={base} inspected aria-pressed={false} aria-label='Read fixture' style={{width:64}} onInspect={()=>window.motionEvents.inspect++} onStage={()=>window.motionEvents.stage++}><MobileHistoryCard card={base} hero={hero} active/></MobileCardInteraction><MobileNanoCard card={{...base,tier:'IV',color:'PURPLE'}} hero={hero} available/><MobileCardDot color='RED' active/><MobileNanoCard card={{...base,name:'SECRET',is_facedown:true,is_active:true}} hero={hero} available active/></>);
};
await ensurePrintSignsReady();window.fixtureReady=true;
`;
const server = await createServer({
  root: ROOT,
  configFile: false,
  esbuild: { jsx: "automatic" },
  plugins: [
    {
      name: "r2-reference-css",
      enforce: "pre",
      transform(code, id) {
        if (
          id
            .replaceAll("\\", "/")
            .endsWith("/goa2-mobile-2d-patch/src/runtime.js")
        )
          return code.replace("'./styles.css'", "'./styles.css?inline'");
      },
    },
    {
      name: "r2-renderer-fixture",
      resolveId(id) {
        if (id.startsWith(ROOT.replaceAll("\\", "/") + "/src/")) return id;
        if (id === "/r2-reference.js") return "\0r2-reference.js";
        if (id === "/r2-fixture.tsx") return "\0r2-fixture.tsx";
      },
      async load(id) {
        if (
          sourceRef &&
          id
            .replaceAll("\\", "/")
            .startsWith(ROOT.replaceAll("\\", "/") + "/src/")
        )
          return execFileSync(
            "git",
            [
              "show",
              sourceRef + ":" + path.relative(ROOT, id).replaceAll("\\", "/"),
            ],
            { cwd: ROOT, encoding: "utf8", windowsHide: true },
          );
        if (id === "\0r2-reference.js")
          return referenceBundle.outputFiles[0].text;
        if (id === "\0r2-fixture.tsx")
          return (
            await transformWithEsbuild(moduleSource, "r2-fixture.tsx", {
              loader: "tsx",
              jsx: "automatic",
            })
          ).code;
      },
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (!req.url.startsWith("/r2-fixtures")) return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            '<html><head><style>body{margin:12px;background:#101722;color:#e1e5eb;font:13px system-ui}section{display:block}#root{display:contents}</style></head><body><div id="root"></div><script type="module" src="/@vite/client"></script><script type="module" src="/r2-fixture.tsx"></script></body></html>',
          );
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 6345,
    strictPort: true,
    fs: { allow: [ROOT, PATCH] },
  },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 420, height: 900 },
    deviceScaleFactor: Number(
      process.argv.find((a) => a.startsWith("--dpr="))?.slice(6) || 1,
    ),
  });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("PAGE", e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.error(m.text());
  });
  for (const reference of process.argv.includes("--reference-only")
    ? [true]
    : process.argv.includes("--native-only") ||
        process.argv.includes("--motion")
      ? [false]
      : [false, true]) {
    await page.goto(
      "http://127.0.0.1:6345/r2-fixtures" + (reference ? "?reference=1" : ""),
    );
    await page.waitForFunction(
      () => window.fixtureReady,
      {},
      { timeout: 30000 },
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map((i) => i.decode().catch(() => {})),
      );
    });
    if (process.argv.includes("--motion")) {
      await page.evaluate(() => window.renderMotion());
      await page
        .locator("[data-r2-motion] [data-card-active]")
        .first()
        .waitFor();
      const describe = () =>
        page.locator("[data-r2-motion]").evaluate((root) => ({
          events: window.motionEvents,
          elements: [
            ...root.querySelectorAll(
              "[data-card-active],[data-card-available],[data-hidden],[data-card-interaction]",
            ),
          ].map((el) => {
            const cs = getComputedStyle(el),
              pseudo = getComputedStyle(el, "::after");
            return {
              variant: el.getAttribute("data-card-variant"),
              active: el.hasAttribute("data-card-active"),
              hidden: el.hasAttribute("data-hidden"),
              available: el.getAttribute("data-card-available"),
              animation: cs.animationName,
              duration: cs.animationDuration,
              shadow: cs.boxShadow,
              sheenAnimation: pseudo.animationName,
              sheenDuration: pseudo.animationDuration,
              sheen: pseudo.backgroundImage,
            };
          }),
        }));
      const animated = await describe();
      await page.evaluate(() => {
        for (const a of document.getAnimations()) {
          a.pause();
          a.currentTime = Number(a.effect.getTiming().duration) / 2;
        }
      });
      await page
        .locator("[data-r2-motion]")
        .screenshot({ path: path.join(output, "motion-peak.png") });
      await page.getByRole("button", { name: "Read fixture" }).focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Space");
      await page.emulateMedia({ reducedMotion: "reduce" });
      const reduced = await describe();
      await page
        .locator("[data-r2-motion]")
        .screenshot({ path: path.join(output, "reduced-motion.png") });
      if (reduced.events.inspect !== 2 || reduced.events.stage !== 2)
        throw Error("Keyboard activation failed");
      if (reduced.elements.some((e) => e.active && e.animation !== "none"))
        throw Error("Reduced motion still animates");
      if (
        reduced.elements
          .filter((e) => e.active)
          .some((e) => e.shadow === "none")
      )
        throw Error("Reduced motion lost glow");
      if (
        reduced.elements.some(
          (e) =>
            e.hidden &&
            (e.active || e.available === "true" || e.animation !== "none"),
        )
      )
        throw Error("Hidden state leaked");
      await fs.writeFile(
        path.join(output, "motion.json"),
        JSON.stringify({ animated, reduced, errors }, null, 2),
      );
      console.log("Motion and keyboard assertions passed");
      continue;
    }
    if (false)
      console.log(
        await page.evaluate(() => ({
          attrs: document.documentElement.outerHTML.slice(0, 200),
          sheets: [...document.styleSheets].map((s) => ({
            rules: s.cssRules.length,
            first: s.cssRules[0]?.cssText.slice(0, 100),
          })),
          styles: [...document.querySelectorAll("style")].map((s) =>
            s.textContent.slice(0, 100),
          ),
        })),
      );
    const metadata = await page.locator("[data-fixture]").evaluateAll((els) =>
      els.map((el) => {
        const card = el.firstElementChild,
          r = card.getBoundingClientRect(),
          s = getComputedStyle(card);
        return {
          key: el.dataset.fixture,
          width: r.width,
          height: r.height,
          html: card.outerHTML,
          elements: [...card.querySelectorAll("img,b,.m2-symbol-value")].map(
            (c) => {
              const r = c.getBoundingClientRect(),
                cs = getComputedStyle(c),
                pr = card.getBoundingClientRect();
              return {
                tag: c.tagName,
                text: c.textContent,
                src: c.getAttribute("src"),
                x: r.x - pr.x,
                y: r.y - pr.y,
                w: r.width,
                h: r.height,
                font: cs.font,
                color: cs.color,
                filter: cs.filter,
                shadow: cs.textShadow,
              };
            },
          ),
          font: s.font,
          border: s.border,
          padding: s.padding,
        };
      }),
    );
    if (!reference && !sourceRef) {
      const checks = await page.locator('[data-fixture]').evaluateAll(els => els.flatMap(host => {
        const card = host.firstElementChild, css = getComputedStyle(card), key = host.dataset.fixture;
        if (/-(small|tiny|mini)$/.test(key) && css.borderTopWidth !== '1px') throw Error(key + ': missing standard card frame');
        const caps = [...card.querySelectorAll('[class*="microCap"]')];
        for (const cap of caps) {
          if (getComputedStyle(cap, '::before').borderTopColor !== 'rgb(82, 96, 118)') throw Error(key + ': colored cap border');
        }
        if (!['ultimate-nano', 'masked-nano'].includes(key)) return [];
        const label = card.firstElementChild, a = card.getBoundingClientRect(), b = label.getBoundingClientRect();
        const dx = (b.left+b.right-a.left-a.right)/2, dy = (b.top+b.bottom-a.top-a.bottom)/2;
        if (Math.abs(dx) > .1 || Math.abs(dy) > .1) throw Error(key + ': label is off-center');
        return [{key, dx, dy, border: css.border}];
      }));
      await fs.writeFile(path.join(output, 'border-and-label-checks.json'), JSON.stringify(checks, null, 2));
    }
    for (const entry of metadata) {
      await page.locator("[data-fixture]").evaluateAll((els, key) => {
        for (const el of els)
          el.style.setProperty(
            "display",
            el.dataset.fixture === key ? "block" : "none",
            "important",
          );
      }, entry.key);
      entry.captureElements = await page
        .locator('[data-fixture="' + entry.key + '"] > :first-child')
        .evaluate((root) => ({
          rect: root.getBoundingClientRect().toJSON(),
          nodes: [...root.querySelectorAll("img,b,.m2-symbol-value")]
            .slice(0, 2)
            .map((el) => {
              const r = el.getBoundingClientRect(),
                s = getComputedStyle(el);
              return {
                rect: r.toJSON(),
                font: s.font,
                z: s.zIndex,
                filter: s.filter,
                color: s.color,
                transform: s.transform,
                parent: el.parentElement.outerHTML,
              };
            }),
        }));
      await page
        .locator('[data-fixture="' + entry.key + '"] > :first-child')
        .screenshot({
          path: path.join(
            output,
            (reference ? "reference-" : "native-") + entry.key + ".png",
          ),
          animations: "disabled",
        });
    }
    await fs.writeFile(
      path.join(output, (reference ? "reference" : "native") + ".json"),
      JSON.stringify(
        {
          viewport: { width: 420, height: 900 },
          dpr: Number(
            process.argv.find((a) => a.startsWith("--dpr="))?.slice(6) || 1,
          ),
          locale: "en",
          fontScale: 1,
          errors,
          metadata,
        },
        null,
        2,
      ),
    );
  }
  console.log(JSON.stringify({ output, errors }));
  if (errors.length) throw Error(errors.join("\n"));
} finally {
  await browser.close();
  await server.close();
}
