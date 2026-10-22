// Native compositor, device emulation, input and capture smoke test (needs a display).
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { NativeDesktop } from "../desktop/driver.mjs";
import { DATA, TOOL, PROFILES } from "../src/config.mjs";
import { delay, waitFor } from "../src/services.mjs";
const desktop = new NativeDesktop(),
  contexts = [],
  pages = [];
const server = http.createServer(async (req, res) => {
  if (req.url === "/native.mjs") {
    res.setHeader("content-type", "text/javascript");
    res.end(await fs.readFile(path.join(TOOL, "public/native.mjs")));
    return;
  }
  if (req.url === "/meta") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        contexts.map((c, i) => ({
          nativeId: c.nativeId,
          config: { source: "view " + i },
          viewport: PROFILES.portrait.viewport,
        })),
      ),
    );
    return;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (req.url.startsWith("/guest")) {
    res.end(
      `<meta name="viewport" content="width=device-width"><style>body{margin:0;background:#345746;height:1800px}button{position:absolute;left:200px;top:100px;width:100px;height:50px}input{position:absolute;left:20px;top:180px}#anim{position:absolute;top:300px;width:30px;height:30px;background:orange}</style><button>Click</button><input><div id="anim"></div><script>window.frames=0;window.clicked=0;function tick(){frames++;document.querySelector('#anim').style.left=(frames%250)+'px';requestAnimationFrame(tick)}tick();document.querySelector('button').onclick=()=>clicked++;</script>`,
    );
    return;
  }
  res.end(
    `<style>body{margin:0}.slots{display:flex;gap:10px}.live-stage{position:relative;width:390px;height:700px;background:#222;overflow:hidden}.actual-size{overflow:auto;display:block}</style><h1>Native views test</h1><div class="slots"></div><script type="module">import {NativeView} from '/native.mjs';window.v=[];const meta=await(await fetch('/meta')).json();for(let i=0;i<meta.length;i++){const view=new NativeView(i,meta[i],meta[i].viewport);v.push(view);document.querySelector('.slots').append(view.host);}</script>`,
  );
});
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await desktop.launch();
  for (let i = 0; i < 3; i++) {
    const c = await desktop.newContext(PROFILES.portrait);
    contexts.push(c);
    const p = await c.newPage();
    pages.push(p);
    assert.ok(
      await desktop.app.evaluate(() => {
        lab.layout([]);
        return [...lab.views.values()].every(
          (v) => v.lastLayout || v.host.getVisible(),
        );
      }),
      "Pending views stay parked during root layout updates",
    );
    await p.goto(origin + "/guest?i=" + i);
    await p.evaluate((i) => localStorage.setItem("isolation", String(i)), i);
  }
  assert.ok(
    await pages[0].evaluate(
      () => !!document.createElement("canvas").getContext("webgl2"),
    ),
    "Native WebGL2 is available (hardware or software fallback)",
  );
  await desktop.open(origin, true);
  await desktop.root.waitForSelector("[data-native-id]");
  await waitFor(
    () =>
      desktop.app.evaluate(() =>
        [...lab.views.values()].every(
          (v) => v.lastLayout && v.host.getVisible(),
        ),
      ),
    "native view placement",
  );
  assert.deepEqual(
    await Promise.all(
      pages.map((p) => p.evaluate(() => localStorage.getItem("isolation"))),
    ),
    ["0", "1", "2"],
  );
  const metrics = await Promise.all(
    pages.map((p) =>
      p.evaluate(() => ({
        w: innerWidth,
        h: innerHeight,
        t: navigator.maxTouchPoints,
      })),
    ),
  );
  console.log("Native device metrics: " + JSON.stringify(metrics));
  assert.ok(
    metrics.every((v) => v.w === 390 && v.h === 844 && v.t > 0),
    JSON.stringify(metrics),
  );
  const before = await Promise.all(pages.map((p) => p.evaluate(() => frames)));
  await delay(1000);
  const fps = await Promise.all(
    pages.map(async (p, i) => (await p.evaluate(() => frames)) - before[i]),
  );
  assert.ok(
    fps.every((n) => n >= 20),
    JSON.stringify(fps),
  );
  console.log("Native animation frames per second: " + JSON.stringify(fps));
  await desktop.app.evaluate((_, id) => {
    const item = lab.views.get(id),
      w = item.view.webContents;
    lab.root.focus();
    w.focus();
    for (const type of ["mouseDown", "mouseUp"])
      w.sendInputEvent({
        type,
        x: Math.round(250 * item.scale),
        y: Math.round(125 * item.scale),
        button: "left",
        clickCount: 1,
      });
  }, contexts[1].nativeId);
  await waitFor(
    () => pages[1].evaluate(() => clicked === 1),
    "native click",
    8000,
  );
  assert.equal(await pages[0].evaluate(() => clicked), 0);
  assert.equal(await pages[2].evaluate(() => clicked), 0);
  const images = await Promise.all(
    pages.map(async (p) => {
      await p.screenshot({
        animations: "disabled",
        caret: "hide",
        timeout: 15000,
      });
      return p.screenshot({
        animations: "disabled",
        caret: "hide",
        timeout: 15000,
      });
    }),
  );
  assert.ok(
    images.every((b) => {
      const p = PNG.sync.read(b);
      return p.width === 390 && p.height === 844;
    }),
  );
  await fs.writeFile(path.join(DATA, "native-view-capture.png"), images[1]);
  await desktop.root.evaluate(() => v[1].zoom(false));
  await delay(100);
  assert.equal(await pages[1].evaluate(() => innerWidth), 390);
  await desktop.root.evaluate(() => {
    v[1].host.scrollTop = 144;
    v[1].resize();
  });
  await delay(100);
  const position = await desktop.app.evaluate(
    (_, id) => lab.views.get(id).view.getBounds(),
    contexts[1].nativeId,
  );
  assert.equal(position.y, -144);
  await desktop.root.evaluate(() => v[1].zoom(true));
  const evidence = {
    verifiedAt: new Date().toISOString(),
    platform: process.platform,
    fps,
    nativeViews: 3,
    independentStorage: true,
    phoneViewport: { width: 390, height: 844 },
    nativeInput: true,
    originalSizeCaptures: true,
  };
  await fs.writeFile(
    path.join(DATA, "native-view-test.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    "PASS: three native views, isolated storage, phone emulation, native input, animation, 100% scrolling and full-size captures",
  );
} finally {
  await desktop.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
