// Headless audio smoke test for Nusa Airlift (Node 22, test harness only —
// NOT part of the shipped game). Proves the WebAudio synth actually makes
// sound, three ways:
//   A. Live: the game's own engine/wind gains and frequencies respond to
//      throttle and airspeed in a real headless run (via __game.audioState).
//   B. Mute: the on-screen SUARA button toggles mute and silences the gains.
//   C. Offline: the synth graph is rendered through an OfflineAudioContext
//      and the output is measured — full throttle must be clearly non-silent
//      and clearly louder than idle, so the engine is not a silent stub.
// Usage: node tools/audio-test.mjs   (exit 0 = all assertions pass)
import { createRequire } from 'node:module';
const require = createRequire('/home/hatch/workspace/tools/browser/node_modules/playwright-core/package.json');
const { chromium } = require('playwright-core');
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
}

const server = spawn(`${process.env.HOME}/workspace/tools/node22/bin/node`, ['serve.ts', '--port', '8901'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
});
await sleep(1200);
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 320, height: 180 } }); // tiny viewport: the test flies by numbers, and SwiftShader shares the VM with the Tacoma render
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8901/?seed=20261126', { waitUntil: 'load', timeout: 60000 });
  await sleep(2500);

  // A. Live gains respond to throttle and airspeed.
  // The renderer runs slowly headless (SwiftShader shares the VM with the
  // Tacoma final render), so wait on SIM state, not wall time: throttle
  // ramps 0.55/s of sim time and the roll needs seconds of sim to build
  // speed. The AudioContext clock itself runs in wall time, so once the
  // game has set a gain target it converges within a second of wall time.
  await page.keyboard.press('Enter');
  await sleep(500);
  const before = await page.evaluate(() => window.__game.audioState);
  await page.keyboard.down('Shift'); // full throttle on the runway roll
  await page.waitForFunction(() => window.__game.throttle >= 0.9, null, { timeout: 120000 });
  await sleep(1000); // let the gain targets settle (audio clock = wall time)
  const after = await page.evaluate(() => window.__game.audioState);
  await page.waitForFunction(() => window.__game.speed > 25, null, { timeout: 180000 });
  await sleep(500);
  const rolling = await page.evaluate(() => ({
    state: window.__game.state,
    speed: window.__game.speed,
    throttle: window.__game.throttle,
    audio: window.__game.audioState,
  }));
  await page.keyboard.up('Shift');
  check('audio: context started and running', before.started === true && after.ctxState === 'running', after);
  check('audio: engine gain rises with throttle', after.engineGain > 0.12 && after.engineGain > before.engineGain, { before: before.engineGain, after: after.engineGain });
  check('audio: engine pitch rises with throttle', after.engineFreq > 120 && after.engineFreq > before.engineFreq, { before: before.engineFreq, after: after.engineFreq });
  check('audio: wind gain rises with airspeed', rolling.audio.windGain > 0.02, { speed: rolling.speed, windGain: rolling.audio.windGain });

  // B. Mute button toggles and silences the graph.
  const btn = await page.$('#mute-btn');
  const box = btn ? await btn.boundingBox() : null;
  check('audio: mute button visible', box !== null && box.width > 20, box);
  await page.click('#mute-btn');
  await sleep(300);
  const muted = await page.evaluate(() => window.__game.audioState);
  check('audio: mute button silences engine', muted.muted === true && muted.engineGain === 0, muted);
  await page.click('#mute-btn');
  await sleep(300);
  const unmuted = await page.evaluate(() => window.__game.audioState);
  check('audio: mute button unmutes', unmuted.muted === false, unmuted);

  // C. Offline render: measure the synth's actual output.
  const offline = await page.evaluate(async () => {
    const { createAudio } = await import('/src/audio.js');
    async function render(throttle, speed) {
      const ctx = new OfflineAudioContext(1, 44100 * 2, 44100);
      const a = createAudio(ctx);
      a.unlock();
      a.update(throttle, speed, false);
      a.ring();
      const buf = await ctx.startRendering();
      const data = buf.getChannelData(0);
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < data.length; i += 1) {
        sum += data[i] * data[i];
        if (Math.abs(data[i]) > peak) peak = Math.abs(data[i]);
      }
      return { rms: Math.sqrt(sum / data.length), peak, samples: data.length };
    }
    const full = await render(0.8, 55);
    const idle = await render(0, 0);
    return { full, idle };
  });
  check('audio: offline full-throttle render is non-silent', offline.full.rms > 0.02 && offline.full.peak > 0.1, offline.full);
  check('audio: full throttle clearly louder than idle', offline.full.rms > 1.5 * offline.idle.rms, { fullRms: offline.full.rms, idleRms: offline.idle.rms });
  check('audio: no page errors during test', errors.length === 0, errors);

  await context.close();
} catch (e) {
  console.log(`HARNESS ERROR: ${e.message}`);
  failed = true;
} finally {
  await browser.close();
  server.kill();
}
if (results.some((r) => !r.ok)) failed = true;
console.log(failed ? 'AUDIO TEST: FAILED' : 'AUDIO TEST: PASSED');
process.exit(failed ? 1 : 0);
