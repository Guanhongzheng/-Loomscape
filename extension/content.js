/**
 * Loomscape AI Cursor - content script.
 *
 * MVP boundary:
 *  - top frame only
 *  - one user-issued task at a time
 *  - deterministic local command parser (no model call yet)
 *  - click, highlight, scroll, type; no background automation
 *  - dangerous clicks always need an explicit confirmation
 *
 * The module intentionally has no build step: `manifest.json` loads this file
 * directly. A small test API is exposed for Playwright under
 * `window.__loomAiCursor`.
 */

(() => {
  'use strict';

  const VERSION = '0.1.0';

  if (window.__loomAiCursor) {
    window.__loomAiCursor.open();
    return;
  }

  const CURSOR_PATH = 'M3.5 2.5 19 11.5l-7 1.9L9.5 21 3.5 2.5Z';
  const INTERACTIVE = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  const DANGER =
    /(删除|移除|清空|支付|付款|购买|下单|提交|发送|确认|注销|退出|重置|取消订阅|清空|delete|remove|pay|purchase|submit|send|confirm|reset|logout|unsubscribe)/i;
  const GENERIC_SUFFIX = /(按钮|链接|输入框|搜索框|框|选项|标签|菜单|入口)$/;

  const root = document.createElement('div');
  root.id = 'loom-ai-root';
  root.innerHTML = `
    <div class="loom-ai-cursor" data-cursor aria-hidden="true">
      <span class="loom-ai-cursor__ring"></span>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="${CURSOR_PATH}" fill="#a8703f" />
        <path d="M4.5 4.8 8.7 17l1.8-4.3 4.2-1.1L4.5 4.8Z" fill="rgb(255 255 255 / 0.7)" />
      </svg>
      <span class="loom-ai-cursor__tag">AI</span>
      <span class="loom-ai-cursor__caption">browser cursor</span>
    </div>
    <div class="loom-ai-highlight" data-highlight aria-hidden="true">
      <span class="loom-ai-highlight__label" data-highlight-label></span>
    </div>
    <div class="loom-ai-toast" data-toast role="status" aria-live="polite"></div>
    <button class="loom-ai-launcher" data-launcher type="button" aria-label="打开 Loomscape AI 光标">AI</button>
    <div class="loom-ai-panel" data-panel role="dialog" aria-modal="false" aria-label="Loomscape AI 光标">
      <div class="loom-ai-panel__head">
        <div class="loom-ai-panel__brand">
          <span class="loom-ai-panel__dot"></span>
          <strong>AI cursor</strong>
          <span>织境 · ${VERSION}</span>
        </div>
        <div class="loom-ai-panel__head-actions">
          <button class="loom-ai-icon-button" data-stop type="button" title="停止当前动作" aria-label="停止当前动作">■</button>
          <button class="loom-ai-icon-button" data-close type="button" title="关闭" aria-label="关闭">×</button>
        </div>
      </div>
      <div class="loom-ai-panel__body">
        <p class="loom-ai-panel__status" data-status role="status" aria-live="polite">说一句话，我只操作当前页面。</p>
        <div class="loom-ai-plan" data-plan aria-label="任务步骤"></div>
        <form class="loom-ai-panel__composer" data-form>
          <input data-input type="text" autocomplete="off" spellcheck="false" aria-label="给 AI 光标下指令" placeholder="例如：高亮 搜索框，或 点击 登录" />
          <button class="loom-ai-panel__send" data-send type="submit">执行</button>
        </form>
        <div class="loom-ai-panel__chips">
          <button class="loom-ai-chip" data-command="高亮 搜索框" type="button">高亮 搜索框</button>
          <button class="loom-ai-chip" data-command="点击 登录" type="button">点击 登录</button>
          <button class="loom-ai-chip" data-command="向下滚动" type="button">向下滚动</button>
        </div>
      </div>
      <div class="loom-ai-panel__foot">
        <span>只操作当前页 · 不后台运行</span>
        <span><kbd>Esc</kbd> 停止 / 关闭</span>
      </div>
    </div>
    <div class="loom-ai-confirm" data-confirm role="alertdialog" aria-modal="true" aria-labelledby="loom-confirm-title">
      <div class="loom-ai-confirm__card">
        <p class="loom-ai-confirm__eyebrow">Safety checkpoint</p>
        <h2 class="loom-ai-confirm__title" id="loom-confirm-title" data-confirm-title>确认这一步？</h2>
        <p class="loom-ai-confirm__body" data-confirm-body></p>
        <div class="loom-ai-confirm__actions">
          <button class="loom-ai-confirm__button" data-confirm-no type="button">取消</button>
          <button class="loom-ai-confirm__button" data-primary data-confirm-yes type="button">确认执行</button>
        </div>
      </div>
    </div>
  `;

  const $ = (selector) => root.querySelector(selector);
  const cursor = $('[data-cursor]');
  const highlight = $('[data-highlight]');
  const highlightLabel = $('[data-highlight-label]');
  const toastEl = $('[data-toast]');
  const panel = $('[data-panel]');
  const launcher = $('[data-launcher]');
  const input = $('[data-input]');
  const form = $('[data-form]');
  const send = $('[data-send]');
  const status = $('[data-status]');
  const planEl = $('[data-plan]');
  const confirmEl = $('[data-confirm]');
  const confirmTitle = $('[data-confirm-title]');
  const confirmBody = $('[data-confirm-body]');
  const confirmYes = $('[data-confirm-yes]');
  const confirmNo = $('[data-confirm-no]');

  document.documentElement.appendChild(root);

  const state = {
    open: false,
    busy: false,
    run: null,
    runId: 0,
    confirmResolver: null,
    toastTimer: 0,
    hideTimer: 0,
    snapshot: [],
    planNodes: [],
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[\u2018\u2019\u201c\u201d"'`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanTarget(value) {
    return String(value || '')
      .replace(/^["'“”‘’《「『]+|["'“”‘’》」』]+$/g, '')
      .replace(/^(?:这个|那个|页面上的|页面里的)\s*/, '')
      .trim();
  }

  function truncated(value, max = 72) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function setStatus(text, tone = '') {
    status.textContent = text;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  }

  function commandLabel(parsed) {
    const target = parsed.target ? cleanTarget(parsed.target) : '';
    switch (parsed.action) {
      case 'highlight':
        return `高亮 ${target}`;
      case 'click':
        return `点击 ${target}`;
      case 'scrollTo':
        return `滚动到 ${target}`;
      case 'scrollDown':
        return '向下滚动';
      case 'scrollUp':
        return '向上滚动';
      case 'type':
        return `填写 ${target || '输入框'}`;
      case 'inspect':
        return '读取页面';
      case 'stop':
        return '停止';
      default:
        return parsed.raw || '未识别步骤';
    }
  }

  function renderPlan(steps) {
    planEl.textContent = '';
    state.planNodes = [];
    if (!steps || steps.length <= 1) {
      planEl.classList.remove('is-visible');
      return;
    }
    steps.forEach((step, index) => {
      const row = document.createElement('div');
      row.className = 'loom-ai-plan__step';
      row.dataset.state = 'pending';
      const number = document.createElement('span');
      number.className = 'loom-ai-plan__index';
      number.textContent = String(index + 1).padStart(2, '0');
      const text = document.createElement('span');
      text.className = 'loom-ai-plan__text';
      text.textContent = commandLabel(step);
      row.append(number, text);
      planEl.appendChild(row);
      state.planNodes.push(row);
    });
    planEl.classList.add('is-visible');
  }

  function setPlanStep(index, stateName) {
    const row = state.planNodes[index];
    if (row) row.dataset.state = stateName;
  }

  function clearPlanSoon() {
    window.setTimeout(() => {
      if (!state.busy) {
        planEl.classList.remove('is-visible');
        planEl.textContent = '';
        state.planNodes = [];
      }
    }, 2600);
  }

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('is-visible');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => toastEl.classList.remove('is-visible'), 2200);
  }

  function setBusy(value) {
    state.busy = value;
    send.disabled = value;
    panel.dataset.busy = value ? 'true' : 'false';
  }

  function showCursor(x, y) {
    window.clearTimeout(state.hideTimer);
    cursor.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    cursor.classList.add('is-visible');
  }

  function hideCursor(delay = 0) {
    window.clearTimeout(state.hideTimer);
    const hide = () => cursor.classList.remove('is-visible');
    if (delay) state.hideTimer = window.setTimeout(hide, delay);
    else hide();
  }

  function cursorToRect(rect) {
    const x = clamp(rect.left + rect.width * 0.58, 8, window.innerWidth - 34);
    const y = clamp(rect.top + rect.height * 0.52, 8, window.innerHeight - 34);
    cursor.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    cursor.classList.add('is-visible');
  }

  function showHighlight(rect, label) {
    const pad = 5;
    const left = clamp(rect.left - pad, 2, window.innerWidth - 8);
    const top = clamp(rect.top - pad, 2, window.innerHeight - 8);
    const width = Math.max(8, Math.min(window.innerWidth - left - 4, rect.width + pad * 2));
    const height = Math.max(8, Math.min(window.innerHeight - top - 4, rect.height + pad * 2));
    highlight.style.left = `${left}px`;
    highlight.style.top = `${top}px`;
    highlight.style.width = `${width}px`;
    highlight.style.height = `${height}px`;
    highlightLabel.textContent = truncated(label, 48);
    highlight.dataset.below = top < 32 ? 'true' : 'false';
    highlight.classList.add('is-visible');
  }

  function hideHighlight(delay = 0) {
    if (delay) {
      window.setTimeout(() => highlight.classList.remove('is-visible'), delay);
      return;
    }
    highlight.classList.remove('is-visible');
  }

  function resetVisuals() {
    hideCursor();
    hideHighlight();
    cursor.classList.remove('is-clicking');
  }

  function wait(ms, token) {
    return new Promise((resolve, reject) => {
      if (token?.cancelled) {
        reject(new Error('__cancelled__'));
        return;
      }
      window.setTimeout(() => {
        if (token?.cancelled) reject(new Error('__cancelled__'));
        else resolve();
      }, ms);
    });
  }

  function ensureActive(token) {
    if (token?.cancelled) throw new Error('__cancelled__');
  }

  function safeEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    if (el.closest('[inert]')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.02) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }

  function textOf(el) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.getAttribute('aria-label') || el.placeholder || el.name || el.type || '';
    }
    return el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent || '';
  }

  function labelFor(el) {
    const labelledBy = el.getAttribute('aria-labelledby');
    let referenced = '';
    if (labelledBy) {
      const rootNode = el.getRootNode();
      referenced = labelledBy
        .split(/\s+/)
        .map((id) => rootNode.getElementById?.(id)?.textContent || '')
        .join(' ')
        .trim();
    }
    const labels =
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
        ? Array.from(el.labels || [])
            .map((label) => label.innerText || label.textContent || '')
            .join(' ')
            .trim()
        : '';
    const raw =
      el.getAttribute('aria-label') ||
      referenced ||
      labels ||
      el.getAttribute('title') ||
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? el.placeholder || el.name || el.type
        : '') ||
      el.innerText ||
      el.textContent ||
      el.tagName.toLowerCase();
    return truncated(raw, 64) || el.tagName.toLowerCase();
  }

  function roleFor(el) {
    return (
      el.getAttribute('role') ||
      (el.tagName === 'BUTTON'
        ? 'button'
        : el.tagName === 'A'
          ? 'link'
          : el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
            ? 'input'
            : el.tagName === 'SELECT'
              ? 'select'
              : '')
    );
  }

  function selectorFor(el) {
    if (el.id) {
      try {
        const idSelector = `#${safeEscape(el.id)}`;
        if (document.querySelectorAll(idSelector).length === 1) return idSelector;
      } catch {
        // fall through to a structural path
      }
    }
    for (const attr of ['data-testid', 'data-test', 'name', 'aria-label']) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      try {
        const selector = `${el.tagName.toLowerCase()}[${attr}="${value.replace(/"/g, '\\"')}"]`;
        if (document.querySelectorAll(selector).length === 1) return selector;
      } catch {
        // ignore invalid attribute values
      }
    }

    const parts = [];
    let node = el;
    while (node && node instanceof Element && parts.length < 5 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function snapshotElement(el) {
    const rect = el.getBoundingClientRect();
    const isInput = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    return {
      el,
      tag: el.tagName.toLowerCase(),
      role: roleFor(el),
      name: labelFor(el),
      text: truncated(textOf(el), 120),
      placeholder: isInput ? el.placeholder || '' : '',
      type: el instanceof HTMLInputElement ? el.type : '',
      disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      selector: selectorFor(el),
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }

  function collectInteractive() {
    const found = [];
    const visit = (scope) => {
      found.push(...scope.querySelectorAll(INTERACTIVE));
      for (const host of scope.querySelectorAll('*')) {
        if (host.shadowRoot) visit(host.shadowRoot);
      }
    };
    visit(document);
    return found
      .filter((el) => !root.contains(el) && isVisible(el))
      .slice(0, 160)
      .map(snapshotElement);
  }

  function publicSnapshot() {
    return collectInteractive().map(({ el, ...item }) => item);
  }

  function scoreTarget(item, query) {
    const q = normalize(query);
    if (!q) return 0;
    const compact = q.replace(GENERIC_SUFFIX, '');
    const haystacks = [item.name, item.text, item.placeholder, item.role]
      .map(normalize)
      .filter(Boolean);
    let best = 0;

    for (const hay of haystacks) {
      if (hay === q) best = Math.max(best, 140);
      else if (hay.startsWith(q)) best = Math.max(best, 105);
      else if (hay.includes(q)) best = Math.max(best, 80);
      else if (q.includes(hay) && hay.length >= 2) best = Math.max(best, 60);
      if (compact && compact !== q) {
        if (hay === compact) best = Math.max(best, 125);
        else if (hay.includes(compact)) best = Math.max(best, 72);
      }
    }

    const tokens = q.split(' ').filter(Boolean);
    if (tokens.length > 1 && tokens.every((token) => haystacks.some((hay) => hay.includes(token)))) {
      best = Math.max(best, 55);
    }
    if (q.includes('按钮') && item.tag === 'button') best += 5;
    if ((q.includes('链接') || q.includes('页面')) && item.tag === 'a') best += 5;
    if (q.includes('输入') && (item.tag === 'input' || item.tag === 'textarea')) best += 5;
    if (item.disabled) best -= 30;
    return best;
  }

  function findTarget(query, fallbackInteractive = true) {
    const items = collectInteractive();
    state.snapshot = items;
    const clean = cleanTarget(query);
    if (!clean) return fallbackInteractive ? items.find((item) => !item.disabled) || items[0] || null : null;

    let best = null;
    let bestScore = 0;
    for (const item of items) {
      const score = scoreTarget(item, clean);
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return bestScore >= 55 ? best : null;
  }

  function targetText(item) {
    return item ? truncateLabel(item.name || item.text || item.role || item.tag) : '目标';
  }

  function truncateLabel(value) {
    return truncated(value, 46) || '目标';
  }

  function isDangerous(item) {
    if (!item) return false;
    const text = `${item.name} ${item.text}`;
    if (DANGER.test(text)) return true;
    if (item.el instanceof HTMLButtonElement && item.el.type === 'submit' && item.el.form) return true;
    return false;
  }

  function parseCommand(raw) {
    const cleaned = String(raw || '')
      .trim()
      .replace(/^(?:帮我|请|麻烦)\s*/, '')
      .replace(/[。！!]+$/, '');
    if (!cleaned) return { action: 'empty' };
    if (/^(停止|停下|取消|stop)$/i.test(cleaned)) return { action: 'stop' };

    let match = cleaned.match(/^(?:高亮|定位|找到|指向|标出)\s*(.+)$/);
    if (match) return { action: 'highlight', target: match[1] };

    match = cleaned.match(/^(?:点击|点开|按下|点一下|打开)\s*(.+)$/);
    if (match) return { action: 'click', target: match[1] };

    match = cleaned.match(/^(?:滚动到|滚动至|滚到)\s*(.+)$/);
    if (match) return { action: 'scrollTo', target: match[1] };

    if (/^(?:向下滚动|往下滚|下滚)$/.test(cleaned)) return { action: 'scrollDown' };
    if (/^(?:向上滚动|往上滚|上滚)$/.test(cleaned)) return { action: 'scrollUp' };

    match = cleaned.match(/^填写\s*(.+?)\s*(?:为|：|:)\s*(.+)$/);
    if (match) return { action: 'type', target: match[1], value: match[2] };

    match = cleaned.match(/^在\s*(.+?)\s*(?:里|中)?\s*(?:输入|填写|填入|键入)\s*[：:]?\s*(.+)$/);
    if (match) return { action: 'type', target: match[1], value: match[2] };

    match = cleaned.match(/^(?:输入|填写|填入)\s*(.+)$/);
    if (match) return { action: 'type', target: '', value: match[1] };

    if (/^(?:读取页面|扫描页面|列出元素|看看页面)$/.test(cleaned)) return { action: 'inspect' };
    return { action: 'unknown', raw: cleaned };
  }

  function parsePlan(raw) {
    const text = String(raw || '').trim();
    if (!text) return [];
    const withoutPrefix = text.replace(/^(?:先|首先)\s*/, '');
    const segments = withoutPrefix
      .split(
        /\s*(?:[；;]\s*|\n+|\s*[，,]\s*(?=(?:然后|接着|之后|再|最后|首先))|\s+(?:然后|接着|之后)\s+)/,
      )
      .map((segment) =>
        segment
          .replace(/^(?:然后|接着|之后|再|最后|首先)\s*/, '')
          .replace(/^(?:第[一二三四五六七八九十]+步)\s*/, '')
          .trim(),
      )
      .filter(Boolean);
    if (segments.length <= 1) return [parseCommand(text)];
    return segments.map(parseCommand);
  }

  async function scrollTargetIntoView(item, token) {
    ensureActive(token);
    item.el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    await wait(360, token);
    ensureActive(token);
    return item.el.getBoundingClientRect();
  }

  async function moveTo(item, token) {
    const rect = await scrollTargetIntoView(item, token);
    ensureActive(token);
    cursorToRect(rect);
    showHighlight(rect, item.name);
    await wait(560, token);
    ensureActive(token);
    return rect;
  }

  async function requestConfirmation(title, body) {
    confirmTitle.textContent = title;
    confirmBody.textContent = body;
    confirmEl.classList.add('is-open');
    return new Promise((resolve) => {
      state.confirmResolver = resolve;
    });
  }

  function finishConfirmation(value) {
    confirmEl.classList.remove('is-open');
    const resolve = state.confirmResolver;
    state.confirmResolver = null;
    if (resolve) resolve(value);
  }

  async function runHighlight(item, token) {
    await moveTo(item, token);
    setStatus(`已高亮「${targetText(item)}」。`);
    await wait(2100, token);
    hideHighlight();
    hideCursor(280);
  }

  async function runScrollTo(item, token) {
    await moveTo(item, token);
    setStatus(`已滚动到「${targetText(item)}」。`, 'ok');
    await wait(1300, token);
    hideHighlight();
    hideCursor(260);
  }

  async function runClick(item, token) {
    const name = targetText(item);
    await moveTo(item, token);
    const dangerous = isDangerous(item);
    if (dangerous) {
      setStatus(`「${name}」可能提交、删除或发送内容，等待确认。`);
      const allowed = await requestConfirmation(
        `确认点击「${name}」？`,
        '这一步可能提交表单、发送消息或删除内容。确认后 AI 光标才会执行。',
      );
      if (!allowed) {
        hideHighlight();
        hideCursor(200);
        setStatus('已取消，没有点击。', 'ok');
        return false;
      }
      ensureActive(token);
    }

    const current = item.el.getBoundingClientRect();
    cursorToRect(current);
    cursor.classList.add('is-clicking');
    if (item.el instanceof HTMLElement) item.el.focus({ preventScroll: true });
    item.el.click();
    window.setTimeout(() => cursor.classList.remove('is-clicking'), 620);
    setStatus(`已点击「${name}」。`, 'ok');
    toast(`AI 光标点击了「${name}」`);
    await wait(900, token);
    hideHighlight();
    hideCursor(260);
    return true;
  }

  function editableFrom(item) {
    if (item?.el instanceof HTMLInputElement || item?.el instanceof HTMLTextAreaElement) return item.el;
    if (item?.el?.isContentEditable) return item.el;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return active;
    if (active instanceof HTMLElement && active.isContentEditable) return active;
    return document.querySelector('input:not([type="hidden"]), textarea, [contenteditable="true"]');
  }

  async function runType(item, value, token) {
    const target = item || findTarget('输入');
    const field = editableFrom(target);
    if (!field) throw new Error('当前页面没有输入框。');
    if (field instanceof HTMLInputElement && field.type === 'password') {
      throw new Error('密码字段不会被 AI 光标填写。');
    }

    const rect = field.getBoundingClientRect();
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await wait(300, token);
    ensureActive(token);
    cursorToRect(field.getBoundingClientRect());
    showHighlight(field.getBoundingClientRect(), labelFor(field));
    await wait(420, token);
    ensureActive(token);
    field.focus({ preventScroll: true });

    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(field, value);
      else field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      field.textContent = value;
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    }

    setStatus(`已填写「${labelFor(field)}」。`, 'ok');
    toast('AI 光标已填写输入框');
    await wait(800, token);
    hideHighlight();
    hideCursor(260);
  }

  function scrollByPage(direction, token) {
    showCursor(window.innerWidth - 110, window.innerHeight - 130);
    window.scrollBy({ top: direction * Math.round(window.innerHeight * 0.68), behavior: 'smooth' });
    setStatus(direction > 0 ? '已向下滚动一屏。' : '已向上滚动一屏。', 'ok');
    toast(direction > 0 ? 'AI 光标向下滚动' : 'AI 光标向上滚动');
    return wait(760, token).then(() => hideCursor(220));
  }

  async function inspectPage() {
    const items = publicSnapshot();
    setStatus(`当前页有 ${items.length} 个可操作元素。`, 'ok');
    toast(`发现 ${items.length} 个可操作元素`);
    return items;
  }

  async function executeStep(parsed, token) {
    switch (parsed.action) {
      case 'empty':
        setStatus('先输入一条指令。', 'error');
        return { ok: false, reason: 'empty' };
      case 'unknown':
        setStatus('还不够具体。试试「高亮 搜索框」「点击 登录」「向下滚动」。', 'error');
        return { ok: false, reason: 'unknown' };
      case 'inspect':
        await inspectPage();
        return { ok: true, action: 'inspect' };
      case 'scrollDown':
        await scrollByPage(1, token);
        return { ok: true, action: 'scrollDown' };
      case 'scrollUp':
        await scrollByPage(-1, token);
        return { ok: true, action: 'scrollUp' };
      case 'highlight': {
        setStatus(`正在寻找「${cleanTarget(parsed.target)}」…`);
        const item = findTarget(parsed.target);
        if (!item) throw new Error(`没有找到「${cleanTarget(parsed.target)}」。`);
        await runHighlight(item, token);
        return { ok: true, action: 'highlight', target: item.selector };
      }
      case 'click': {
        setStatus(`正在寻找「${cleanTarget(parsed.target)}」…`);
        const item = findTarget(parsed.target);
        if (!item) throw new Error(`没有找到「${cleanTarget(parsed.target)}」。`);
        const clicked = await runClick(item, token);
        return clicked
          ? { ok: true, action: 'click', target: item.selector }
          : { ok: false, reason: 'cancelled' };
      }
      case 'scrollTo': {
        setStatus(`正在寻找「${cleanTarget(parsed.target)}」…`);
        const item = findTarget(parsed.target);
        if (!item) throw new Error(`没有找到「${cleanTarget(parsed.target)}」。`);
        await runScrollTo(item, token);
        return { ok: true, action: 'scrollTo', target: item.selector };
      }
      case 'type': {
        const item = parsed.target ? findTarget(parsed.target, false) : null;
        if (parsed.target && !item) throw new Error(`没有找到「${cleanTarget(parsed.target)}」。`);
        await runType(item, parsed.value, token);
        return { ok: true, action: 'type', target: item?.selector || 'active' };
      }
      default:
        setStatus('这条指令还没有实现。', 'error');
        return { ok: false, reason: 'unsupported' };
    }
  }

  async function executeInternal(raw) {
    const command = String(raw || '').trim();
    if (!command) return { ok: false, reason: 'empty' };
    const steps = parsePlan(command);
    if (steps.length === 0) return { ok: false, reason: 'empty' };
    if (steps.length === 1 && steps[0].action === 'stop') {
      cancel('已停止。');
      return { ok: true, action: 'stop' };
    }
    if (state.busy) cancel('', false);

    const token = { cancelled: false };
    state.run = token;
    state.runId += 1;
    setBusy(true);
    resetVisuals();
    const multi = steps.length > 1;
    if (multi) {
      renderPlan(steps);
      setStatus(`任务共 ${steps.length} 步。`);
    } else {
      planEl.classList.remove('is-visible');
      state.planNodes = [];
    }

    try {
      const results = [];
      for (let index = 0; index < steps.length; index += 1) {
        ensureActive(token);
        const step = steps[index];
        if (step.action === 'stop') {
          cancel('已停止。');
          return { ok: true, action: 'stop' };
        }
        if (multi) {
          setPlanStep(index, 'active');
          setStatus(`步骤 ${index + 1}/${steps.length} · ${commandLabel(step)}`);
        }
        const result = await executeStep(step, token);
        results.push(result);
        if (!result.ok) {
          if (multi) {
            setPlanStep(index, 'error');
            setStatus(`第 ${index + 1} 步未完成：${result.reason || '未知原因'}`, 'error');
            clearPlanSoon();
          }
          return multi
            ? { ok: false, action: 'plan', steps: results, reason: result.reason }
            : result;
        }
        if (multi) setPlanStep(index, 'done');
      }

      if (multi) {
        setStatus(`任务完成：${steps.length} 步。`, 'ok');
        clearPlanSoon();
        return { ok: true, action: 'plan', steps: results };
      }
      return results[0];
    } catch (error) {
      if (error instanceof Error && error.message === '__cancelled__') {
        return { ok: false, reason: 'cancelled' };
      }
      if (multi) {
        const activeIndex = state.planNodes.findIndex((node) => node.dataset.state === 'active');
        if (activeIndex >= 0) setPlanStep(activeIndex, 'error');
        clearPlanSoon();
      }
      setStatus(error instanceof Error ? error.message : '执行失败。', 'error');
      return { ok: false, reason: error instanceof Error ? error.message : 'error' };
    } finally {
      if (state.run === token) {
        state.run = null;
        setBusy(false);
      }
      if (state.open) input.focus({ preventScroll: true });
    }
  }

  async function execute(raw) {
    const result = await executeInternal(raw);
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime
        .sendMessage({
          type: 'loom:task-finished',
          command: String(raw || ''),
          result,
          host: location.hostname,
          title: document.title,
        })
        .catch(() => {});
    }
    return result;
  }

  function cancel(message = '已停止。', closeConfirm = true) {
    if (state.run) {
      state.run.cancelled = true;
      state.run = null;
    }
    state.runId += 1;
    setBusy(false);
    resetVisuals();
    if (state.confirmResolver) finishConfirmation(false);
    if (closeConfirm) finishConfirmation(false);
    if (state.planNodes.length) clearPlanSoon();
    if (message) setStatus(message, 'ok');
  }

  function open() {
    if (state.open) {
      input.focus({ preventScroll: true });
      return;
    }
    state.open = true;
    panel.classList.add('is-open');
    launcher.style.display = 'none';
    setStatus('说一句话，我只操作当前页面。');
    const x = window.innerWidth - 110;
    const y = window.innerHeight - 120;
    showCursor(x, y);
    window.setTimeout(() => input.focus({ preventScroll: true }), 60);
  }

  function close() {
    if (state.busy) cancel('已停止。');
    state.open = false;
    panel.classList.remove('is-open');
    launcher.style.display = '';
    resetVisuals();
    finishConfirmation(false);
  }

  function toggle() {
    if (state.open) close();
    else open();
  }

  function submitCommand(value) {
    const command = String(value || input.value || '').trim();
    if (!command) return;
    input.value = command;
    void execute(command);
  }

  launcher.addEventListener('click', () => open());
  $('[data-close]').addEventListener('click', () => close());
  $('[data-stop]').addEventListener('click', () => cancel('已停止。'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitCommand(input.value);
  });
  for (const chip of root.querySelectorAll('[data-command]')) {
    chip.addEventListener('click', () => submitCommand(chip.dataset.command || ''));
  }
  confirmYes.addEventListener('click', () => finishConfirmation(true));
  confirmNo.addEventListener('click', () => finishConfirmation(false));

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.altKey && event.shiftKey && String(event.key).toLowerCase() === 'k') {
        event.preventDefault();
        toggle();
        return;
      }
      if (event.key !== 'Escape') return;
      if (state.confirmResolver) {
        event.preventDefault();
        finishConfirmation(false);
      } else if (state.busy) {
        event.preventDefault();
        cancel('已停止。');
      } else if (state.open) {
        event.preventDefault();
        close();
      }
    },
    true,
  );

  window.addEventListener(
    'scroll',
    () => {
      if (!state.busy) {
        hideHighlight();
      }
    },
    { passive: true },
  );

  window.__loomAiCursor = {
    version: VERSION,
    open,
    close,
    toggle,
    execute,
    stop: cancel,
    snapshot: publicSnapshot,
    getState: () => ({
      open: state.open,
      busy: state.busy,
      canConfirm: Boolean(state.confirmResolver),
      snapshotSize: state.snapshot.length,
    }),
    parse: parseCommand,
    plan: parsePlan,
  };

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message.type !== 'string') return false;
      if (message.type === 'loom:cursor-toggle') {
        toggle();
        sendResponse({ ok: true, open: state.open });
        return false;
      }
      if (message.type === 'loom:cursor-command') {
        execute(message.command).then((result) => sendResponse(result));
        return true;
      }
      if (message.type === 'loom:cursor-stop') {
        cancel('已停止。');
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === 'loom:cursor-snapshot') {
        sendResponse({ ok: true, items: publicSnapshot() });
        return false;
      }
      return false;
    });
  }
})();
