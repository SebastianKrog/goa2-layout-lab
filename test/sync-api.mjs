// Focused Windows broker checks; no frontend source preparation required.
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { startDesk } from "../desk.mjs";
import { PORTS } from "../config.mjs";
const desk = await startDesk({
  flags: new Set([
    "--verification",
    "--no-auto-load",
    "--headless",
    "--no-open",
  ]),
});
const api = desk.comparison.api,
  sockets = [];
try {
  const situation = await api("/starter", {
      name: "Synchronization guard acceptance",
    }),
    clones = [];
  for (let i = 0; i < 3; i++)
    clones.push(await api("/clone", { situation_id: situation.id }));
  const ids = clones.map((c) => c.game_id),
    hashes = async () =>
      Promise.all(
        ids.map(
          async (id) => (await api("/games/" + id, undefined, "GET")).hash,
        ),
      );
  const call = (message) =>
    api("/synchronize", {
      games: ids,
      source: ids[0],
      actor: "hero_arien",
      message,
    });
  let before = await hashes();
  await assert.rejects(
    call({ type: "SUBMIT_INPUT", request_id: "stale-id", selection: null }),
    /source input prompt changed/,
  );
  assert.deepEqual(await hashes(), before);
  console.log("PASS: stale source input rejected before any mutation");
  for (let i = 0; i < 3; i++) {
    const actor = i === 1 ? "hero_hanu" : "hero_arien";
    const ws = new WebSocket(
      "ws://127.0.0.1:" +
        PORTS.backend +
        "/games/" +
        ids[i] +
        "/ws?token=" +
        clones[i].seats[actor],
    );
    sockets.push(ws);
    await new Promise((resolve, reject) => {
      ws.once("error", reject);
      ws.once("message", resolve);
    });
  }
  await assert.rejects(
    call({ type: "PROPOSE_OVERRIDE", family: "rewind", to: 0 }),
    /matching connected-player viewpoints/,
  );
  assert.deepEqual(await hashes(), before);
  console.log(
    "PASS: incompatible consensus viewpoints rejected before any mutation",
  );
  await call({ type: "CHEATS_GOLD", hero_id: "hero_arien", amount: 1 });
  let after = await hashes();
  assert.equal(new Set(after).size, 1);
  assert.notEqual(after[0], before[0]);
  console.log("PASS: guard changes retain successful game-action fanout");
  await assert.rejects(call({ type: "UNSUPPORTED" }), /Unsupported/);
  assert.deepEqual(await hashes(), after);
  console.log("PASS: unsupported commands rejected before any mutation");
} finally {
  for (const ws of sockets) ws.close();
  await desk.close();
}
