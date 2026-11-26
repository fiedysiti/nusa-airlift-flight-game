// Full-mission simulation for Nusa Airlift (Node 22, no browser, no
// rendering). Runs the game's OWN flight model, missions and terrain code
// (game/src/flight.js, missions.js, terrain.js) with the same scripted
// controller as the browser autopilot (tools/autopilot.mjs), one control
// tick per 0.05 s sim step — exactly the browser loop's dt clamp at low
// frame rates, so the pitch-pulse ripple and landing judgements behave
// the same. A full mission takes seconds instead of ~11 wall minutes.
// Usage: node tools/sim.mjs   (writes tools/sim-log.json)
// Exit 0 = mission complete; 1 = crash / abort.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);

const { createFlight, stepFlight } = await import('../game/src/flight.js');
const { createMissions, stepMissions, onLanded, resetMissionVisuals } = await import('../game/src/missions.js');
const { groundHeight, RUNWAYS } = await import('../game/src/terrain.js');
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SEED = 20261126;
const DT = 0.05; // one browser frame at the dt clamp
const wrap = (a) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
const dist2d = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const ground = (x, z) => groundHeight(x, z, SEED);

// --- world setup (mirrors game/src/main.js) ---
const HOME = RUNWAYS[0];
const homeRad = (HOME.heading * Math.PI) / 180;
function runwayStart() {
  return {
    x: HOME.x - Math.sin(homeRad) * (HOME.length / 2 - 40),
    y: HOME.elevation + 1.65,
    z: HOME.z + Math.cos(homeRad) * (HOME.length / 2 - 40),
    heading: homeRad,
    speed: 0,
    throttle: 0,
    onGround: true,
  };
}
const flight = createFlight(runwayStart());
const fakeScene = { add() {} };
const missions = createMissions(SEED, fakeScene);
let simTime = 0;
let state = 'flying'; // flying | done | crashed

function resetRun() {
  const start = runwayStart();
  flight.pos.set(start.x, start.y, start.z);
  flight.heading = start.heading;
  flight.pitch = 0;
  flight.roll = 0;
  flight.speed = 0;
  flight.throttle = 0;
  flight.flaps = false;
  flight.fuel = 1;
  flight.onGround = true;
  flight.crashed = false;
  flight.landed = false;
  flight.stalled = false;
  resetMissionVisuals(missions);
  state = 'flying';
}
resetRun();

// --- scripted controller: a faithful port of tools/autopilot.mjs ---
// Same gains, profiles, aim points and modes; instead of keyboard it
// returns the input object stepFlight consumes.
let tickN = 0;
function control(s, tgt) {
  tickN += 1;
  const input = { pitch: 0, roll: 0, throttleUp: false, throttleDown: false };
  if (s.throttle < tgt.throttle - 0.03) input.throttleUp = true;
  else if (s.throttle > tgt.throttle + 0.03) input.throttleDown = true;
  const stalling = !s.onGround && s.speed < 27.5;
  if (stalling) {
    input.throttleDown = false;
    input.throttleUp = true;
    input.pitch = -1;
  } else if (!s.onGround || tgt.alt > s.altitude + 2) {
    let vsDes = Math.max(-6, Math.min(12, (tgt.alt - s.altitude) * 0.3 + (tgt.vsFeed ?? 0)));
    if (tgt.capVs && s.altitude < 40) vsDes = Math.max(vsDes, -2.7);
    const pitchDes = Math.max(-0.25, Math.min(0.25,
      Math.asin(Math.max(-0.9, Math.min(0.9, vsDes / Math.max(s.speed, 20))))));
    if (s.pitch < pitchDes - 0.015) input.pitch = 1;
    else if (s.pitch > pitchDes + 0.015) input.pitch = -1;
  }
  let desired;
  if (tgt.heading !== undefined) desired = tgt.heading;
  else desired = Math.atan2(tgt.hx - s.x, -(tgt.hz - s.z));
  const err = wrap(desired - s.heading);
  const steer = tgt.steer === undefined ? !s.onGround : tgt.steer;
  const rollDb = tgt.rollDeadband ?? 0.10;
  if (steer) {
    if (err > rollDb) input.roll = 1;
    else if (err < -rollDb) input.roll = -1;
  }
  return { input, err };
}

