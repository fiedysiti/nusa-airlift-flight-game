// Full-mission autopilot for Nusa Airlift (Node 22, test harness only —
// NOT part of the shipped game). Drives the real game through real
// keyboard input in headless Chromium (SwiftShader), exactly like a
// player: takeoff, all 8 rings, cargo leg to Pulau Karang (east/sea
// approach), taxi-turn, return leg to Nusa Besar, graded landing.
// Usage: node tools/autopilot.mjs   (writes tools/autopilot-log.json)
// Exit 0 = mission complete; 1 = crash / abort / timeout.
import { createRequire } from 'node:module';
const require = createRequire('/home/hatch/workspace/tools/browser/node_modules/playwright-core/package.json');
const { chromium } = require('playwright-core');
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wrap = (a) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
const dist2d = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

const WALL_LIMIT_MS = 40 * 60 * 1000; // SwiftShader is slow and shares the
// VM's 1.5 CPUs with the Tacoma final render — allow a long wall budget.
const POLL_MS = 120;
const log = [];
const t0wall = Date.now();
const stamp = () => `+${((Date.now() - t0wall) / 1000).toFixed(0)}s wall`;
function say(msg) { const line = `${stamp()} ${msg}`; log.push(line); console.log(line); }

function serve() {
  return spawn(`${process.env.HOME}/workspace/tools/node22/bin/node`, ['serve.ts', '--port', '8901'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const server = serve();
await sleep(1500);
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 320, height: 180 } }); // tiny viewport: SwiftShader rasterises few pixels, higher fps; the autopilot flies by numbers, not by sight
const page = await context.newPage();
const errors = [];
const external = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('request', (r) => {
  const url = r.url();
  if (!url.startsWith('http://127.0.0.1:8901/') && !url.startsWith('data:')) external.push(url);
});
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));

async function state() {
  // Bounded evaluate: if the renderer dies, fail loudly instead of hanging
  // the loop forever with no heartbeat.
  return page.evaluate(() => {
    const g = window.__game;
    return {
      state: g.state, score: g.score, ring: g.ring, speed: g.speed,
      altitude: g.altitude, fuel: g.fuel, crashed: g.crashed, simTime: g.simTime,
      x: g.x, y: g.y, z: g.z, heading: g.heading, pitch: g.pitch, roll: g.roll,
      throttle: g.throttle, onGround: g.onGround, verticalSpeed: g.verticalSpeed,
      stalled: g.stalled, flaps: g.flaps, phase: g.phase, legsDone: g.legsDone,
      message: g.message, nextRingPos: g.nextRingPos, targetRunway: g.targetRunway,
    };
  }, undefined, { timeout: 20000 });
}

const down = new Set();
async function setKeys(wanted) {
  for (const k of [...down]) {
    if (!wanted.has(k)) { await page.keyboard.up(k); down.delete(k); }
  }
  for (const k of wanted) {
    if (!down.has(k)) { await page.keyboard.down(k); down.add(k); }
  }
}

let flapsOn = false;
async function setFlaps(on) {
  if (on === flapsOn) return;
  await page.keyboard.press('F');
  flapsOn = on;
  say(`flaps ${on ? 'ON' : 'OFF'}`);
}

