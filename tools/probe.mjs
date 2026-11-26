// Diagnostic probe: measures real rAF rate, sim-time rate, console errors.
import { createRequire } from 'node:module';
const require = createRequire('/home/hatch/workspace/tools/browser/node_modules/playwright-core/package.json');
const { chromium } = require('playwright-core');
import { spawn } from 'node:child_process';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chrome-linux64/chrome`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(`${process.env.HOME}/workspace/tools/node22/bin/node`, ['serve.ts', '--port', '8901'], {
  cwd: '/home/hatch/workspace/makefun/nusa-airlift-flight-game', stdio: ['ignore', 'pipe', 'pipe'],
});
await sleep(1200);
const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:8901/?seed=20261126', { waitUntil: 'load', timeout: 60000 });
await sleep(3000);
console.log('has __game:', await page.evaluate(() => typeof window.__game));
console.log('state:', await page.evaluate(() => window.__game && window.__game.state));
// Count rAF ticks in 5 s on the page itself.
const ticks = await page.evaluate(() => new Promise((resolve) => {
  let n = 0;
  const t0 = performance.now();
  const tick = () => { n += 1; if (performance.now() - t0 < 5000) requestAnimationFrame(tick); else resolve(n); };
  requestAnimationFrame(tick);
}));
console.log('rAF ticks in 5s:', ticks, '=> fps ~', (ticks / 5).toFixed(1));
const t0 = await page.evaluate(() => window.__game.simTime);
await sleep(10000);
const t1 = await page.evaluate(() => window.__game.simTime);
console.log('simTime advance in 10s wall (title screen):', (t1 - t0).toFixed(2));
await page.keyboard.press('Enter');
await sleep(2000);
console.log('after Enter:', JSON.stringify(await page.evaluate(() => window.__game)));
const t2 = await page.evaluate(() => window.__game.simTime);
await sleep(10000);
const t3 = await page.evaluate(() => window.__game.simTime);
console.log('simTime advance in 10s wall (flying):', (t3 - t2).toFixed(2));
console.log('final state:', JSON.stringify(await page.evaluate(() => window.__game)));
console.log('errors:', JSON.stringify(errors));
await browser.close();
server.kill();