const snap = () => ({
  state, score: missions.score, ring: missions.nextRing, speed: flight.speed,
  altitude: flight.pos.y, fuel: flight.fuel, crashed: flight.crashed,
  simTime, x: flight.pos.x, y: flight.pos.y, z: flight.pos.z,
  heading: flight.heading, pitch: flight.pitch, roll: flight.roll,
  throttle: flight.throttle, onGround: flight.onGround,
  verticalSpeed: flight.verticalSpeed, vsSmooth: flight.vsSmooth,
  stalled: flight.stalled, flaps: flight.flaps, phase: missions.phase,
  legsDone: missions.legsDone, message: missions.message,
  nextRingPos: missions.rings[missions.nextRing]
    ? { x: missions.rings[missions.nextRing].pos.x, y: missions.rings[missions.nextRing].pos.y, z: missions.rings[missions.nextRing].pos.z }
    : null,
});

const log = [];
const trace = [];
function say(msg) { const line = `sim=${simTime.toFixed(1)} ${msg}`; log.push(line); console.log(line); }

let outcome = 'aborted';
let mode = 'takeoff';
let lastRing = 0;
let lastLegs = 0;
let lastScore = 0;
let retriesKarang = 0;
let retriesNusa = 0;
let flapsOn = false;
let braking = false; // retakeoff: brake to a stop ONCE after a wrong landing,
// then never brake again — or the takeoff roll itself re-triggers the
// brake and the plane crawls forever instead of rotating.
function setFlaps(on) {
  if (on === flapsOn) return;
  flight.flaps = !flight.flaps;
  flapsOn = on;
  say(`flaps ${on ? 'ON' : 'OFF'}`);
}
function setMode(m, s) {
  mode = m;
  trace.push({ mode: m, simTime: +s.simTime.toFixed(1), alt: Math.round(s.altitude), speed: Math.round(s.speed), fuel: +s.fuel.toFixed(2), score: s.score });
  say(`MODE ${m} (alt ${Math.round(s.altitude)}m, spd ${Math.round(s.speed)}m/s, fuel ${(s.fuel * 100).toFixed(0)}%, score ${s.score})`);
}

