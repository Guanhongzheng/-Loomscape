/**
 * Black-box performance check for the overview.
 *
 * Unlike the unit tests this measures the real browser path: first paint,
 * largest contentful paint, the time until the overview's local state has
 * settled, and how long a workbench click takes to land. Thresholds are
 * deliberately generous (CI machines and cold Next starts vary), but a
 * regression to a blocked main thread or a heavy data scan will fail them.
 *
 *   npm run test:perf
 *   PERF_BASE=http://localhost:3000 npm run test:perf
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const explicit = process.env.PERF_BASE;
const PORT = process.env.PERF_PORT ?? '3315';
const base = explicit ?? `http://localhost:${PORT}`;
const budget = {
  lcp: Number(process.env.PERF_LCP_MS ?? 4000),
  overview: Number(process.env.PERF_OVERVIEW_MS ?? 5000),
  click: Number(process.env.PERF_CLICK_MS ?? 3000),
};

let server = null;

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (explicit) return false;
  if (await reachable(base)) return false;
  if (!existsSync(path.join(root, '.next', 'BUILD_ID'))) {
    throw new Error('没有构建产物，先运行 npm run build');
  }
  console.log(`starting next start on ${PORT}`);
  server = spawn('npx', ['next', 'start', '-p', PORT], {
    cwd: root,
    shell: true,
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (await reachable(base)) return true;
  }
  throw new Error('服务器没有在 60 秒内就绪');
}

function stopServer() {
  if (!server) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    server.kill('SIGTERM');
  }
  server = null;
}

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      // next installed browser
    }
  }
  return chromium.launch({ headless: true });
}

await ensureServer();
const results = [];
const failures = [];

function metric(name, value, limit) {
  results.push({ name, value: Math.round(value), limit });
  const ok = value <= limit;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${Math.round(value)}ms (budget ${limit}ms)`);
  if (!ok) failures.push(name);
}

try {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.addInitScript(() => {
    window.__lcp = 0;
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) window.__lcp = last.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      // LCP is not available in every engine; the other metrics still run.
    }
  });

  const started = Date.now();
  await page.goto(base + '/#workspace', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-overview="continue"]', { timeout: 15_000 });
  const overviewMs = Date.now() - started;
  await page
    .waitForFunction(
      () => !(document.querySelector('[data-overview="state"]')?.textContent ?? '').includes('读取中'),
      null,
      { timeout: 8_000 },
    )
    .catch(() => undefined);

  const browserMetrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paints = performance.getEntriesByType('paint');
    return {
      lcp: window.__lcp || 0,
      dcl: nav?.domContentLoadedEventEnd ?? 0,
      firstPaint: paints.find((entry) => entry.name === 'first-contentful-paint')?.startTime ?? 0,
    };
  });

  metric('LCP', browserMetrics.lcp, budget.lcp);
  metric('overview ready', overviewMs, budget.overview);
  metric('first contentful paint', browserMetrics.firstPaint, budget.overview);

  const clickStarted = Date.now();
  await page.locator('[data-workbench="02"]').click();
  await page.waitForURL('**/studio/chat**', { timeout: 8_000 });
  const clickMs = Date.now() - clickStarted;
  metric('overview → 对话 click', clickMs, budget.click);

  console.log(
    `INFO  DOMContentLoaded ${Math.round(browserMetrics.dcl)}ms · viewport ${await page.evaluate(() => `${window.innerWidth}×${window.innerHeight}`)}`,
  );

  await browser.close();
} catch (error) {
  console.error(`perf run failed: ${error instanceof Error ? error.message : String(error)}`);
  failures.push('run');
} finally {
  stopServer();
}

console.log(`\n${results.length - failures.length}/${results.length} 项在预算内`);
if (failures.length) {
  console.log(`超出预算：${failures.join(', ')}`);
  process.exitCode = 1;
}