let tickN = 0;
// One control tick. tgt: {hx, hz, alt, throttle, heading?, steer?}.
// Pitch is driven by a pulse controller: the keyboard only offers full
// deflection (+/-0.32 rad -> vertical speed up to +/-11 m/s), far too coarse
// for a gentle landing (|vs| < 3.2 m/s), so the key is pulsed one tick at a
// time toward a computed target pitch instead of being held. Returns the
// heading error (rad) for the caller.
function control(s, tgt) {
  tickN += 1;
  const keys = new Set();
  if (s.throttle < tgt.throttle - 0.03) keys.add('Shift');
  else if (s.throttle > tgt.throttle + 0.03) keys.add('Control');
  const stalling = !s.onGround && s.speed < 27.5; // just above the 26 m/s stall
  // (rotation happens at ~29 m/s — the guard must not fire on rotate)
  if (stalling) {
    keys.delete('Control');
    keys.add('Shift');
    keys.add('ArrowDown');
  } else if (!s.onGround || tgt.alt > s.altitude + 2) {
    // Target vertical speed from the altitude error, plus an optional
    // feedforward (the descent rate of a glide profile) so the aircraft
    // tracks a slope instead of lagging above it; then the pitch that
    // produces it; pulse the key toward that pitch.
    // Near the ground (capVs), never command a sink rate steeper than
    // -2.7 m/s: the touchdown judgement allows 3.2, and the pitch pulse
    // adds ripple on top of the command.
    let vsDes = Math.max(-6, Math.min(12, (tgt.alt - s.altitude) * 0.3 + (tgt.vsFeed ?? 0)));
    if (tgt.capVs && s.altitude < 40) vsDes = Math.max(vsDes, -2.7);
    const pitchDes = Math.max(-0.25, Math.min(0.25,
      Math.asin(Math.max(-0.9, Math.min(0.9, vsDes / Math.max(s.speed, 20))))));
    if (s.pitch < pitchDes - 0.015) keys.add('ArrowUp');
    else if (s.pitch > pitchDes + 0.015) keys.add('ArrowDown');
  }
  let desired;
  if (tgt.heading !== undefined) desired = tgt.heading;
  else desired = Math.atan2(tgt.hx - s.x, -(tgt.hz - s.z));
  const err = wrap(desired - s.heading);
  const steer = tgt.steer === undefined ? !s.onGround : tgt.steer;
  // Wider roll deadband near the ground: a bank over 0.3 rad at touchdown
  // is a crash, so close to the strip only correct large heading errors.
  const rollDb = tgt.rollDeadband ?? 0.10;
  if (steer) {
    if (err > rollDb) keys.add('ArrowRight');
    else if (err < -rollDb) keys.add('ArrowLeft');
  }
  return { keys, err };
}

let lastStatus = 0;
let outcome = 'aborted';
let mode = 'takeoff';
let lastRing = 0;
let lastLegs = 0;
let lastScore = 0;
let lastProgress = Date.now();
let lastAlt = 0;
let retriesKarang = 0;
let retriesNusa = 0;
let braking = false; // retakeoff: brake to a stop ONCE after a wrong landing,
// then never brake again — or the takeoff roll itself re-triggers the
// brake and the plane crawls forever instead of rotating.
let modeSince = Date.now();
const trace = [];

function setMode(m, s) {
  mode = m;
  modeSince = Date.now();
  lastProgress = Date.now();
  trace.push({ mode: m, simTime: +s.simTime.toFixed(1), alt: Math.round(s.altitude), speed: Math.round(s.speed), fuel: +s.fuel.toFixed(2), score: s.score });
  say(`MODE ${m} (sim ${s.simTime.toFixed(1)}s, alt ${Math.round(s.altitude)}m, spd ${Math.round(s.speed)}m/s, fuel ${(s.fuel * 100).toFixed(0)}%, score ${s.score})`);
}

