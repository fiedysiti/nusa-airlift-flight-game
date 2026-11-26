// Screenshot + play-test harness for Nusa Airlift (Node 22).
// Uses the Playwright Chromium already on this machine with SwiftShader WebGL.
// Usage:
//   node tools/shot.mjs shot cover|cockpit|ring|landing   — one staged screenshot
//   node tools/shot.mjs playtest                          — fly the real game
//   node tools/shot.mjs all                               — all four shots
// Serves game/ itself on 127.0.0.1:8901 while it runs; exits non-zero on any
// console error, failed request, or external (non-localhost) request.
// Playwright lives in the shared browser tooling, not in this repo:
// resolve it from its own package.json so ESM loading finds it.
import { createRequire } from 'node:module';
const require = createRequire('/home/hatch/workspace/tools/browser/node_modules/playwright-core/package.json');
const { chromium } = require('playwright-core');
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SHOTS = [
  ['cover', '1-cover.jpg'],
  ['cockpit', '2-cockpit.jpg'],
  ['ring', '3-ring.jpg'],
  ['landing', '4-landing.jpg'],
];

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const server = spawn(`${process.env.HOME}/workspace/tools/node22/bin/node`, ['serve.ts', '--port', '8901'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return server;
}

async function newPage(browser, viewport = { width: 1280, height: 720 }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
  });
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
  return { page, errors, external, context };
}

async function takeShot(browser, name, file) {
  const { page, errors, external, context } = await newPage(browser);
  await page.goto(`http://127.0.0.1:8901/?shot=${name}&seed=20261126`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 60000 });
  await sleep(700);
  mkdirSync(join(root, 'screenshots'), { recursive: true });
  await page.screenshot({ path: join(root, 'screenshots', file), type: 'jpeg', quality: 82 });
  const state = await page.evaluate(() => window.__game);
  await context.close();
  return { name, file, state, errors, external };
}

async function playtest(browser) {
  // Small viewport: SwiftShader is slow, and the test only needs the logic.
  const { page, errors, external, context } = await newPage(browser, { width: 640, height: 360 });
  await page.goto('http://127.0.0.1:8901/?seed=20261126', { waitUntil: 'load', timeout: 60000 });
  await sleep(2500);
  const trace = [];
  const snap = async (label) => {
    trace.push({ label, ...(await page.evaluate(() => window.__game)) });
  };
  // Wait until the in-game clock advances by `seconds` (wall time may be
  // much longer than sim time when the renderer runs slowly).
  const waitSim = async (seconds, wallTimeout = 150000) => {
    const t0 = await page.evaluate(() => window.__game.simTime);
    // Note: waitForFunction passes ONE arg — destructure the [start, span] pair.
    await page.waitForFunction(([start, span]) => window.__game.simTime >= start + span, [t0, seconds], { timeout: wallTimeout });
  };
  await snap('title');
  await page.keyboard.press('Enter');
  await sleep(500);
  await snap('parked');
  // Full throttle, roll down the runway (sim-time waits, not wall time).
  await page.keyboard.down('Shift');
  await waitSim(5);
  await snap('rollout');
  // Rotate: hold pitch up, climb out.
  await page.keyboard.down('ArrowUp');
  await waitSim(3);
  await page.keyboard.up('ArrowUp');
  await snap('climb');
  // Gentle right bank for a few seconds, then level.
  await page.keyboard.down('ArrowRight');
  await waitSim(2);
  await page.keyboard.up('ArrowRight');
  await waitSim(3);
  await page.keyboard.up('Shift');
  await snap('cruise');
  await context.close();
  return { trace, errors, external };
}

const mode = process.argv[2] ?? 'all';
const server = serve();
await sleep(1200);
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
let failed = false;
try {
  if (mode === 'playtest') {
    const result = await playtest(browser);
    console.log(JSON.stringify(result, null, 1));
    if (result.errors.length || result.external.length) failed = true;
    const last = result.trace[result.trace.length - 1];
    if (last.crashed) { console.log('PLAYTEST: aircraft crashed'); failed = true; }
    if (last.altitude < 30) { console.log('PLAYTEST: never got airborne'); failed = true; }
  } else {
    const wanted = mode === 'all' ? SHOTS : SHOTS.filter(([n]) => n === mode);
    for (const [name, file] of wanted) {
      const result = await takeShot(browser, name, file);
      console.log(JSON.stringify(result));
      if (result.errors.length || result.external.length) failed = true;
    }
  }
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
