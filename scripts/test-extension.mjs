import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const contentJs = path.join(root, 'extension', 'content.js');
const contentCss = path.join(root, 'extension', 'content.css');
const shots = path.resolve(root, '..', '.artifacts', 'ui');
fs.mkdirSync(shots, { recursive: true });

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

let browser;
for (const channel of ['msedge', 'chrome']) {
  try {
    browser = await chromium.launch({ channel, headless: true });
    break;
  } catch {}
}
if (!browser) {
  console.error('No Chromium browser available');
  process.exit(1);
}

const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

await page.setContent(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Loom cursor test</title>
<style>
  body { margin: 0; font-family: sans-serif; background: #f5f0e8; color: #2b2721; }
  main { max-width: 680px; margin: 60px auto; padding: 0 24px 1600px; }
  h1 { font-size: 34px; }
  button, a { display: inline-block; margin: 6px 8px 6px 0; padding: 10px 14px; border: 1px solid #c9bfae; border-radius: 8px; background: #fffaf1; color: #2b2721; }
  input { display: block; margin: 16px 0; padding: 10px 12px; width: 280px; border: 1px solid #c9bfae; border-radius: 8px; }
  .note { color: #746c60; font-size: 13px; line-height: 1.8; }
</style></head>
<body>
<main>
  <p>Loomscape AI Cursor test page</p>
  <h1>可操作页面</h1>
  <button id="save">保存文章</button>
  <button id="delete">删除项目</button>
  <a id="docs" href="#docs">打开文档</a>
  <input id="search" placeholder="搜索项目" />
  <input id="password" type="password" placeholder="密码" />
  <p class="note">这是一个用于验证点击、高亮、输入、危险操作确认和滚动的本地页面。</p>
  <div id="shadow-host"></div>
  <div style="height: 1500px"></div>
  <p id="bottom">页面底部</p>
</main>
<script>
  window.__testClicks = { save: 0, delete: 0, shadow: 0 };
  document.getElementById('save').addEventListener('click', () => { window.__testClicks.save += 1; });
  document.getElementById('delete').addEventListener('click', () => { window.__testClicks.delete += 1; });
  const shadow = document.getElementById('shadow-host').attachShadow({ mode: 'open' });
  shadow.innerHTML = '<button id="shadow-save">保存影子</button>';
  shadow.getElementById('shadow-save').addEventListener('click', () => { window.__testClicks.shadow += 1; });
</script>
</body></html>`, { waitUntil: 'load' });

await page.addStyleTag({ path: contentCss });
await page.addScriptTag({ path: contentJs });
await page.waitForFunction(() => Boolean(window.__loomAiCursor), null, { timeout: 5000 });

check('content script exposes API', await page.evaluate(() => window.__loomAiCursor.version === '0.1.0'));
check('launcher is present', await page.locator('[data-launcher]').isVisible());

await page.locator('[data-launcher]').click();
await page.waitForTimeout(120);
check('panel opens', await page.locator('[data-panel]').evaluate((el) => el.classList.contains('is-open')));
check('AI cursor is visible', await page.locator('[data-cursor]').evaluate((el) => el.classList.contains('is-visible')));

const snapshot = await page.evaluate(() => window.__loomAiCursor.snapshot());
check('snapshot contains interactive elements', snapshot.length >= 5, `count=${snapshot.length}`);
check(
  'snapshot is serializable and excludes values',
  snapshot.some((item) => item.selector === '#search') && !JSON.stringify(snapshot).includes('secret'),
);

const highlightPending = page.evaluate(() => window.__loomAiCursor.execute('高亮 搜索'));
await page.waitForFunction(
  () => document.querySelector('[data-highlight]')?.classList.contains('is-visible'),
  null,
  { timeout: 5000 },
);
check('highlight box is visible', true);
check(
  'highlight label points at search',
  (await page.locator('[data-highlight-label]').textContent())?.includes('搜索项目') === true,
);
const highlightResult = await highlightPending;
check('highlight command succeeds', highlightResult.ok === true, JSON.stringify(highlightResult));

const typeResult = await page.evaluate(() => window.__loomAiCursor.execute('填写 搜索 为 猫'));
check('type command succeeds', typeResult.ok === true, JSON.stringify(typeResult));
check('input value is set', (await page.locator('#search').inputValue()) === '猫');

const passwordResult = await page.evaluate(() => window.__loomAiCursor.execute('填写 密码 为 secret'));
check(
  'password fields are refused',
  passwordResult.ok === false && (await page.locator('#password').inputValue()) === '',
  JSON.stringify(passwordResult),
);

const saveResult = await page.evaluate(() => window.__loomAiCursor.execute('点击 保存'));
check('non-dangerous click succeeds', saveResult.ok === true, JSON.stringify(saveResult));
check('save click was dispatched', (await page.evaluate(() => window.__testClicks.save)) === 1);

const deletePending = page.evaluate(() => window.__loomAiCursor.execute('点击 删除'));
await page.waitForSelector('[data-confirm].is-open', { timeout: 5000 });
check('dangerous click requests confirmation', true);
const confirmTitle = await page.locator('[data-confirm-title]').textContent();
check('confirmation names the target', confirmTitle?.includes('删除项目') === true, confirmTitle || '');
await page.locator('[data-confirm-no]').click();
const deleteCancelled = await deletePending;
check('cancel keeps the page untouched', deleteCancelled.ok === false && (await page.evaluate(() => window.__testClicks.delete)) === 0, JSON.stringify(deleteCancelled));

const deleteConfirmedPending = page.evaluate(() => window.__loomAiCursor.execute('点击 删除'));
await page.waitForSelector('[data-confirm].is-open', { timeout: 5000 });
await page.locator('[data-confirm-yes]').click();
const deleteConfirmed = await deleteConfirmedPending;
check('confirm executes the click', deleteConfirmed.ok === true && (await page.evaluate(() => window.__testClicks.delete)) === 1, JSON.stringify(deleteConfirmed));

await page.evaluate(() => window.scrollTo(0, 0));
const scrollResult = await page.evaluate(() => window.__loomAiCursor.execute('向下滚动'));
await page.waitForTimeout(900);
check('scroll command succeeds', scrollResult.ok === true && (await page.evaluate(() => window.scrollY)) > 400, JSON.stringify(scrollResult));

const parsed = await page.evaluate(() => ({
  click: window.__loomAiCursor.parse('点击 登录'),
  type: window.__loomAiCursor.parse('在 搜索框 输入 猫'),
  unknown: window.__loomAiCursor.parse('帮我做一件复杂的事情'),
  plan: window.__loomAiCursor.plan('先高亮 搜索，然后填写 搜索 为 狗，最后点击 保存文章'),
}));
check('parser handles click', parsed.click.action === 'click' && parsed.click.target === '登录');
check('parser handles type', parsed.type.action === 'type' && parsed.type.target === '搜索框' && parsed.type.value === '猫');
check('parser rejects unsupported request', parsed.unknown.action === 'unknown');
check(
  'planner splits compound instructions',
  parsed.plan.length === 3 &&
    parsed.plan[0].action === 'highlight' &&
    parsed.plan[1].action === 'type' &&
    parsed.plan[2].action === 'click',
  JSON.stringify(parsed.plan),
);

const shadowSnapshot = await page.evaluate(() => window.__loomAiCursor.snapshot());
check('snapshot reaches open shadow roots', shadowSnapshot.some((item) => item.name.includes('保存影子')));
const shadowResult = await page.evaluate(() => window.__loomAiCursor.execute('点击 保存影子'));
check(
  'shadow DOM click succeeds',
  shadowResult.ok === true && (await page.evaluate(() => window.__testClicks.shadow)) === 1,
  JSON.stringify(shadowResult),
);

const planResult = await page.evaluate(() =>
  window.__loomAiCursor.execute('先高亮 搜索，然后填写 搜索 为 狗，最后点击 保存文章'),
);
check(
  'multi-step plan executes in order',
  planResult.ok === true &&
    planResult.action === 'plan' &&
    planResult.steps.length === 3 &&
    (await page.locator('#search').inputValue()) === '狗' &&
    (await page.evaluate(() => window.__testClicks.save)) === 2,
  JSON.stringify(planResult),
);
check('plan timeline is visible', await page.locator('[data-plan]').evaluate((el) => el.classList.contains('is-visible')));
check('plan timeline has three rows', (await page.locator('[data-plan] .loom-ai-plan__step').count()) === 3);
await page.screenshot({ path: path.join(shots, 'extension-plan.png'), fullPage: false }).catch(() => {});

const deleteBeforePlan = await page.evaluate(() => window.__testClicks.delete);
const planCancelPending = page.evaluate(() =>
  window.__loomAiCursor.execute('先填写 搜索 为 鱼，然后点击 删除项目'),
);
await page.waitForSelector('[data-confirm].is-open', { timeout: 5000 });
await page.locator('[data-confirm-no]').click();
const planCancelled = await planCancelPending;
check(
  'danger cancel stops the remaining plan',
  planCancelled.ok === false &&
    (await page.evaluate(() => window.__testClicks.delete)) === deleteBeforePlan &&
    (await page.locator('#search').inputValue()) === '鱼',
  JSON.stringify(planCancelled),
);

await page.evaluate(() => window.__loomAiCursor.open());
await page.locator('[data-input]').fill('高亮 保存文章');
await page.locator('[data-send]').click();
await page.waitForTimeout(1200);
const commandStatus = await page.locator('[data-status]').textContent();
check('command bar submits commands', commandStatus?.includes('已高亮') === true, commandStatus || '');

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await page.screenshot({ path: path.join(shots, 'extension-test.png'), fullPage: false }).catch(() => {});
await browser.close();

const failed = checks.filter((entry) => !entry.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} extension checks passed`);
if (failed.length) process.exit(1);
