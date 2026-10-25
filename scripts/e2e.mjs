/**
 * End-to-end checks against a production build.
 *
 *   npm run build
 *   npm run test:e2e
 *
 * The script starts `next start` on a free port unless E2E_BASE points at a
 * server that is already running, then drives the installed Edge through the
 * flows that unit tests cannot reach: the boot curtain, the two-screen snap,
 * the split navigation, endpoint persistence and the retrieval-only chat.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, '.artifacts', 'e2e');
const PORT = process.env.E2E_PORT ?? '3311';
const base = process.env.E2E_BASE ?? `http://localhost:${PORT}`;

mkdirSync(shots, { recursive: true });

let server = null;
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function check(name, condition, detail = '') {
  record(name, Boolean(condition), detail);
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  // An explicit base means the caller manages the server; never spawn one.
  if (process.env.E2E_BASE) {
    console.log(`using running server at ${base}`);
    return;
  }

  if (await reachable(base)) {
    console.log(`using running server at ${base}`);
    return;
  }

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
    if (await reachable(base)) return;
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
      // try the next installed browser
    }
  }
  return chromium.launch({ headless: true });
}

async function run() {
  // The curtain is rendered on the server, so the very first byte already
  // contains the skeleton rather than a half-styled document.
  const home = await fetch(base + '/');
  const html = await home.text();
  check('SSR 首帧包含骨架幕布', html.includes('boot-curtain'));
  check('骨架节点已服务端渲染', (html.match(/skeleton/g) ?? []).length > 10);
  check(
    '响应头开启跨源隔离',
    home.headers.get('cross-origin-opener-policy') === 'same-origin' &&
      home.headers.get('cross-origin-embedder-policy') === 'credentialless',
    `coop=${home.headers.get('cross-origin-opener-policy')} coep=${home.headers.get('cross-origin-embedder-policy')}`,
  );

  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  context.setDefaultTimeout(12_000);
  context.setDefaultNavigationTimeout(25_000);
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const heroVisible = await page.locator('h1').first().isVisible();
  check('首屏渲染完成', heroVisible);
  await page.screenshot({ path: path.join(shots, '01-intro.png') });

  // Entering the workspace is a vertical snap, not a route change.
  await page.getByRole('button', { name: /进入工作台/ }).first().click();
  await page.waitForTimeout(1200);

  const snap = await page.evaluate(() => {
    const root = document.querySelector('div.snap-y');
    return {
      top: root ? Math.round(root.scrollTop) : -1,
      height: window.innerHeight,
      path: window.location.pathname,
    };
  });
  check(
    '进入工作台吸附到第二屏',
    Math.abs(snap.top - snap.height) <= 4,
    `scrollTop=${snap.top} viewport=${snap.height}`,
  );
  check('吸附不改路由', snap.path === '/', snap.path);

  // The workspace navigation is split top and bottom; the old sidebar is gone.
  const nav = await page.evaluate(() => ({
    aside: document.querySelectorAll('aside').length,
    header: Boolean(document.querySelector('header')),
    dock: document.querySelectorAll('footer nav a').length,
    dockVisible: (() => {
      const el = document.querySelector('footer nav');
      if (!el) return false;
      const box = el.getBoundingClientRect();
      return box.height > 20 && box.bottom <= window.innerHeight + 1;
    })(),
  }));
  check('左侧栏已移除', nav.aside === 0, `aside=${nav.aside}`);
  check('顶部栏存在', nav.header);
  check('底部坞有九个入口', nav.dock === 9, `links=${nav.dock}`);
  check('底部坞在视口内', nav.dockVisible);
  await page.screenshot({ path: path.join(shots, '02-workspace.png') });

  // Regression for the reported DataError: saving an endpoint used to fail
  // because the store expected an `id` that endpoints never had.
  await page.goto(base + '/studio/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const provider = page.locator('select').filter({ hasText: 'Anthropic Claude' }).first();
  await provider.selectOption({ label: 'DeepSeek' });
  await page.waitForTimeout(300);
  await page.locator('input[type="password"]').first().fill('sk-e2e-test-key-1234');
  await page.getByRole('button', { name: '保存并使用' }).click();
  await page.waitForTimeout(900);

  const toastText = await page
    .locator('body')
    .innerText()
    .then((text) => text.includes('已保存'));
  check('端点保存有成功提示', toastText);

  const stored = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open('loomscape');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('providers', 'readonly');
          const rows = tx.objectStore('providers').getAll();
          rows.onsuccess = () =>
            resolve(
              rows.result.map((row) => ({
                channel: row.channel,
                model: row.model,
                hasId: Object.prototype.hasOwnProperty.call(row, 'id'),
              })),
            );
          rows.onerror = () => resolve([]);
        };
        request.onerror = () => resolve([]);
      }),
  );
  const textRow = Array.isArray(stored) ? stored.find((row) => row.channel === 'text') : null;
  check('端点写入 IndexedDB 且以 channel 为键', Boolean(textRow), JSON.stringify(stored));
  check('记录不再依赖不存在的 id', textRow ? !textRow.hasId : false);

  const dataError = errors.some((line) => /DataError|key path/i.test(line));
  check('保存过程没有 DataError', !dataError, errors.find((line) => /DataError/i.test(line)) ?? '');

  const isolation = await page.evaluate(() => ({
    isolated: globalThis.crossOriginIsolated === true,
    shared: typeof SharedArrayBuffer === 'function',
    cores: navigator.hardwareConcurrency ?? 0,
  }));
  check(
    '页面已跨源隔离且可用 SharedArrayBuffer',
    isolation.isolated && isolation.shared,
    `cores=${isolation.cores}`,
  );

  const engineUi = await page.evaluate(() => {
    const text = document.body.innerText;
    const buttons = Array.from(document.querySelectorAll('button'))
      .map((button) => button.innerText.trim())
      .filter(Boolean);
    return {
      resident: text.includes('驻留模型'),
      idle: text.includes('驻留模型') && text.includes('无'),
      setCurrent: text.includes('设为当前'),
      loadButtons: buttons.filter((label) => /^(加载|下载并加载)$/.test(label)).length,
      threads: /\d+ 线程/.test(text),
      cachedLabel: text.includes('已缓存'),
      headerHook: document.querySelector('header')?.hasAttribute('data-loading-model') ?? false,
    };
  });
  check('本地模型区显示驻留状态', engineUi.resident && engineUi.idle);
  check('已移除「设为当前」', !engineUi.setCurrent);
  check('每个本地模型都有加载入口', engineUi.loadButtons >= 3, `buttons=${engineUi.loadButtons}`);
  check('显示 WASM 线程数', engineUi.threads);
  check('不再使用「已缓存」文案', !engineUi.cachedLabel);
  check('顶栏挂了加载进度', engineUi.headerHook);

  // fp32 for these repos is a 0.6MB graph plus a 2.1GB external-data blob,
  // past the size one Response can hold — WebGPU has to ask for fp16 instead.
  const backendSelect = page.locator('select').filter({ hasText: 'WebGPU' }).first();
  await backendSelect.selectOption('webgpu');
  await page.waitForTimeout(400);
  const gpuText = await page.locator('[data-model="bge-m3"]').innerText();
  check('WebGPU 请求 fp16 而不是 fp32', /· fp16/.test(gpuText) && !/fp32/.test(gpuText), gpuText.replace(/\n+/g, ' | ').slice(0, 90));
  const gpuSize = /约 ([\d.]+) (MB|GB)/.exec(gpuText);
  check('WebGPU 体积按 fp16 计', gpuSize?.[2] === 'GB', gpuSize?.[0] ?? '—');
  await backendSelect.selectOption('auto');
  await page.waitForTimeout(300);
  const cpuText = await page.locator('[data-model="bge-m3"]').innerText();
  check('WASM 体积按 int8 计', /543\.0 MB · int8/.test(cpuText), cpuText.replace(/\n+/g, ' | ').slice(0, 90));

  // The text workbench reads its engine from settings only.
  await page.goto(base + '/studio/text', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const textWorkbench = await page.evaluate(() => ({
    selects: document.querySelectorAll('select').length,
    hint: document.body.innerText.includes('在设置中更换'),
    engine: document.body.innerText.includes('云端 · deepseek-chat'),
  }));
  check('文本台没有引擎选择器', textWorkbench.selects === 0, `selects=${textWorkbench.selects}`);
  check('文本台指向设置页', textWorkbench.hint);
  check('文本台跟随设置中的模型', textWorkbench.engine);

  // Chat without credentials, in a fresh context: saving a key above would
  // send the request down the cloud path instead.
  await context.close();
  const ragContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  ragContext.setDefaultTimeout(12_000);
  ragContext.setDefaultNavigationTimeout(25_000);
  const rag = await ragContext.newPage();
  await rag.goto(base + '/studio/chat', { waitUntil: 'networkidle' });
  await rag.waitForTimeout(800);

  const engineLine = await rag.locator('body').innerText();
  check('未配置端点时引擎显示未配置', engineLine.includes('云端 · 未配置'));

  await rag.locator('input[placeholder^="资料标题"]').fill('旧书店营业时间');
  await rag
    .locator('textarea[placeholder^="粘贴需要记住的内容"]')
    .fill('这家旧书店只在夜里营业，晚上十点开门，凌晨两点关门。店里的灯是暖色的，书架是旧木头。');
  await rag.getByRole('button', { name: '入库' }).click();
  await rag.waitForTimeout(1200);
  check('知识库入库成功', (await rag.locator('body').innerText()).includes('旧书店营业时间'));

  await rag.locator('textarea[placeholder^="回车发送"]').fill('旧书店几点关门？');
  await rag.locator('textarea[placeholder^="回车发送"]').press('Enter');

  await rag
    .waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes('检索结果') || text.includes('没有找到相关片段');
      },
      null,
      { timeout: 20_000 },
    )
    .catch(() => undefined);

  const chat = await rag.evaluate(() => {
    const text = document.body.innerText;
    return {
      answered: text.includes('检索结果'),
      cites: /\[\d\]/.test(text),
      sources: text.includes('条来源'),
      mode: /retrieval only/i.test(text),
      empty: text.includes('没有找到相关片段'),
    };
  });
  check('对话返回检索结果', chat.answered, chat.empty ? '检索为空' : '');
  check('回答带引用编号', chat.cites);
  check('来源列表可见', chat.sources);
  check('未配置模型时标注 retrieval only', chat.mode);
  await rag.screenshot({ path: path.join(shots, '03-chat.png'), fullPage: false });

  // Re-creating a guest must work. The users store has a unique index on
  // `email`; guests used to be written with email: '', so the second guest hit
  // a ConstraintError and the UI could only say 无法创建访客会话.
  const uidOf = () =>
    rag.evaluate(() => {
      const text = document.querySelector('header')?.innerText ?? '';
      return text.trim().split('\n').pop()?.trim() ?? '';
    });
  const beforeGuest = await uidOf();
  await rag.locator('button[aria-label="退出登录"]').click();
  await rag.waitForTimeout(500);
  await rag.locator('[data-auth-gate]').getByRole('button', { name: /以访客身份继续/ }).click();
  await rag.waitForTimeout(1200);

  const guestState = await rag.evaluate(() => ({
    gate: document.querySelectorAll('[data-auth-gate]').length,
    refused: document.body.innerText.includes('无法创建访客会话'),
  }));
  const afterGuest = await uidOf();
  check(
    '退出后能再次以访客身份进入',
    guestState.gate === 0 && !guestState.refused && afterGuest !== beforeGuest,
    `gate=${guestState.gate} refused=${guestState.refused} uid=${afterGuest}`,
  );

  await ragContext.close();

  // Mobile pass.
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  mobile.setDefaultTimeout(12_000);
  mobile.setDefaultNavigationTimeout(25_000);
  const small = await mobile.newPage();
  await small.goto(base + '/#workspace', { waitUntil: 'networkidle' });
  await small.waitForTimeout(1400);

  const mobileMetrics = await small.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    dock: Boolean(document.querySelector('footer nav')),
    dockHeight: document.querySelector('footer nav')?.getBoundingClientRect().height ?? 0,
    top: Math.round(document.querySelector('div.snap-y')?.scrollTop ?? -1),
  }));
  check('移动端无横向溢出', mobileMetrics.overflow <= 1, `overflow=${mobileMetrics.overflow}`);
  check('移动端底部坞可见', mobileMetrics.dock && mobileMetrics.dockHeight > 20);
  check('移动端深链落在工作台', mobileMetrics.top > 100, `scrollTop=${mobileMetrics.top}`);
  await small.screenshot({ path: path.join(shots, '04-mobile.png') });

  await small.goto(base + '/studio/chat', { waitUntil: 'networkidle' });
  await small.waitForTimeout(900);
  const mobileChat = await small.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('移动端对话页无横向溢出', mobileChat <= 1, `overflow=${mobileChat}`);
  await small.screenshot({ path: path.join(shots, '05-mobile-chat.png') });

  await mobile.close();

  const realErrors = errors.filter((line) => !/favicon|manifest|Download the React DevTools/i.test(line));
  check('运行过程无控制台错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  await browser.close();
}

await ensureServer();
try {
  await run();
} catch (error) {
  record('执行中断', false, error instanceof Error ? error.message : String(error));
} finally {
  stopServer();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.log('失败项：');
  for (const item of failed) console.log(` - ${item.name}${item.detail ? ` (${item.detail})` : ''}`);
  process.exitCode = 1;
}
