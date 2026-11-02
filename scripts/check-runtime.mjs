/**
 * Runtime smoke check: loads a real local model in a real browser, then asks
 * one question through the chat workbench. This is deliberately not part of
 * `npm test` — it downloads hundreds of megabytes and needs WebGPU for some
 * models.
 *
 *   npm run check:runtime
 *   npm run check:runtime -- --model=qwen2.5-1.5b --backend=webgpu --precision=q4f16 --allow-download
 *
 * Exit codes: 0 pass, 1 failure, 2 refused (weights missing, model cannot run
 * on this backend, or the download was not explicitly allowed).
 *
 * The profile lives in `.artifacts/runtime-profile` so a second run reuses the
 * weights and finishes in seconds.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [key, value = 'true'] = raw.replace(/^--/, '').split('=');
    return [key, value];
  }),
);

const model = args.get('model') ?? 'qwen3-0.6b';
const backend = args.get('backend') ?? 'wasm';
const precision = args.get('precision') ?? 'fp16';
const prompt = args.get('prompt') ?? '用一句话说明什么是潮汐，不要解释。';
const allowDownload = args.get('allow-download') === 'true';
const waitSeconds = Number(args.get('timeout') ?? 480);
const port = process.env.CHECK_PORT ?? '3312';
const base = args.get('base') ?? process.env.CHECK_BASE ?? `http://localhost:${port}`;
// Override with --profile=.artifacts/gpu-profile to reuse a dev browser's
// cache instead of downloading the weights again.
const profile = path.resolve(root, args.get('profile') ?? '.artifacts/runtime-profile');

mkdirSync(path.join(root, '.artifacts'), { recursive: true });

let server = null;

function stopServer() {
  if (!server) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    server.kill('SIGTERM');
  }
  server = null;
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (args.has('base') || process.env.CHECK_BASE) return;
  if (await reachable(base)) {
    console.log(`using running server at ${base}`);
    return;
  }
  if (!existsSync(path.join(root, '.next', 'BUILD_ID'))) {
    throw new Error('没有构建产物，先运行 npm run build');
  }
  server = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: root,
    shell: process.platform === 'win32',
    stdio: 'ignore',
  });
  for (let i = 0; i < 40; i += 1) {
    if (await reachable(`${base}/studio/settings`)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('开发服务器没有在 40 秒内就绪');
}

function fail(message) {
  console.log(`FAIL  ${message}`);
  stopServer();
  process.exit(1);
}

function refuse(message) {
  console.log(`SKIP  ${message}`);
  stopServer();
  process.exit(2);
}

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launchPersistentContext(profile, { channel, headless: true });
    } catch {
      // try the next installed browser
    }
  }
  return chromium.launchPersistentContext(profile, { headless: true });
}

await ensureServer();

const context = await launch();
const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
page.on('pageerror', (error) => errors.push(error.message.slice(0, 240)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text().slice(0, 240));
});
page.setDefaultTimeout(45_000);

try {
  await page.goto(`${base}/studio/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  await page.selectOption('select[aria-label="推理后端"]', backend);
  await page.waitForTimeout(400);
  if (backend === 'webgpu') {
    await page.selectOption('select[aria-label="WebGPU 精度"]', precision);
    await page.waitForTimeout(400);
  }

  const row = page.locator(`[data-model="${model}"]`);
  if (!(await row.count())) {
    const known = await page.locator('[data-model]').evaluateAll((nodes) =>
      nodes.map((node) => node.dataset.model),
    );
    refuse(`目录里没有 ${model}；现有：${known.join(', ')}`);
  }

  const button = row.getByRole('button', { name: /下载并加载|加载|切换到|需 WebGPU/ }).first();
  if (!(await button.count())) {
    // Already resident from a previous run: still worth asking a question.
    console.log(`RESIDENT ${(await page.locator('[data-resident]').innerText()).replace(/\n+/g, ' | ')}`);
  } else if (await button.isDisabled()) {
    refuse(`${model} 在当前后端不可用：${await button.getAttribute('title')}`);
  } else {
    const label = (await button.innerText()).replace(/\s+/g, ' ');
    const willDownload = /下载并加载/.test(label);
    if (willDownload && !allowDownload) {
      refuse(`${model} 的权重还没下载；确认要下几百 MB 时加 --allow-download`);
    }
    console.log(`CLICK ${label}`);
    await button.click();
  }

  const started = Date.now();
  let loaded = (await row.getAttribute('data-loaded')) === 'true';
  while (!loaded && Date.now() - started < waitSeconds * 1000) {
    await page.waitForTimeout(3000);
    loaded = (await row.getAttribute('data-loaded')) === 'true';
    const text = (await row.innerText()).replace(/\s+/g, ' ');
    if (/错误码|加载失败|超出上限|Failed to|Can't create/.test(text)) {
      fail(`${model} 加载失败：${text.slice(0, 240)}`);
    }
  }
  if (!loaded) fail(`${model} 在 ${waitSeconds}s 内没有变成「已加载」`);

  // The attribute carries model ids; the visible line carries labels, and a
  // label is not a stable key to assert on.
  const residentIds = await page
    .locator('[data-resident]')
    .getAttribute('data-resident', { timeout: 5000 })
    .catch(() => '');
  const resident = (await page.locator('[data-resident]').innerText()).replace(/\n+/g, ' | ');
  console.log(`LOADED ${(await row.innerText()).replace(/\s+/g, ' ').slice(0, 120)}`);
  console.log(`RESIDENT ${resident}`);
  if (!(residentIds ?? '').split(/\s+/).includes(model)) {
    fail(`驻留状态里没有 ${model}（实际：${residentIds || '空'}）`);
  }

  // Loading writes the engine preference *after* the session resolves, and the
  // chat page reads it on mount — navigating immediately can catch the old one.
  await page.waitForTimeout(1500);
  await page.goto(`${base}/studio/chat`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const box = page.getByPlaceholder('回车发送，Shift + 回车换行');
  await box.fill(prompt);
  await box.press('Enter');

  const asked = Date.now();
  let answer = '';
  while (Date.now() - asked < 180_000) {
    await page.waitForTimeout(2000);
    answer = await page.locator('[data-turn="assistant"]').last().innerText().catch(() => '');
    if (answer.trim() && (await page.getByLabel('发送').count()) > 0) break;
  }
  if (!answer.trim()) fail('提问之后没有拿到回答');
  console.log(`ANSWER ${answer.replace(/\s+/g, ' ').slice(0, 200)}`);

  if (errors.length) fail(`运行中有页面错误：${errors[0]}`);
  console.log(`PASS  ${model} · ${backend}${backend === 'webgpu' ? `/${precision}` : ''}`);
  await context.close();
  stopServer();
  process.exit(0);
} catch (error) {
  await context.close().catch(() => undefined);
  fail(error instanceof Error ? error.message : String(error));
}