const MAX_STEPS = 20000; // 1000 s sim, far above the ~390 s a mission takes
let step = 0;
let lastStatusStep = -1;
while (step < MAX_STEPS) {
  step += 1;
  simTime += DT;
  const s = snap();
  if (s.state === 'crashed') { outcome = 'crashed'; say(`CRASHED pos=(${Math.round(s.x)},${Math.round(s.y)},${Math.round(s.z)}) mode=${mode} vsSmooth=${s.vsSmooth.toFixed(1)} roll=${s.roll.toFixed(2)}`); break; }
  if (s.state === 'done') { outcome = 'mission-complete'; say(`MISSION COMPLETE score=${s.score} fuel=${(s.fuel * 100).toFixed(0)}% msg="${s.message}"`); break; }
  if (s.ring > lastRing) {
    say(`RING ${lastRing} passed -> ${s.ring}/8 (score ${s.score}, fuel ${(s.fuel * 100).toFixed(0)}%)`);
    lastRing = s.ring;
  }
  if (s.legsDone > lastLegs) {
    say(`LEG ${lastLegs} done -> ${lastLegs + 1} (score ${lastScore} -> ${s.score} (+${s.score - lastScore}), msg="${s.message}", fuel ${(s.fuel * 100).toFixed(0)}%)`);
    lastLegs = s.legsDone;
    lastScore = s.score;
  }
  if (step - lastStatusStep >= 200) { // every 10 s sim
    lastStatusStep = step;
    say(`status mode=${mode} pos=(${Math.round(s.x)},${Math.round(s.y)},${Math.round(s.z)}) hdg=${((s.heading * 180 / Math.PI) % 360 + 360) % 360 | 0}deg spd=${Math.round(s.speed)} thr=${s.throttle.toFixed(2)} pitch=${s.pitch.toFixed(2)} roll=${s.roll.toFixed(2)} vs=${s.verticalSpeed.toFixed(1)} vsSm=${s.vsSmooth.toFixed(1)} fuel=${(s.fuel * 100).toFixed(0)}%`);
  }

  let c;
  if (mode === 'takeoff') {
    const thr = s.onGround || s.altitude < 60 ? 1.0 : 0.35;
    const tgt = s.altitude < 130
      ? { heading: Math.PI / 2, alt: 160, throttle: thr }
      : { hx: 450, hz: 350, alt: 160, throttle: thr };
    c = control(s, tgt);
    var input = c.input;
    if (!s.onGround && s.altitude > 150) setMode('rings', s);
  } else if (mode === 'rings') {
    if (s.phase === 'leg1') { say('all rings done, phase leg1'); setMode('stageKarang', s); input = { pitch: 0, roll: 0, throttleUp: false, throttleDown: false }; }
    else {
      const r = s.nextRingPos;
      const thr = Math.abs(c?.err ?? 0) > 0.8 ? 0.10 : 0.22;
      c = control(s, { hx: r.x, hz: r.z, alt: r.y, throttle: thr });
      var input = c.input;
    }
  } else if (mode === 'stageKarang') {
    setFlaps(false);
    const cruise = s.altitude < 225
      ? { heading: s.heading, alt: 230, throttle: 0.35 }
      : { hx: 3300, hz: 950, alt: s.x > 2400 ? 110 : 230, throttle: 0.35 };
    c = control(s, cruise);
    var input = c.input;
    if (dist2d(s.x, s.z, 3300, 950) < 250) setMode('finalKarang', s);
  } else if (mode === 'finalKarang') {
    if (s.x < 3200) setFlaps(true);
    const altT = Math.max(11, 12 + Math.max(0, s.x - 1950) * 0.07);
    const thr = s.speed > 45 ? 0.05 : 0.12;
    const rdb = s.altitude < 30 ? 0.2 : 0.10;
    c = control(s, { hx: s.x - 300, hz: 950, alt: altT, throttle: thr, vsFeed: -0.07 * s.speed, rollDeadband: rdb, capVs: true });
    var input = c.input;
    if (s.legsDone === 1) setMode('taxi', s);
    else if (s.onGround && s.phase === 'leg1') {
      say(`landed wrong at KARANG (x=${Math.round(s.x)}, score=${s.score}) — retry`);
      retriesKarang += 1;
      if (retriesKarang > 2) { outcome = 'landing-retry-exceeded-karang'; break; }
      braking = true;
      setMode('retakeoffKarang', s);
    }
  } else if (mode === 'retakeoffKarang') {
    setFlaps(false);
    if (braking && s.onGround && s.speed > 5) {
      var input = { pitch: 0, roll: 0, throttleUp: false, throttleDown: s.throttle > 0.05 };
    } else {
      braking = false;
      if (s.onGround && Math.abs(wrap(Math.PI / 2 - s.heading)) > 0.08) {
        var input = { pitch: 0, roll: wrap(Math.PI / 2 - s.heading) > 0 ? 1 : -1, throttleUp: false, throttleDown: s.throttle > 0.05 };
      } else {
        const thr = s.onGround || s.altitude < 60 ? 1.0 : 0.35;
        const tgt = s.altitude < 130
          ? { heading: Math.PI / 2, alt: 160, throttle: thr }
          : { hx: 3300, hz: 950, alt: 160, throttle: thr };
        c = control(s, tgt);
        var input = c.input;
        if (!s.onGround && s.altitude > 150) setMode('stageKarang', s);
      }
    }
  } else if (mode === 'taxi') {
    var input = { pitch: 0, roll: 0, throttleUp: false, throttleDown: false };
    if (s.throttle > 0.05) input.throttleDown = true;
    if (s.speed < 5) {
      const err = wrap(Math.PI / 2 - s.heading);
      if (err > 0.08) input.roll = 1;
      else if (err < -0.08) input.roll = -1;
      else { say(`taxi turn done, heading ${((s.heading * 180 / Math.PI) % 360 + 360) % 360 | 0}deg`); setMode('takeoff2', s); }
    }
  } else if (mode === 'takeoff2') {
    const thr = s.onGround || s.altitude < 60 ? 1.0 : 0.35;
    const tgt = s.altitude < 130
      ? { heading: Math.PI / 2, alt: 160, throttle: thr }
      : { hx: 350, hz: 700, alt: 160, throttle: thr };
    c = control(s, tgt);
    var input = c.input;
    if (!s.onGround && s.altitude > 150) setMode('stageNusa', s);
  } else if (mode === 'stageNusa') {
    setFlaps(false);
    const cruise = s.altitude < 185
      ? { heading: s.heading, alt: 190, throttle: 0.3 }
      : { hx: 800, hz: 700, alt: 190, throttle: 0.3 };
    c = control(s, cruise);
    var input = c.input;
    if (dist2d(s.x, s.z, 800, 700) < 250) setMode('finalNusa', s);
  } else if (mode === 'finalNusa') {
    if (s.x < 500) setFlaps(true);
    const altT = s.x > -170 ? 68 + (s.x + 170) * 0.10 : Math.max(11, 68 - (-170 - s.x) * 0.075);
    const thr = s.speed > 45 ? 0.05 : 0.12;
    const vsFeed = s.x > -170 ? -0.10 * s.speed : -0.075 * s.speed;
    const rdb = s.altitude < 30 ? 0.2 : 0.10;
    c = control(s, { hx: s.x - 300, hz: 700, alt: altT, throttle: thr, vsFeed, rollDeadband: rdb, capVs: true });
    var input = c.input;
    if (s.onGround && s.phase === 'leg2' && s.state === 'flying') {
      say(`landed wrong at NUSA (x=${Math.round(s.x)}, score=${s.score}) — retry`);
      retriesNusa += 1;
      if (retriesNusa > 2) { outcome = 'landing-retry-exceeded-nusa'; break; }
      braking = true;
      setMode('retakeoffNusa', s);
    }
  } else if (mode === 'retakeoffNusa') {
    setFlaps(false);
    if (braking && s.onGround && s.speed > 5) {
      var input = { pitch: 0, roll: 0, throttleUp: false, throttleDown: s.throttle > 0.05 };
    } else {
      braking = false;
      if (s.onGround && Math.abs(wrap(Math.PI / 2 - s.heading)) > 0.08) {
        var input = { pitch: 0, roll: wrap(Math.PI / 2 - s.heading) > 0 ? 1 : -1, throttleUp: false, throttleDown: s.throttle > 0.05 };
      } else {
        const thr = s.onGround || s.altitude < 60 ? 1.0 : 0.35;
        const tgt = s.altitude < 130
          ? { heading: Math.PI / 2, alt: 160, throttle: thr }
          : { hx: 350, hz: 700, alt: 160, throttle: thr };
        c = control(s, tgt);
        var input = c.input;
        if (!s.onGround && s.altitude > 150) setMode('stageNusa', s);
      }
    }
  }

  // One physics step — mirrors game/src/main.js frame() for state flying.
  const event = stepFlight(flight, DT, input, ground);
  if (event === 'landed') {
    say(`TOUCHDOWN pos=(${Math.round(flight.pos.x)},${Math.round(flight.pos.y)},${Math.round(flight.pos.z)}) spd=${Math.round(flight.speed)} vsSmooth=${flight.vsSmooth.toFixed(1)} roll=${flight.roll.toFixed(2)} mode=${mode}`);
    const result = onLanded(missions, flight);
    if (result.event === 'mission-done') {
      state = 'done';
    }
  }
  if (event === 'crashed' || event === 'ditched') {
    state = 'crashed';
  }
  const missionEvent = stepMissions(missions, flight, DT);
  if (missionEvent === 'ring') { /* logged via ring counter */ }
}

if (outcome === 'aborted') say(`STEP LIMIT ${MAX_STEPS} reached without finishing`);
const final = snap();
say(`FINAL: outcome=${outcome} simTime=${final.simTime.toFixed(1)}s score=${final.score} ring=${final.ring} legsDone=${final.legsDone} fuel=${(final.fuel * 100).toFixed(0)}% pos=(${Math.round(final.x)},${Math.round(final.y)},${Math.round(final.z)})`);
writeFileSync(join(root, 'tools', 'sim-log.json'), JSON.stringify({
  outcome, log, trace,
  final: { state: final.state, simTime: +final.simTime.toFixed(1), score: final.score, ring: final.ring, legsDone: final.legsDone, fuel: +final.fuel.toFixed(2), x: Math.round(final.x), y: Math.round(final.y), z: Math.round(final.z) },
  steps: step,
}, null, 1));
console.log(`OUTCOME ${outcome}`);
process.exit(outcome === 'mission-complete' ? 0 : 1);
