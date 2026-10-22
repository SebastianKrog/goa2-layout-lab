// Real Chromium test of the embedded display and input, without game services.
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { ViewStreams } from "../src/streams.mjs";
import { PROFILES, TOOL, DATA } from "../src/config.mjs";
import { waitFor, delay } from "../src/services.mjs";
import path from "node:path";
const browser = await chromium.launch({ headless: true });
const windows = [];
const server = http.createServer();
const comparison = {
  window: (i) => {
    if (!windows[i]) throw Error("Unknown view");
    return windows[i];
  },
};
const streams = new ViewStreams(server, comparison, () => false);
server.on("request", async (req, res) => {
  if (req.url === "/status") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        windows.map((w) => ({
          gameId: w.clone.game_id,
          config: w.config,
          viewport: PROFILES[w.config.profile].viewport,
        })),
      ),
    );
    return;
  }
  if (req.url === "/live.mjs") {
    res.setHeader("content-type", "text/javascript");
    res.end(await fs.readFile(path.join(TOOL, "public/live.mjs")));
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(
    `<style>body{margin:0}#views{display:flex;gap:8px}.live-stage{position:relative;display:flex;align-items:center;justify-content:center;width:440px;height:800px;background:#222;overflow:hidden}.live-stage canvas{touch-action:none;flex-shrink:0}.stream-status{position:absolute;color:white;top:0}</style><button id="outside">Outside view</button><div id="views"></div><script type="module">import {LiveView} from '/live.mjs';window.live=[];const status=await(await fetch('/status')).json();for(let i=0;i<status.length;i++){const l=new LiveView(i,status[i],status[i].viewport);window.live.push(l);document.querySelector('#views').append(l.host);}</script>`,
  );
});
let control;
try {
  for (let i = 0; i < 3; i++) {
    const profile = i === 1 ? "desktop" : "portrait",
      context = await browser.newContext(PROFILES[profile]),
      page = await context.newPage();
    await page.setContent(
      `<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:${["#514a37", "#344f43", "#383a54"][i]};height:2200px}button{position:absolute;left:20px;top:20px;width:120px;height:44px}input{position:absolute;left:20px;top:90px;width:160px;height:36px}</style><button>Press ${i}</button><input><script>window.events=[];window.clicks=0;document.querySelector('button').onclick=()=>{window.clicks++;document.body.style.background='#ac713e'};for(const type of ['touchstart','touchmove','touchend','pointerdown','pointermove','pointerup','keydown','keyup','wheel'])document.addEventListener(type,e=>events.push({type,key:e.key,touches:e.touches?.length,buttons:e.buttons}));</script>`,
    );
    windows.push({
      context,
      page,
      clone: { game_id: "input-" + i },
      config: {
        profile,
        source: i === 0 ? "base" : i === 1 ? "comparator" : "target",
      },
    });
  }
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  control = await browser.newContext({
    viewport: { width: 1400, height: 950 },
    hasTouch: true,
  });
  const desk = await control.newPage(),
    errors = [];
  desk.on("pageerror", (e) => errors.push(e.message));
  await desk.goto(`http://127.0.0.1:${port}`);
  await desk.waitForFunction(
    () => window.live?.length === 3 && live.every((v) => v.frames > 0),
  );
  console.log("PASS: three simultaneous embedded views");
  const locate = async (index, x, y) => {
    const b = await desk.locator("canvas").nth(index).boundingBox(),
      vp = PROFILES[windows[index].config.profile].viewport;
    return {
      x: b.x + (x * b.width) / vp.width,
      y: b.y + (y * b.height) / vp.height,
    };
  };
  const click = async (i, x, y) => {
    const p = await locate(i, x, y);
    await desk.mouse.click(p.x, p.y);
  };
  await click(0, 60, 40);
  await waitFor(
    () => windows[0].page.evaluate(() => clicks === 1),
    "phone tap",
  );
  assert.equal(await windows[1].page.evaluate(() => clicks), 0);
  assert.equal(await windows[2].page.evaluate(() => clicks), 0);
  assert.ok(
    await windows[0].page.evaluate(() =>
      events.some((e) => e.type === "touchstart"),
    ),
  );
  await click(1, 60, 40);
  await waitFor(
    () => windows[1].page.evaluate(() => clicks === 1),
    "desktop click",
  );
  const touchSession = await control.newCDPSession(desk),
    t1 = await locate(0, 140, 220),
    t2 = await locate(0, 230, 220);
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 1, ...t1 },
      { id: 2, ...t2 },
    ],
  });
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 1, x: t1.x - 10, y: t1.y },
      { id: 2, x: t2.x + 10, y: t2.y },
    ],
  });
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await waitFor(
    () =>
      windows[0].page.evaluate(() =>
        events.some((e) => e.type === "touchstart" && e.touches === 2),
      ),
    "two-finger gesture",
  );
  await touchSession.detach();
  console.log(
    "PASS: scaled phone touch, two-finger gestures and desktop click remain independent",
  );
  await click(1, 70, 105);
  await desk.keyboard.type("hello");
  await waitFor(
    () =>
      windows[1].page
        .locator("input")
        .inputValue()
        .then((v) => v === "hello"),
    "keyboard input",
  );
  await desk
    .locator("canvas")
    .nth(1)
    .evaluate((c) => {
      const data = new DataTransfer();
      data.setData("text/plain", " pasted");
      c.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data }));
    });
  await waitFor(
    () =>
      windows[1].page
        .locator("input")
        .inputValue()
        .then((v) => v === "hello pasted"),
    "paste",
  );
  await desk.keyboard.down("Alt");
  await desk.locator("#outside").focus();
  await waitFor(
    () =>
      windows[1].page.evaluate(() =>
        events.some((e) => e.type === "keyup" && e.key === "Alt"),
      ),
    "release on blur",
  );
  await desk.keyboard.up("Alt");
  const p = await locate(1, 400, 500);
  await desk.mouse.move(p.x, p.y);
  await desk.mouse.wheel(0, 300);
  await waitFor(
    () => windows[1].page.evaluate(() => scrollY > 0),
    "scroll wheel",
  );
  await desk.mouse.move(p.x, p.y);
  await desk.mouse.down({ button: "right" });
  await desk.mouse.move(p.x + 40, p.y + 30, { steps: 4 });
  await desk.mouse.up({ button: "right" });
  assert.ok(
    await windows[1].page.evaluate(() =>
      events.some((e) => e.type === "pointermove" && e.buttons === 2),
    ),
  );
  console.log(
    "PASS: typing, paste, modifier release, wheel and right-button drag",
  );
  const before = await desk.evaluate(() => live.map((v) => v.frames));
  for (const w of windows)
    await w.page.evaluate(() => (document.body.style.background = "#983d7a"));
  await desk.waitForFunction(
    (before) => live.every((v, i) => v.frames > before[i]),
    before,
  );
  const frames = await desk.evaluate(() => live[0].frames);
  await desk.evaluate(() => live[0].ws.close());
  await windows[0].page.evaluate(
    () => (document.body.style.background = "#2c6688"),
  );
  await desk.waitForFunction((n) => live[0].frames > n, frames);
  await desk.waitForFunction(() => {
    const d = live[0].canvas.getContext("2d").getImageData(350, 700, 1, 1).data;
    return (
      Math.abs(d[0] - 44) < 5 &&
      Math.abs(d[1] - 102) < 5 &&
      Math.abs(d[2] - 136) < 5
    );
  });
  await streams.pause();
  const pausedFrames = await desk.evaluate(() => live.map((v) => v.frames));
  await delay(200);
  assert.deepEqual(
    await desk.evaluate(() => live.map((v) => v.frames)),
    pausedFrames,
  );
  await streams.resume();
  for (const w of windows)
    await w.page.evaluate(() => (document.body.style.background = "#416549"));
  await desk.waitForFunction(
    (before) => live.every((v, i) => v.frames > before[i]),
    pausedFrames,
  );
  assert.deepEqual(errors, []);
  await fs.mkdir(DATA, { recursive: true });
  await desk.screenshot({ path: path.join(DATA, "stream-input-test.png") });
  console.log(
    "PASS: all views update, reconnect and resume; no browser errors",
  );
} finally {
  await control?.close();
  await streams.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