try {
  await page.goto('http://127.0.0.1:8901/?seed=20261126', { waitUntil: 'load', timeout: 60000 });
  await sleep(2500);
  let s = await state();
  say(`title: state=${s.state} simTime=${s.simTime.toFixed(1)}`);
  await page.keyboard.press('Enter');
  await sleep(400);
  s = await state();
  say(`after Enter: state=${s.state} onGround=${s.onGround}`);
  setMode('takeoff', s);

  while (Date.now() - t0wall < WALL_LIMIT_MS) {
    s = await state();
    if (s.state === 'crashed') { outcome = 'crashed'; say(`CRASHED at sim ${s.simTime.toFixed(1)}s, pos (${Math.round(s.x)}, ${Math.round(s.y)}, ${Math.round(s.z)}), mode=${mode}`); break; }
    if (s.state === 'done') { outcome = 'mission-complete'; say(`MISSION COMPLETE sim ${s.simTime.toFixed(1)}s score=${s.score} fuel=${(s.fuel * 100).toFixed(0)}% msg="${s.message}"`); break; }
    if (s.ring > lastRing) {
      say(`RING ${lastRing} passed -> ${s.ring}/8 (sim ${s.simTime.toFixed(1)}s, score ${s.score}, fuel ${(s.fuel * 100).toFixed(0)}%)`);
      lastRing = s.ring;
      lastProgress = Date.now();
    }
    if (s.legsDone > lastLegs) {
      say(`LEG ${lastLegs} done -> ${lastLegs + 1} (sim ${s.simTime.toFixed(1)}s, score ${lastScore} -> ${s.score} (+${s.score - lastScore}), msg="${s.message}", fuel ${(s.fuel * 100).toFixed(0)}%)`);
      lastLegs = s.legsDone;
      lastScore = s.score;
      lastProgress = Date.now();
    }
    if (Math.abs(s.altitude - lastAlt) > 20) { lastAlt = s.altitude; lastProgress = Date.now(); }
    if (Date.now() - lastStatus > 5000) {
      lastStatus = Date.now();
      say(`status sim=${s.simTime.toFixed(1)} mode=${mode} pos=(${Math.round(s.x)},${Math.round(s.y)},${Math.round(s.z)}) hdg=${(s.heading * 180 / Math.PI).toFixed(0)}deg spd=${Math.round(s.speed)} thr=${s.throttle.toFixed(2)} pitch=${s.pitch.toFixed(2)} roll=${s.roll.toFixed(2)} vs=${s.verticalSpeed.toFixed(1)} fuel=${(s.fuel * 100).toFixed(0)}% keys=[${[...down].join('+')}]`);
    }
    if (Date.now() - lastProgress > 240000) { outcome = 'stuck'; say(`STUCK: no progress 240s in mode=${mode} (sim ${s.simTime.toFixed(1)}s)`); break; }

    let c;
    if (mode === 'takeoff') {
      // Full throttle on the roll and the first 60 m of climb; then back off
      // to 0.35 (~65 m/s) — at 96 m/s the turn rate is only ~7 deg/s and the
      // aircraft overshoots the turn toward ring 0 and circles. Hold runway
      // heading (east) until high enough to clear the hillside beside the
      // strip — only then turn toward ring 0.
      const thr = s.onGround || s.altitude < 60 ? 1.0 : 0.35;
      const tgt = s.altitude < 130
        ? { heading: Math.PI / 2, alt: 160, throttle: thr }
        : { hx: 450, hz: 350, alt: 160, throttle: thr };
      c = control(s, tgt);
      await setKeys(c.keys);
      if (!s.onGround && s.altitude > 150) setMode('rings', s);
    } else if (mode === 'rings') {
      if (s.phase === 'leg1') { say(`all rings done, phase leg1 (sim ${s.simTime.toFixed(1)}s)`); setMode('stageKarang', s); }
      else {
        const r = s.nextRingPos;
        const thr = Math.abs(c?.err ?? 0) > 0.8 ? 0.10 : 0.22;
        c = control(s, { hx: r.x, hz: r.z, alt: r.y, throttle: thr });
        await setKeys(c.keys);
      }
    } else if (mode === 'stageKarang') {
      await setFlaps(false);
      // Phase A: climb straight ahead to 230 m — the ground under the turn
      // out of ring 7 rises to ~185 m, so turning or descending while low
      // there is fatal. Phase B: fly east; only descend to the 110 m
      // staging altitude once past x=2400 (open sea east of Pulau Karang).
      const cruise = s.altitude < 225
        ? { heading: s.heading, alt: 230, throttle: 0.35 }
        : { hx: 3300, hz: 950, alt: s.x > 2400 ? 110 : 230, throttle: 0.35 };
      c = control(s, cruise);
      await setKeys(c.keys);
      if (dist2d(s.x, s.z, 3300, 950) < 250) setMode('finalKarang', s);
    } else if (mode === 'finalKarang') {
      if (s.x < 3200) await setFlaps(true);
      // Glide profile bottoms at 11 m — below the landing trigger (ground
      // 12 m + 0.4 m clearance) — so the aircraft descends through the
      // trigger instead of levelling off above the strip.
      // Aim at a point on the centreline 300 m ahead of the aircraft, NOT
      // a fixed point or heading: the turn into final can leave the
      // aircraft offset from the centreline, and a fixed heading never
      // corrects that (the aircraft would descend into the sea south of the
      // strip); a fixed near aim point swings the heading hard at the last
      // moment and banks past the 0.3 rad touchdown roll limit.
      const altT = Math.max(11, 12 + Math.max(0, s.x - 1950) * 0.07);
      const thr = s.speed > 45 ? 0.05 : 0.12;
      const rdb = s.altitude < 30 ? 0.2 : 0.10;
      c = control(s, { hx: s.x - 300, hz: 950, alt: altT, throttle: thr, vsFeed: -0.07 * s.speed, rollDeadband: rdb, capVs: true });
      await setKeys(c.keys);
      if (s.legsDone === 1) { setMode('taxi', s); }
      else if (s.onGround && s.phase === 'leg1') {
        say(`landed wrong at KARANG (sim ${s.simTime.toFixed(1)}s, x=${Math.round(s.x)}, score=${s.score}) — retry`);
        retriesKarang += 1;
        if (retriesKarang > 2) { outcome = 'landing-retry-exceeded-karang'; break; }
        braking = true;
        setMode('retakeoffKarang', s);
      }
    } else if (mode === 'retakeoffKarang') {
      await setFlaps(false);
      // Recovery after a wrong landing at KARANG: roll out, turn around on
      // the strip (we landed facing west; takeoff is east, over the sea),
      // then take off and re-enter staging.
      if (braking && s.onGround && s.speed > 5) {
        const keys = new Set();
        if (s.throttle > 0.05) keys.add('Control');
        await setKeys(keys);
      } else {
        braking = false;
        if (s.onGround && Math.abs(wrap(Math.PI / 2 - s.heading)) > 0.08) {
          const keys = new Set();
          if (s.throttle > 0.05) keys.add('Control');
          if (wrap(Math.PI / 2 - s.heading) > 0) keys.add('ArrowRight'); else keys.add('ArrowLeft');
          await setKeys(keys);
        } else {
          const thr = s.onGround || s.altitude < 60 ? 1.0 : 0.35;
          const tgt = s.altitude < 130
            ? { heading: Math.PI / 2, alt: 160, throttle: thr }
            : { hx: 3300, hz: 950, alt: 160, throttle: thr };
          c = control(s, tgt);
          await setKeys(c.keys);
          if (!s.onGround && s.altitude > 150) setMode('stageKarang', s);
        }
      }
    } else if (mode === 'taxi') {
      // Cut throttle, roll out, then turn around on the strip (heading east).
      const keys = new Set();
      if (s.throttle > 0.05) keys.add('Control');
      if (s.speed < 5) {
        const err = wrap(Math.PI / 2 - s.heading);
        if (err > 0.08) keys.add('ArrowRight');
        else if (err < -0.08) keys.add('ArrowLeft');
        else { say(`taxi turn done, heading ${(s.heading * 180 / Math.PI).toFixed(0)}deg (sim ${s.simTime.toFixed(1)}s)`); setMode('takeoff2', s); }
      }
      await setKeys(keys);
      if (Date.now() - modeSince > 180000) { outcome = 'taxi-timeout'; say('taxi turn timed out'); break; }
    } else if (mode === 'takeoff2') {
      const thr = s.onGround || s.altitude < 60 ? 1.0 : 0.35;
      const tgt = s.altitude < 130
        ? { heading: Math.PI / 2, alt: 160, throttle: thr }
        : { hx: 350, hz: 700, alt: 160, throttle: thr };
      c = control(s, tgt);
      await setKeys(c.keys);
      if (!s.onGround && s.altitude > 150) setMode('stageNusa', s);
    } else if (mode === 'stageNusa') {
      await setFlaps(false);
      // Climb straight ahead to 190 m first (the return turn crosses Pulau
      // Karang's interior, peaks ~175 m), then navigate to the staging
      // point (800, 190, 700) over the sea east of Nusa Besar.
      const cruise = s.altitude < 185
        ? { heading: s.heading, alt: 190, throttle: 0.3 }
        : { hx: 800, hz: 700, alt: 190, throttle: 0.3 };
      c = control(s, cruise);
      await setKeys(c.keys);
      if (dist2d(s.x, s.z, 800, 700) < 250) setMode('finalNusa', s);
    } else if (mode === 'finalNusa') {
      if (s.x < 500) await setFlaps(true);
      // Two-segment glide: from the staging point a 0.10 slope down to
      // 68 m over the coastal hills east of the strip (max ground 47.6 m),
      // then a gentle 0.075 slope down the strip to touchdown ~x -910.
      // Profile bottoms at 11 m, below the landing trigger.
      const altT = s.x > -170 ? 68 + (s.x + 170) * 0.10 : Math.max(11, 68 - (-170 - s.x) * 0.075);
      const thr = s.speed > 45 ? 0.05 : 0.12;
      const vsFeed = s.x > -170 ? -0.10 * s.speed : -0.075 * s.speed;
      // Aim at a point on the centreline 300 m ahead (see finalKarang).
      const rdb = s.altitude < 30 ? 0.2 : 0.10;
      c = control(s, { hx: s.x - 300, hz: 700, alt: altT, throttle: thr, vsFeed, rollDeadband: rdb, capVs: true });
      await setKeys(c.keys);
      if (s.onGround && s.phase === 'leg2' && s.state === 'flying') {
        say(`landed wrong at NUSA (sim ${s.simTime.toFixed(1)}s, x=${Math.round(s.x)}, score=${s.score}) — retry`);
        retriesNusa += 1;
        if (retriesNusa > 2) { outcome = 'landing-retry-exceeded-nusa'; break; }
        braking = true;
        setMode('retakeoffNusa', s);
      }
    } else if (mode === 'retakeoffNusa') {
      await setFlaps(false);
      // Same recovery as retakeoffKarang: roll out, turn to face east,
      // take off, re-enter staging.
      if (braking && s.onGround && s.speed > 5) {
        const keys = new Set();
        if (s.throttle > 0.05) keys.add('Control');
        await setKeys(keys);
      } else {
        braking = false;
        if (s.onGround && Math.abs(wrap(Math.PI / 2 - s.heading)) > 0.08) {
          const keys = new Set();
          if (s.throttle > 0.05) keys.add('Control');
          if (wrap(Math.PI / 2 - s.heading) > 0) keys.add('ArrowRight'); else keys.add('ArrowLeft');
          await setKeys(keys);
        } else {
          const thr = s.onGround || s.altitude < 60 ? 1.0 : 0.35;
          const tgt = s.altitude < 130
            ? { heading: Math.PI / 2, alt: 160, throttle: thr }
            : { hx: 350, hz: 700, alt: 160, throttle: thr };
          c = control(s, tgt);
          await setKeys(c.keys);
          if (!s.onGround && s.altitude > 150) setMode('stageNusa', s);
        }
      }
    }

    await sleep(POLL_MS);
  }

  if (outcome === 'aborted') say('WALL TIMEOUT 25 min reached');
  const final = await state().catch(() => null);
  say(`FINAL: outcome=${outcome} errors=${errors.length} external=${external.length}`);
  if (errors.length) say(`errors: ${JSON.stringify(errors.slice(0, 5))}`);
  if (external.length) say(`external: ${JSON.stringify(external.slice(0, 5))}`);
  writeFileSync(join(root, 'tools', 'autopilot-log.json'), JSON.stringify({
    outcome, errors, external, trace, log,
    final: final ? { state: final.state, simTime: +final.simTime.toFixed(1), score: final.score, ring: final.ring, legsDone: final.legsDone, fuel: +final.fuel.toFixed(2), x: Math.round(final.x), y: Math.round(final.y), z: Math.round(final.z) } : null,
    wallSeconds: Math.round((Date.now() - t0wall) / 1000),
  }, null, 1));
  console.log(`OUTCOME ${outcome}`);
} catch (e) {
  // A harness failure (e.g. evaluate timeout after a renderer death) must
  // still leave a log + JSON behind instead of dying silently.
  outcome = `error: ${e.message}`;
  say(`HARNESS ERROR: ${e.message}`);
  try {
    writeFileSync(join(root, 'tools', 'autopilot-log.json'), JSON.stringify({
      outcome, errors, external, trace, log, final: null,
      wallSeconds: Math.round((Date.now() - t0wall) / 1000),
    }, null, 1));
  } catch { /* ignore */ }
  console.log(`OUTCOME ${outcome}`);
} finally {
  await setKeys(new Set()).catch(() => {});
  await browser.close().catch(() => {});
  server.kill();
}
process.exit(outcome === 'mission-complete' ? 0 : 1);
