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
  // Without 'wasm-unsafe-eval' every local model dies at instantiation with
  // "both async and sync fetching of the wasm failed". No page-level test
  // catches it, because nothing here downloads weights.
  const csp = home.headers.get('content-security-policy') ?? '';
  check('CSP 允许 wasm 编译', csp.includes("'wasm-unsafe-eval'"), csp.slice(0, 120));
  const scriptSrc = (csp.match(/script-src ([^;]+)/) ?? [])[1] ?? '';
  check(
    'CSP 使用 nonce 且脚本无 unsafe-inline',
    /'nonce-[^']+'/.test(scriptSrc) && !/'unsafe-inline'/.test(scriptSrc),
    scriptSrc.slice(0, 110),
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
  await page.waitForFunction(
    () => {
      const chrome = document.querySelectorAll('[data-intro-chrome].is-revealed').length;
      const slide = document.querySelectorAll('[data-slide-reveal].is-revealed').length;
      const boxes = Array.from(document.querySelectorAll('.weave-marquee'));
      return (
        chrome === 2 &&
        slide === 5 &&
        boxes.every((box) => Number(getComputedStyle(box).opacity) < 0.01)
      );
    },
    null,
    { timeout: 25_000 },
  );
  check('首页导航和首屏内容绘制完成', true);
  const introBuild = await page.evaluate(() => ({
    chrome: document.querySelectorAll('[data-intro-chrome].is-revealed').length,
    revealed: document.querySelectorAll('[data-slide-reveal].is-revealed').length,
    boxesHidden: Array.from(document.querySelectorAll('.weave-marquee')).every(
      (box) => Number(getComputedStyle(box).opacity) < 0.01,
    ),
    cursorsVisible: Array.from(document.querySelectorAll('.weave-cursor')).filter(
      (node) => Number(getComputedStyle(node).opacity) > 0.01,
    ).length,
    aiCursorVisible: Array.from(document.querySelectorAll('.ai-cursor, .cursor-mode-pointer')).some(
      (node) => Number(getComputedStyle(node).opacity) > 0.01,
    ),
    h1Visible: Boolean(document.querySelector('h1')?.checkVisibility()),
  }));
  check(
    '每块画完光标和选框一起消失',
    introBuild.chrome === 2 &&
      introBuild.revealed === 5 &&
      introBuild.boxesHidden &&
      introBuild.cursorsVisible === 0 &&
      introBuild.aiCursorVisible &&
      introBuild.h1Visible,
    `chrome=${introBuild.chrome} revealed=${introBuild.revealed} boxes=${introBuild.boxesHidden} cursors=${introBuild.cursorsVisible} ai=${introBuild.aiCursorVisible}`,
  );
  await page.waitForTimeout(400);

  const heroVisible = await page.locator('h1').first().isVisible();
  check('首屏渲染完成', heroVisible);
  await page.screenshot({ path: path.join(shots, '01-intro.png') });

  // The intro pager must be reachable from both the top tabs and the bottom
  // arrows/dots, not only by wheel gestures.
  const introIndex = () =>
    page
      .locator('[data-intro-index]')
      .getAttribute('data-intro-index')
      .then((value) => Number(value ?? -1));
  check('介绍页初始分区', (await introIndex()) === 0, `index=${await introIndex()}`);

  await page.getByRole('button', { name: '能力', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-intro-index]')?.getAttribute('data-intro-index') === '1',
  );
  check('介绍页顶部导航可点击', (await introIndex()) === 1);

  await page.getByRole('button', { name: '下一页' }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-intro-index]')?.getAttribute('data-intro-index') === '2',
  );
  check('介绍页下一页可点击', (await introIndex()) === 2);

  await page.getByRole('button', { name: '上一页' }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-intro-index]')?.getAttribute('data-intro-index') === '1',
  );
  check('介绍页上一页可点击', (await introIndex()) === 1);

  await page.getByRole('button', { name: '前往关于' }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-intro-index]')?.getAttribute('data-intro-index') === '3',
  );
  check('介绍页底部分页点可点击', (await introIndex()) === 3);

  await page.getByRole('button', { name: '前往简介' }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-intro-index]')?.getAttribute('data-intro-index') === '0',
  );
  check('介绍页可回到首屏', (await introIndex()) === 0);

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

  // Desktop navigation is a real rail; the five-item dock is now the phone
  // pattern and is checked in the mobile pass below.
  const nav = await page.evaluate(() => {
    const rail = document.querySelector('[data-shell-nav]');
    const box = rail?.getBoundingClientRect();
    return {
      aside: document.querySelectorAll('[data-shell-nav]').length,
      links: document.querySelectorAll('[data-shell-nav] nav a').length,
      railVisible: Boolean(box && box.width > 200 && box.right <= window.innerWidth + 1),
      header: Boolean(document.querySelector('header')),
    };
  });
  check('桌面侧栏存在且在视口内', nav.aside === 1 && nav.railVisible, `aside=${nav.aside}`);
  check('侧栏有五个入口', nav.links === 5, `links=${nav.links}`);
  check('顶部栏存在', nav.header);
  await page.screenshot({ path: path.join(shots, '02-workspace.png') });

  // Black-box click pass over the overview: the continue card and the four
  // workbench shortcuts must actually navigate, not just render as links.
  await page.locator('[data-overview="continue"] a[data-overview-link="continue"]').first().click();
  await page.waitForURL('**/studio/create**', { timeout: 8_000 });
  check('总览继续入口可点击', page.url().includes('/studio/create'), page.url());

  // Seed one project through IndexedDB, then verify the data-driven "continue"
  // card chooses the matching tool tab — not just the generic create route.
  // The main flow reaches the workspace as a guest; if the gate is still up
  // (fresh profile), accept it before looking for an owner id.
  const gate = page.locator('[data-auth-gate]');
  if (await gate.count()) {
    await gate.getByRole('button', { name: /以访客身份继续/ }).click();
    await page.waitForTimeout(900);
  }
  await page.waitForFunction(
    () => Boolean(document.querySelector('[data-user-id]')?.getAttribute('data-user-id')),
    null,
    { timeout: 10_000 },
  );
  const seeded = await page.evaluate(async () => {
    const owner = document.querySelector('[data-user-id]')?.getAttribute('data-user-id') ?? '';
    if (!owner) return false;
    return await new Promise((resolve) => {
      const request = indexedDB.open('loomscape');
      request.onsuccess = () => {
        try {
          const tx = request.result.transaction('projects', 'readwrite');
          tx.objectStore('projects').put({
            id: 'e2e-overview-image',
            owner,
            kind: 'image',
            title: 'E2E 封面稿',
            summary: '总览继续入口的夹具',
            payload: {},
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      };
      request.onerror = () => resolve(false);
    });
  });
  await page.goto(base + '/#workspace', { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => (document.querySelector('[data-overview="continue"]')?.textContent ?? '').includes('E2E 封面稿'),
    null,
    { timeout: 10_000 },
  );
  await page.locator('[data-overview-link="continue"]').click();
  await page.waitForURL('**/studio/create?tab=image**', { timeout: 8_000 });
  check(
    '总览继续上次指向对应工具',
    seeded && page.url().includes('tab=image'),
    `seeded=${seeded} url=${page.url()}`,
  );

  const overviewTargets = [
    ['01', '/studio/create'],
    ['02', '/studio/chat'],
    ['03', '/studio/social'],
    ['04', '/studio/settings'],
  ];
  let overviewClicks = 0;
  const failedOverview = [];
  for (const [index, route] of overviewTargets) {
    await page.goto(base + '/#workspace', { waitUntil: 'networkidle' });
    await page.waitForSelector(`[data-workbench="${index}"]`, { timeout: 10_000 });
    await page.locator(`[data-workbench="${index}"]`).click();
    try {
      await page.waitForURL('**' + route + '**', { timeout: 8_000 });
      overviewClicks += 1;
    } catch {
      failedOverview.push(`${index}→${route}`);
    }
  }
  check(
    '总览工作台卡片可点击',
    overviewClicks === 4,
    failedOverview.length ? failedOverview.join(' | ') : `ok=${overviewClicks}`,
  );

  // The rail is a second, always-present navigation surface. Walk all four
  // workbenches through it so a client-side transition cannot silently break.
  const rail = page.locator('[data-shell-nav] nav');
  const railTargets = [
    ['创作', '/studio/create'],
    ['对话', '/studio/chat'],
    ['社交', '/studio/social'],
    ['设置', '/studio/settings'],
  ];
  let railClicks = 0;
  for (const [label, route] of railTargets) {
    await rail.getByRole('link', { name: label, exact: true }).click();
    await page.waitForURL((url) => url.pathname === route, { timeout: 8_000 });
    railClicks += 1;
  }
  check('桌面侧栏点击跳转', railClicks === 4, `ok=${railClicks}`);

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

  // The segmented controls are the only way to switch engine, retrieval and
  // scheduling; mouse-only would strand anyone driving by keyboard.
  const scheduleTabs = page.locator('#scheduling [role="tablist"]');
  await scheduleTabs.locator('[role="tab"]').first().focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  const afterRight = await scheduleTabs
    .locator('[role="tab"]')
    .evaluateAll((nodes) => nodes.findIndex((node) => node.getAttribute('aria-selected') === 'true'));
  check('分段控件支持方向键', afterRight === 1, `index=${afterRight}`);
  // Put the profile back so later steps start from 均衡.
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);

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
      resident: text.includes('内存中'),
      idle: text.includes('内存中') && text.includes('无'),
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

  // The transcript used to live only in React state, so a reload lost it.
  await rag.reload({ waitUntil: 'domcontentloaded' });
  await rag.waitForTimeout(2200);
  const kept = await rag.evaluate(() => ({
    text: document.querySelector('main .overflow-y-auto')?.textContent ?? '',
    sessions: document.querySelectorAll('ul li[data-session]').length,
  }));
  check('刷新后对话仍在', kept.text.includes('旧书店几点关门？'), `len=${kept.text.length}`);
  check('会话列表保留一条', kept.sessions === 1, `rows=${kept.sessions}`);

  // Re-creating a guest must work. The users store has a unique index on
  // `email`; guests used to be written with email: '', so the second guest hit
  // a ConstraintError and the UI could only say 无法创建访客会话.
  const uidOf = () =>
    rag.evaluate(() => document.querySelector('[data-uid]')?.getAttribute('data-uid') ?? '');
  const beforeGuest = await uidOf();
  await rag.locator('button[aria-label="退出登录"]').first().click();
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
    dockLinks: document.querySelectorAll('footer nav a').length,
    dockHeight: document.querySelector('footer nav')?.getBoundingClientRect().height ?? 0,
    top: Math.round(document.querySelector('div.snap-y')?.scrollTop ?? -1),
  }));
  check('移动端无横向溢出', mobileMetrics.overflow <= 1, `overflow=${mobileMetrics.overflow}`);
  check(
    '移动端底部坞可见',
    mobileMetrics.dock && mobileMetrics.dockHeight > 20,
    `dock=${mobileMetrics.dock}`,
  );
  check('移动端底部坞有五个入口', mobileMetrics.dockLinks === 5, `links=${mobileMetrics.dockLinks}`);
  check('移动端深链落在工作台', mobileMetrics.top > 100, `scrollTop=${mobileMetrics.top}`);
  await small.screenshot({ path: path.join(shots, '04-mobile.png') });

  // The bottom dock is the only navigation surface on phones; click all the
  // way around it instead of merely counting links.
  const mobileDock = small.locator('footer nav');
  const dockTargets = [
    ['创作', '/studio/create'],
    ['对话', '/studio/chat'],
    ['社交', '/studio/social'],
    ['总览', '/'],
  ];
  let dockClicks = 0;
  for (const [label, route] of dockTargets) {
    await mobileDock.getByRole('link', { name: label, exact: true }).click();
    await small.waitForURL((url) => url.pathname === route, { timeout: 8_000 });
    dockClicks += 1;
  }
  check('移动端底部坞点击跳转', dockClicks === 4, `ok=${dockClicks}`);

  await small.goto(base + '/studio/chat', { waitUntil: 'networkidle' });
  await small.waitForTimeout(900);
  const mobileChat = await small.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('移动端对话页无横向溢出', mobileChat <= 1, `overflow=${mobileChat}`);
  await small.screenshot({ path: path.join(shots, '05-mobile-chat.png') });

  await mobile.close();

  // P0-3: locking the vault must clear the decrypted key from the endpoint
  // store and leave the chat page a way back to the passphrase field, instead
  // of quietly falling back to "未配置" (or, worse, using the stale key).
  const vaultContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  vaultContext.setDefaultTimeout(12_000);
  vaultContext.setDefaultNavigationTimeout(25_000);
  const vaultPage = await vaultContext.newPage();
  vaultPage.on('pageerror', (error) => errors.push(`vault pageerror: ${error.message}`));
  vaultPage.on('console', (message) => {
    if (message.type() === 'error') errors.push(`vault console: ${message.text()}`);
  });

  await vaultPage.goto(base + '/studio/settings', { waitUntil: 'networkidle' });
  await vaultPage.waitForTimeout(800);
  await vaultPage.locator('input[type="password"]').first().fill('sk-vault-e2e-key-1234');
  await vaultPage.getByRole('button', { name: '保存并使用', exact: true }).click();
  await vaultPage.waitForTimeout(900);

  await vaultPage.locator('input[aria-label="保险箱口令"]').fill('correct horse battery');
  await vaultPage.getByRole('button', { name: '启用', exact: true }).click();
  await vaultPage.waitForTimeout(1200);
  await vaultPage.getByRole('button', { name: '锁定', exact: true }).click();
  await vaultPage.waitForTimeout(800);

  await vaultPage.goto(base + '/studio/chat', { waitUntil: 'networkidle' });
  await vaultPage.waitForTimeout(900);
  const lockedUi = await vaultPage.evaluate(() => ({
    label: document.body.innerText.includes('云端 · 密钥保险箱已锁定'),
    notice: Boolean(document.querySelector('[data-vault-locked="true"]')),
    unlock: Array.from(document.querySelectorAll('a')).some(
      (anchor) =>
        anchor.textContent?.trim() === '去解锁' &&
        anchor.getAttribute('href') === '/studio/settings#vault',
    ),
  }));
  check('锁定后对话页标出待解锁', lockedUi.label && lockedUi.notice, JSON.stringify(lockedUi));
  check('锁定后给出解锁入口', lockedUi.unlock);

  const composer = vaultPage.locator('textarea[placeholder^="回车发送"]');
  await composer.fill('锁定时还能发吗？');
  await composer.press('Enter');
  await vaultPage.waitForTimeout(400);
  const blocked = await vaultPage.evaluate(() => ({
    kept: document.querySelector('textarea[placeholder^="回车发送"]')?.value ?? '',
    toast: document.body.innerText.includes('密钥保险箱已锁定'),
  }));
  check(
    '锁定态发送被拦下并保留草稿',
    blocked.kept === '锁定时还能发吗？' && blocked.toast,
    JSON.stringify(blocked),
  );

  await vaultPage.getByRole('link', { name: '去解锁' }).click();
  await vaultPage.waitForTimeout(700);
  const jumped = await vaultPage.evaluate(() => {
    const panel = document.querySelector('#vault');
    const box = panel?.getBoundingClientRect();
    return {
      hash: window.location.hash,
      panel: Boolean(panel),
      visible: Boolean(box && box.top >= -1 && box.top < window.innerHeight),
    };
  });
  check(
    '解锁入口跳到保险箱',
    jumped.hash === '#vault' && jumped.panel && jumped.visible,
    JSON.stringify(jumped),
  );
  await vaultPage.screenshot({ path: path.join(shots, '06-vault-locked.png') });

  await vaultContext.close();

  // AI cursor mode: native cursor hidden, shake opens the in-page menu,
  // highlight stays on the current spread, keyboard is a full alternative,
  // and Escape restores the native pointer.
  const cursorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  cursorContext.setDefaultTimeout(12_000);
  const cursorPage = await cursorContext.newPage();
  cursorPage.on('pageerror', (error) => errors.push(`cursor pageerror: ${error.message}`));
  cursorPage.on('console', (message) => {
    if (message.type() === 'error') errors.push(`cursor console: ${message.text()}`);
  });
  await cursorPage.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await cursorPage.waitForFunction(
    () =>
      document.querySelectorAll('[data-intro-chrome].is-revealed').length === 2 &&
      document.querySelectorAll('[data-slide-reveal].is-revealed').length >= 5,
    null,
    { timeout: 25_000 },
  );
  await cursorPage.waitForTimeout(300);
  const cursorInitial = await cursorPage.evaluate(() => ({
    mode: document.documentElement.classList.contains('cursor-ai-mode'),
    pointer: document.querySelector('.cursor-mode-pointer')?.classList.contains('is-visible'),
    cursor: getComputedStyle(document.body).cursor,
    pill: Boolean(document.querySelector('.cursor-mode-pill')),
  }));
  check(
    'AI 光标模式默认开启并隐藏原生鼠标',
    cursorInitial.mode && cursorInitial.pointer && cursorInitial.cursor === 'none' && cursorInitial.pill,
    JSON.stringify(cursorInitial),
  );

  await cursorPage.mouse.move(420, 440);
  await cursorPage.mouse.move(920, 440);
  await cursorPage.waitForTimeout(20);
  const motionState = await cursorPage.evaluate(() => {
    const cursor = document.querySelector('.cursor-mode-pointer');
    const style = cursor ? getComputedStyle(cursor) : null;
    const box = cursor?.getBoundingClientRect();
    return {
      offset: Number.parseFloat(style?.getPropertyValue('--cursor-offset') || '0'),
      x: box?.x ?? 0,
      tail: Boolean(document.querySelector('.cursor-mode-pointer__tail')),
    };
  });
  check(
    '划动时光标往反方向偏移',
    !motionState.tail && motionState.offset > 0 && motionState.offset <= 4.1 && motionState.x < 919.5,
    JSON.stringify(motionState),
  );
  await cursorPage.waitForTimeout(160);
  const motionSettled = await cursorPage.evaluate(() => {
    const cursor = document.querySelector('.cursor-mode-pointer');
    const box = cursor?.getBoundingClientRect();
    return {
      offset: Number.parseFloat(
        cursor ? getComputedStyle(cursor).getPropertyValue('--cursor-offset') || '0' : '0',
      ),
      x: box?.x ?? 0,
    };
  });
  check(
    '停下后立即对齐且不再晃动',
    motionSettled.offset === 0 && Math.abs(motionSettled.x - 920) < 0.75,
    JSON.stringify(motionSettled),
  );

  await cursorPage.mouse.move(700, 380);
  for (const x of [760, 700, 760, 700, 760]) {
    await cursorPage.mouse.move(x, 380);
    await cursorPage.waitForTimeout(55);
  }
  await cursorPage.waitForTimeout(200);
  const shakeState = await cursorPage.evaluate(() => ({
    menu: Boolean(document.querySelector('.cursor-mode-menu')),
    positioned: document.querySelector('.cursor-mode-menu')?.classList.contains('is-positioned'),
  }));
  check('晃动鼠标打开页内 AI 菜单', shakeState.menu && shakeState.positioned, JSON.stringify(shakeState));
  const layerState = await cursorPage.evaluate(() => {
    const pointer = document.querySelector('.cursor-mode-pointer');
    const menu = document.querySelector('.cursor-mode-menu');
    return {
      pointer: pointer ? Number.parseInt(getComputedStyle(pointer).zIndex, 10) : 0,
      menu: menu ? Number.parseInt(getComputedStyle(menu).zIndex, 10) : 0,
    };
  });
  check(
    'AI 光标位于菜单之上',
    layerState.pointer > layerState.menu,
    JSON.stringify(layerState),
  );
  await cursorPage.screenshot({ path: path.join(shots, '07-cursor-menu.png') });

  await cursorPage.getByRole('button', { name: '高亮标题' }).click();
  await cursorPage.waitForTimeout(800);
  const highlightState = await cursorPage.evaluate(() => ({
    highlight: document.querySelector('.cursor-mode-highlight')?.classList.contains('is-visible'),
    label: document.querySelector('.cursor-mode-highlight span')?.textContent || '',
    url: location.pathname,
  }));
  check(
    'AI 菜单高亮当前页标题',
    highlightState.highlight && highlightState.label.includes('AI 光标') && highlightState.url === '/',
    JSON.stringify(highlightState),
  );

  await cursorPage.keyboard.press('Alt+Shift+K');
  await cursorPage.waitForTimeout(200);
  check(
    '键盘可以打开 AI 菜单',
    await cursorPage.locator('.cursor-mode-menu').isVisible(),
  );

  // No model in the test environment: the same input must still be understood
  // by the local fallback instead of ending at "没听懂".
  await cursorPage.route('**/api/cursor/plan', (route) =>
    route.fulfill({
      status: 412,
      contentType: 'application/json',
      body: JSON.stringify({ error: '尚未配置文本模型' }),
    }),
  );
  const cursorComposer = cursorPage.locator('.cursor-mode-menu__composer input');
  await cursorComposer.fill('打开文本创作，写一个城市夜晚的提纲');
  await cursorComposer.press('Enter');
  await cursorPage.waitForURL('**/studio/create?tab=text', { timeout: 10_000 });
  await cursorPage.waitForTimeout(700);
  const understood = await cursorPage.evaluate(() => ({
    url: location.pathname + location.search,
    prompt: (document.querySelector('[data-cursor-id="create.prompt"]'))?.value ?? '',
    cursor: document.documentElement.classList.contains('cursor-ai-mode'),
  }));
  check(
    '对话框输入能被理解并执行',
    understood.url.includes('/studio/create?tab=text') &&
      understood.prompt.includes('城市夜晚') &&
      understood.cursor,
    JSON.stringify(understood),
  );
  check('AI 菜单可以打开站内文本创作', cursorPage.url().includes('/studio/create?tab=text'));

  await cursorPage.keyboard.press('Escape');
  await cursorPage.waitForTimeout(250);
  const cursorRestored = await cursorPage.evaluate(() => ({
    mode: document.documentElement.classList.contains('cursor-ai-mode'),
    cursor: getComputedStyle(document.body).cursor,
  }));
  check(
    'Escape 恢复原生鼠标',
    !cursorRestored.mode && cursorRestored.cursor !== 'none',
    JSON.stringify(cursorRestored),
  );
  await cursorContext.close();

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
