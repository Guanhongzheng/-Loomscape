'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useEndpoints, channelReady } from '@/lib/endpoint-store';
import { useAuth } from '@/lib/auth';
import { createShakeDetector } from '@/lib/cursor/shake';
import { sanitiseCursorPlan, type CursorAction } from '@/lib/cursor/actions';
import { runCursorActions, type CursorExecutionContext } from '@/lib/cursor/registry';
import { GEMMA_CURSOR_MODEL_ID, planWithCursorModel } from '@/lib/cursor/home-model';
import { localPlanFor } from '@/lib/cursor/local-plan';
import {
  cursorMemoryCount,
  cursorMemoryLines,
  rememberCursorTask,
} from '@/lib/cursor/memory';
import { findModel, useEngines, useModelRuntime } from '@/lib/engines';

const MODE_KEY = 'loom:cursor-mode';

const CURSOR_PATH = 'M3.5 2.5 19 11.5l-7 1.9L9.5 21 3.5 2.5Z';
const DEFAULT_STATUS = '晃一晃鼠标，或者直接说一句。';

function shortModelLabel(label: string): string {
  return label.replace(/\s+\d+(?:\.\d+)?[BM]$/i, '').trim() || label;
}

type Shape = 'arrow' | 'text' | 'hand';
type Activity = 'idle' | 'planning' | 'executing' | 'success' | 'error';

type Anchor = { x: number; y: number };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isEditable(target: EventTarget | null) {
  return target instanceof Element
    ? Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
    : false;
}

function visible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 2 && rect.height > 2 && style.visibility !== 'hidden' && style.display !== 'none';
}

function findTextTarget(raw: string): HTMLElement | null {
  const query = raw.replace(/^["'“”]+|["'“”]+$/g, '').trim().toLowerCase();
  if (!query) return null;
  const inViewport = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
  };
  const titleCandidates = Array.from(document.querySelectorAll<HTMLElement>('h1, h2')).filter(visible);
  if (query === '标题') {
    return titleCandidates.find(inViewport) || null;
  }
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'h1, h2, h3, [data-cursor-target], a, button, [role="button"], label, input, textarea',
    ),
  ).filter(visible);
  const match = (element: HTMLElement) => {
    const haystack = [
      element.getAttribute('data-cursor-label'),
      element.getAttribute('aria-label'),
      element.getAttribute('placeholder'),
      element.innerText,
      element.textContent,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  };
  return candidates.find((element) => inViewport(element) && match(element)) || candidates.find(match) || null;
}

function pageContext() {
  const headings = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3'))
    .filter(visible)
    .slice(0, 12)
    .map((element) => element.innerText.replace(/\s+/g, ' ').trim().slice(0, 100));
  const controls = Array.from(
    document.querySelectorAll<HTMLElement>('[data-cursor-id], main button, main a'),
  )
    .filter((element) => visible(element) && !element.closest('.cursor-mode-menu'))
    .slice(0, 30)
    .map((element) => ({
      id: element.getAttribute('data-cursor-id') || '',
      label:
        element.getAttribute('data-cursor-label') ||
        element.getAttribute('aria-label') ||
        element.innerText.replace(/\s+/g, ' ').trim().slice(0, 70),
      role: element.getAttribute('role') || element.tagName.toLowerCase(),
    }));
  return {
    path: `${window.location.pathname}${window.location.search}`,
    title: document.title,
    headings,
    controls,
  };
}

function fillPromptValue(value: string): boolean {
  const field =
    document.querySelector<HTMLTextAreaElement>('[data-cursor-id="create.prompt"]') ||
    document.querySelector<HTMLTextAreaElement>('textarea');
  if (!field) return false;
  field.focus({ preventScroll: true });
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export function CursorMode() {
  const router = useRouter();
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  const [finePointer, setFinePointer] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>({ x: 0, y: 0 });
  const [menuPos, setMenuPos] = useState({ left: 0, top: 0 });
  const [shape, setShape] = useState<Shape>('arrow');
  const [activity, setActivity] = useState<Activity>('idle');
  const [stepProgress, setStepProgress] = useState<{ done: number; total: number } | null>(null);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [statusTone, setStatusTone] = useState('');
  const [apiReady, setApiReady] = useState(false);
  const [memoryCount, setMemoryCount] = useState(0);
  const [toast, setToast] = useState('');
  const [hint, setHint] = useState(false);
  const [command, setCommand] = useState('');

  const enginePrefs = useEngines((state) => state.prefs);
  const textResidentId = useModelRuntime(
    (state) => state.residents.find((row) => row.task === 'text')?.modelId ?? '',
  );
  const preferredState = useModelRuntime((state) => state.models[enginePrefs.textModelId]?.state);
  const gemmaState = useModelRuntime((state) => state.models[GEMMA_CURSOR_MODEL_ID]?.state);
  const preferredModel = findModel(enginePrefs.textModelId);
  const readyModel =
    enginePrefs.textMode !== 'local'
      ? null
      : textResidentId
        ? findModel(textResidentId)
        : preferredState === 'ready'
          ? preferredModel
          : gemmaState === 'ready'
            ? findModel(GEMMA_CURSOR_MODEL_ID)
            : null;
  const modelLabel = readyModel
    ? shortModelLabel(readyModel.label)
    : apiReady
      ? 'API 模型'
      : '本地理解';
  const modelStatus = readyModel
    ? `${modelLabel} · 已加载`
    : apiReady
      ? 'API · 已配置'
      : '本地理解';

  const cursorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const pointRef = useRef<Anchor>({ x: 0, y: 0 });
  const enabledRef = useRef(false);
  const menuOpenRef = useRef(false);
  const selectedRef = useRef<HTMLElement | null>(null);
  const shakeRef = useRef(createShakeDetector());
  const shapeRef = useRef<Shape>('arrow');
  const lastMoveRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const settleTimerRef = useRef(0);
  const hintTimerRef = useRef(0);
  const toastTimerRef = useRef(0);
  const highlightTimerRef = useRef(0);
  const activityTimerRef = useRef(0);

  const markActivity = useCallback((next: Activity, resetAfter = 0) => {
    window.clearTimeout(activityTimerRef.current);
    setActivity(next);
    if (next !== 'executing' && next !== 'success') setStepProgress(null);
    if (resetAfter > 0) {
      activityTimerRef.current = window.setTimeout(() => {
        setActivity('idle');
        setStepProgress(null);
      }, resetAfter);
    }
  }, []);

  useEffect(() => {
    if (!useEngines.getState().loaded) void useEngines.getState().load();
  }, []);

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)').matches;
    const stored = window.localStorage.getItem(MODE_KEY);
    const next = stored === 'off' ? false : stored === 'ai' ? true : fine;
    setFinePointer(fine);
    setEnabled(next);
    enabledRef.current = next;
    const initial = { x: window.innerWidth * 0.55, y: window.innerHeight * 0.52 };
    pointRef.current = initial;
  }, []);

  const showStatus = useCallback((text: string, tone = '') => {
    setStatus(text);
    setStatusTone(tone);
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;
    menuOpenRef.current = menuOpen;
  }, [enabled, menuOpen]);

  const clearHighlight = useCallback(() => {
    window.clearTimeout(highlightTimerRef.current);
    selectedRef.current = null;
    highlightRef.current?.classList.remove('is-visible');
  }, []);

  const closeMenu = useCallback(() => {
    menuOpenRef.current = false;
    setMenuOpen(false);
    setPositioned(false);
    shakeRef.current.reset();
  }, []);

  const openMenuAt = useCallback((x: number, y: number) => {
    setAnchor({ x, y });
    setMenuOpen(true);
    menuOpenRef.current = true;
    setPositioned(false);
    showStatus(DEFAULT_STATUS);
    shakeRef.current.reset();
    setHint(false);
  }, [showStatus]);

  const disableMode = useCallback(() => {
    setEnabled(false);
    enabledRef.current = false;
    window.localStorage.setItem(MODE_KEY, 'off');
    closeMenu();
    clearHighlight();
    setHint(false);
  }, [clearHighlight, closeMenu]);

  const enableMode = useCallback(() => {
    if (!finePointer) {
      openMenuAt(window.innerWidth - 390, window.innerHeight - 260);
      return;
    }
    setEnabled(true);
    enabledRef.current = true;
    window.localStorage.setItem(MODE_KEY, 'ai');
    setHint(true);
  }, [finePointer, openMenuAt]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 2200);
  }, []);

  const showHighlight = useCallback(
    (element: HTMLElement, label: string) => {
      if (!element) return;
      clearHighlight();
      selectedRef.current = element;
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => {
        const box = highlightRef.current;
        if (!box) return;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const left = clamp(rect.left - 6, 2, window.innerWidth - 10);
        const top = clamp(rect.top - 6, 2, window.innerHeight - 10);
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${Math.max(8, rect.width + 12)}px`;
        box.style.height = `${Math.max(8, rect.height + 12)}px`;
        const labelEl = box.querySelector<HTMLElement>('[data-highlight-label]');
        if (labelEl) labelEl.textContent = label.slice(0, 46);
        box.dataset.below = top < 34 ? 'true' : 'false';
        box.classList.add('is-visible');
        highlightTimerRef.current = window.setTimeout(() => {
          box.classList.remove('is-visible');
          selectedRef.current = null;
        }, 3200);
      }, 420);
    },
    [clearHighlight],
  );

  const askPage = useCallback(() => {
    const title = document.title.replace(/\s*·\s*织境.*$/i, '').trim() || '当前页';
    const heading = document.querySelector<HTMLElement>('h1')?.innerText.replace(/\s+/g, ' ').trim();
    const links = document.querySelectorAll('a[href]').length;
    const buttons = document.querySelectorAll('button, [role="button"]').length;
    showStatus(
      `当前页「${title}」${heading ? `：${heading.slice(0, 72)}` : ''}。有 ${links} 个链接、${buttons} 个按钮。光标已经读完这一页，可以继续让它打开工具、高亮或跳转。`,
    );
  }, [showStatus]);

  const goTo = useCallback(
    (href: string, label: string) => {
      closeMenu();
      showToast(`AI 光标：${label}`);
      markActivity('success', 1400);
      router.push(href);
    },
    [closeMenu, markActivity, router, showToast],
  );

  const openTool = useCallback(
    (target: string) => {
      if (/文本|写作/.test(target)) return goTo('/studio/create?tab=text', '打开文本创作');
      if (/图像|图片/.test(target)) return goTo('/studio/create?tab=image', '打开图像创作');
      if (/视频|影像/.test(target)) return goTo('/studio/create?tab=video', '打开视频创作');
      if (/声音|音频/.test(target)) return goTo('/studio/create?tab=voice', '打开声音创作');
      if (/故事/.test(target)) return goTo('/studio/create?tab=story', '打开故事创作');
      if (/设置/.test(target)) return goTo('/studio/settings', '打开设置');
      if (/对话|聊天/.test(target)) return goTo('/studio/chat', '打开对话');
      if (/工作台|沙盒/.test(target)) return goTo('/studio', '打开工作台');
      if (/首页|简介/.test(target)) return goTo('/', '回到首页');
      showStatus(
        `还没有「${target.slice(0, 32)}」这个入口。试试文本、图像、视频、声音、设置或工作台。`,
        'error',
      );
      return undefined;
    },
    [goTo, showStatus],
  );

  const highlightCommand = useCallback(
    (target: string) => {
      const element = findTextTarget(target);
      if (!element) {
        showStatus(`没有在当前页找到「${target.slice(0, 32)}」。试试「高亮标题」或「高亮 进入工作台」。`);
        return;
      }
      closeMenu();
      showHighlight(element, element.getAttribute('data-cursor-label') || element.innerText || target);
      markActivity('success', 1400);
      showToast('AI 光标已高亮目标');
    },
    [closeMenu, markActivity, showHighlight, showStatus, showToast],
  );

  const scrollToCommand = useCallback(
    (target: string) => {
      const element = findTextTarget(target);
      if (!element) {
        showStatus(`没有找到「${target.slice(0, 32)}」。`);
        return;
      }
      closeMenu();
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      showHighlight(element, element.getAttribute('data-cursor-label') || target);
      markActivity('success', 1400);
      showToast('AI 光标已滚动到目标');
    },
    [closeMenu, markActivity, showHighlight, showStatus, showToast],
  );

  const navigateAndWait = useCallback(
    async (href: string) => {
      const target = new URL(href, window.location.origin);
      router.push(href);
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (window.location.pathname === target.pathname && window.location.search === target.search) {
          break;
        }
        await sleep(80);
      }
      await sleep(220);
    },
    [router],
  );

  const executePlanSteps = useCallback(
    async (steps: CursorAction[], label: string, task = '') => {
      closeMenu();
      markActivity('executing');
      setStepProgress({ done: 0, total: steps.length });
      showToast(`${label}规划 ${steps.length} 步，正在执行`);
      const context: CursorExecutionContext = {
        navigate: navigateAndWait,
        switchTab: async (tool) => {
          const button = document.querySelector<HTMLElement>(`[data-cursor-id="create.tab.${tool}"]`);
          if (!button) return false;
          button.click();
          await sleep(180);
          return true;
        },
        fillPrompt: async (value) => {
          for (let attempt = 0; attempt < 10; attempt += 1) {
            if (fillPromptValue(value)) return true;
            await sleep(100);
          }
          return false;
        },
        highlight: (target) => {
          const element = findTextTarget(target);
          if (!element) return false;
          showHighlight(element, element.getAttribute('data-cursor-label') || target);
          return true;
        },
        scrollTo: (target) => {
          const element = findTextTarget(target);
          if (!element) return false;
          element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          showHighlight(element, element.getAttribute('data-cursor-label') || target);
          return true;
        },
        askPage,
      };
      const result = await runCursorActions(steps, context, (done, total) => {
        setStepProgress({ done, total });
      });
      markActivity(result.ok ? 'success' : 'error', result.ok ? 1800 : 2200);
      if (result.ok && task) {
        rememberCursorTask(task, steps, `${window.location.pathname}${window.location.search}`);
        setMemoryCount(cursorMemoryCount());
        const owner = useAuth.getState().user?.id;
        if (owner) {
          const summary = `AI 光标：${task}（${steps.map((step) => step.action).join(' → ')}）`;
          void import('@/lib/memory')
            .then(({ remember }) => remember({ owner, kind: 'note', text: summary, tags: ['cursor'] }))
            .catch(() => undefined);
        }
      }
      showToast(
        result.ok
          ? `${label}完成 ${result.completed} 步`
          : `执行到第 ${result.completed + 1} 步：${result.error || '未完成'}`,
      );
      return result;
    },
    [askPage, closeMenu, markActivity, navigateAndWait, showHighlight, showToast],
  );

  const runModelCommand = useCallback(
    async (task: string) => {
      markActivity('planning');
      showStatus('正在让光标理解这句话…');
      try {
        const localSteps = await planWithCursorModel(
          task,
          pageContext(),
          cursorMemoryLines(),
        );
        if (localSteps?.length) {
          await executePlanSteps(localSteps, modelLabel, task);
          return;
        }

        showStatus(`${modelLabel === '本地理解' ? '本地模型未就绪' : modelLabel}未返回计划，尝试云端模型…`);
        const store = useEndpoints.getState();
        if (!store.loaded) await store.load();
        const ready = useEndpoints.getState();
        if (!channelReady(ready, 'text')) {
          throw new Error(
            readyModel
              ? `${modelLabel} 已加载，但这句任务没有生成可执行计划`
              : '本地模型未就绪，也没有可用文本模型',
          );
        }
        const endpoint = ready.endpoints.text;
        if (!endpoint?.baseUrl || !endpoint.model) {
          throw new Error('还没有配置文本模型');
        }
        const response = await fetch('/api/cursor/plan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            task,
            page: pageContext(),
            memory: cursorMemoryLines(),
            baseUrl: endpoint.baseUrl,
            apiKey: endpoint.apiKey,
            model: endpoint.model,
            wire: endpoint.shape,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          steps?: unknown;
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || `模型请求失败（${response.status}）`);
        const steps = sanitiseCursorPlan(data.steps, 5);
        if (!steps.length) throw new Error('模型没有返回可执行步骤');

        await executePlanSteps(steps, 'API 模型', task);
      } catch (error) {
        const fallback = localPlanFor(task);
        if (fallback.length) {
          await executePlanSteps(fallback, '本地理解', task);
          return;
        }
        markActivity('error', 2200);
        showStatus(
          `模型未接通：${error instanceof Error ? error.message : '规划失败'}。仍可使用「打开文本创作」「高亮标题」等本地指令。`,
          'error',
        );
      }
    },
    [executePlanSteps, markActivity, modelLabel, readyModel, showStatus],
  );

  const runCommand = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) {
        showStatus('先输入一句指令。', 'error');
        return;
      }
      if (/^(?:退出|关闭|退出光标模式|恢复鼠标)$/.test(text)) {
        disableMode();
        showToast('已恢复原生鼠标');
        return;
      }
      if (/问这页|总结|解释/.test(text)) {
        askPage();
        return;
      }
      // Compound or natural-language tasks go through the model planner. Simple
      // menu commands stay local so they remain instant and offline-friendly.
      if (/(?:，|,|。|然后|接着|并且|帮我|写一个|写一段|填写|填入|生成|规划)/.test(text)) {
        void runModelCommand(text);
        return;
      }
      let match = text.match(/^(?:高亮|标出|找到|定位)\s*(.+)$/);
      if (match) {
        highlightCommand(match[1]);
        return;
      }
      match = text.match(/^(?:滚动到|滚到|滚动至)\s*(.+)$/);
      if (match) {
        scrollToCommand(match[1]);
        return;
      }
      match = text.match(/^(?:打开|去|进入)\s*(.+)$/);
      if (match) {
        openTool(match[1]);
        return;
      }
      if (/文本|写作|图像|图片|视频|影像|声音|音频|故事|设置|对话|聊天|工作台|首页/.test(text)) {
        openTool(text);
        return;
      }
      void runModelCommand(text);
    },
    [
      askPage,
      disableMode,
      highlightCommand,
      openTool,
      runModelCommand,
      scrollToCommand,
      showStatus,
      showToast,
    ],
  );

  const submitCommand = (event?: FormEvent) => {
    event?.preventDefault();
    runCommand(command);
    setCommand('');
  };

  useEffect(() => {
    if (!menuOpen) return;
    setMemoryCount(cursorMemoryCount());
    let active = true;
    void (async () => {
      const store = useEndpoints.getState();
      if (!store.loaded) await store.load();
      if (!active) return;
      setApiReady(channelReady(useEndpoints.getState(), 'text'));
    })();
    return () => {
      active = false;
    };
  }, [menuOpen]);

  // Native pointer hiding and the initial custom cursor position.
  useEffect(() => {
    const root = document.documentElement;
    if (enabled && finePointer) root.classList.add('cursor-ai-mode');
    else root.classList.remove('cursor-ai-mode');
    return () => root.classList.remove('cursor-ai-mode');
  }, [enabled, finePointer]);

  useEffect(() => {
    if (!enabled || !finePointer) return;
    setHint(true);
    window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => setHint(false), 6000);
    const cursor = cursorRef.current;
    if (cursor) {
      const point = pointRef.current;
      cursor.style.transform = `translate3d(${Math.round(point.x)}px, ${Math.round(point.y)}px, 0)`;
      cursor.classList.add('is-visible');
    }
    return () => {
      window.clearTimeout(hintTimerRef.current);
      cursor?.classList.remove('is-visible');
    };
  }, [enabled, finePointer]);

  // Pointer tracking: while moving, the drawn pointer is nudged a few pixels
  // opposite the motion. When the real pointer stops, it snaps back to the
  // exact position immediately instead of gliding or wobbling afterward.
  useEffect(() => {
    if (!enabled || !finePointer) return;
    const cursor = cursorRef.current;
    if (!cursor) return;

    const MAX_OFFSET = 4;

    const applyPosition = (x: number, y: number, offset: number) => {
      cursor.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      cursor.style.setProperty('--cursor-offset', offset.toFixed(2));
      cursor.classList.add('is-visible');
    };

    const onMove = (event: PointerEvent) => {
      const target = event.target;
      const point = { x: event.clientX, y: event.clientY };
      pointRef.current = point;

      const nextShape: Shape = isEditable(target)
        ? 'text'
        : target instanceof Element && target.closest('a, button, [role="button"], [role="link"]')
          ? 'hand'
          : 'arrow';
      if (nextShape !== shapeRef.current) {
        shapeRef.current = nextShape;
        setShape(nextShape);
      }

      const now = performance.now();
      const previous = lastMoveRef.current;
      let offsetX = 0;
      let offsetY = 0;
      if (previous) {
        const dt = Math.max(8, Math.min(120, now - previous.t)) / 1000;
        const vx = (point.x - previous.x) / dt;
        const vy = (point.y - previous.y) / dt;
        const speed = Math.hypot(vx, vy);
        if (speed > 30) {
          const magnitude = Math.min(MAX_OFFSET, speed * 0.0028);
          offsetX = -(vx / speed) * magnitude;
          offsetY = -(vy / speed) * magnitude;
        }
      }
      lastMoveRef.current = { x: point.x, y: point.y, t: now };
      applyPosition(point.x + offsetX, point.y + offsetY, Math.hypot(offsetX, offsetY));

      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => {
        const latest = pointRef.current;
        lastMoveRef.current = null;
        applyPosition(latest.x, latest.y, 0);
      }, 90);

      if (event.buttons !== 0 || menuOpenRef.current || isEditable(target)) {
        shakeRef.current.reset();
        return;
      }
      if (shakeRef.current.feed(event.clientX, performance.now())) {
        openMenuAt(event.clientX, event.clientY);
      }
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.clearTimeout(settleTimerRef.current);
      lastMoveRef.current = null;
    };
  }, [enabled, finePointer, openMenuAt]);

  // Click feedback and click-outside close.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (enabled && finePointer) {
        const cursor = cursorRef.current;
        if (cursor) {
          cursor.classList.remove('is-clicking');
          void cursor.offsetWidth;
          cursor.classList.add('is-clicking');
          window.setTimeout(() => cursor.classList.remove('is-clicking'), 520);
        }
      }
      if (!menuOpenRef.current) return;
      if (menuRef.current?.contains(target as Node)) return;
      if (pillRef.current?.contains(target as Node)) return;
      closeMenu();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [closeMenu, enabled, finePointer]);

  // Keyboard fallback: shake is never the only way in or out.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && String(event.key).toLowerCase() === 'k') {
        event.preventDefault();
        if (!enabledRef.current) enableMode();
        const point = pointRef.current;
        window.setTimeout(
          () => openMenuAt(point.x || window.innerWidth * 0.55, point.y || window.innerHeight * 0.52),
          0,
        );
        return;
      }
      if (event.key !== 'Escape') return;
      if (menuOpenRef.current) {
        event.preventDefault();
        closeMenu();
      } else if (enabledRef.current) {
        event.preventDefault();
        disableMode();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [closeMenu, disableMode, enableMode, openMenuAt]);

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    if (!menuOpen || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const left = clamp(anchor.x + 16, 12, window.innerWidth - rect.width - 12);
    const top = clamp(anchor.y + 16, 12, window.innerHeight - rect.height - 12);
    setMenuPos({ left, top });
    setPositioned(true);
  }, [anchor, menuOpen, status]);

  useEffect(() => {
    if (!menuOpen) return;
    const timer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(timer);
  }, [menuOpen]);

  useEffect(() => {
    closeMenu();
    clearHighlight();
  }, [pathname, closeMenu, clearHighlight]);

  useEffect(() => {
    const onScroll = () => clearHighlight();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [clearHighlight]);

  useEffect(() => {
    return () => {
      window.clearTimeout(hintTimerRef.current);
      window.clearTimeout(toastTimerRef.current);
      window.clearTimeout(highlightTimerRef.current);
      window.clearTimeout(activityTimerRef.current);
    };
  }, []);

  const visibleMenu = menuOpen && (positioned || finePointer);
  const progressDeg =
    stepProgress && stepProgress.total > 0
      ? Math.round((stepProgress.done / stepProgress.total) * 360)
      : activity === 'success'
        ? 360
        : 0;
  const activityLabel =
    activity === 'planning'
      ? 'THINK'
      : activity === 'executing'
        ? stepProgress
          ? `${stepProgress.done}/${stepProgress.total}`
          : 'ACT'
        : activity === 'success'
          ? 'DONE'
          : activity === 'error'
            ? 'RETRY'
            : shape === 'hand'
              ? 'OPEN'
              : shape === 'text'
                ? 'TEXT'
                : 'READY';

  return (
    <>
      <div
        ref={cursorRef}
        aria-hidden="true"
        className={`cursor-mode-pointer ${enabled && finePointer ? 'is-visible' : ''}`}
        data-shape={shape}
        data-activity={activity}
        style={{ '--cursor-progress': `${progressDeg}deg` } as CSSProperties}
      >
        <span className="cursor-mode-pointer__aura" />
        <span className="cursor-mode-pointer__ring" />
        <span className="cursor-mode-pointer__orbit" />
        <span className="cursor-mode-pointer__progress" />
        <span className="cursor-mode-pointer__body">
          <svg className="cursor-mode-pointer__arrow" viewBox="0 0 24 24">
            <defs>
              <linearGradient id="cursor-copper-fill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="rgb(216 132 79)" />
                <stop offset="0.55" stopColor="rgb(185 102 55)" />
                <stop offset="1" stopColor="rgb(142 77 42)" />
              </linearGradient>
            </defs>
            <path
              d={CURSOR_PATH}
              fill="url(#cursor-copper-fill)"
              stroke="rgb(70 45 26 / 0.28)"
              strokeWidth="0.55"
              strokeLinejoin="round"
            />
            <path d="M4.5 4.8 8.7 17l1.8-4.3 4.2-1.1L4.5 4.8Z" fill="rgb(255 255 255 / 0.62)" />
            <circle cx="3.7" cy="2.7" r="0.95" fill="rgb(255 250 240 / 0.94)" />
          </svg>
          <span className="cursor-mode-pointer__tag">AI</span>
          <span className="cursor-mode-pointer__caption">{activityLabel}</span>
        </span>
        <span className="cursor-mode-pointer__beam" />
      </div>

      <div ref={highlightRef} className="cursor-mode-highlight" aria-hidden="true">
        <span data-highlight-label />
      </div>

      <button
        ref={pillRef}
        type="button"
        aria-pressed={enabled && finePointer}
        aria-label={enabled && finePointer ? 'AI 光标已开启，打开功能菜单' : '开启 AI 光标'}
        className={`cursor-mode-pill ${enabled && finePointer ? 'is-on' : ''}`}
        onClick={() => {
          if (!enabled || !finePointer) {
            enableMode();
            return;
          }
          const point = pointRef.current;
          if (menuOpenRef.current) closeMenu();
          else openMenuAt(point.x || window.innerWidth * 0.55, point.y || window.innerHeight * 0.52);
        }}
      >
        <span className="cursor-mode-pill__dot" />
        <span>{enabled && finePointer ? 'AI 光标' : 'AI 菜单'}</span>
        <span className="cursor-mode-pill__hint">{enabled && finePointer ? '摇一摇' : '开启'}</span>
      </button>

      {hint ? (
        <div className="cursor-mode-hint" role="status">
          晃一晃鼠标打开 AI 菜单 · <kbd>Esc</kbd> 恢复原生鼠标
        </div>
      ) : null}

      {toast ? (
        <div className="cursor-mode-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}

      {visibleMenu ? (
        <div
          ref={menuRef}
          className={`cursor-mode-menu ${positioned ? 'is-positioned' : ''}`}
          style={{ left: menuPos.left, top: menuPos.top }}
          role="dialog"
          aria-modal="false"
          aria-label="AI 光标功能菜单"
        >
          <div className="cursor-mode-menu__head">
            <span className="cursor-mode-menu__brand">
              <span className="cursor-mode-menu__dot" />
              AI CURSOR
            </span>
            <span
              className="cursor-mode-menu__model"
              data-ready={modelLabel !== '本地理解'}
              title={readyModel ? `当前光标模型：${readyModel.label}（已加载）` : modelStatus}
            >
              {modelStatus}
            </span>
            <span className="cursor-mode-menu__memory" title="AI 光标最近完成的任务">
              记忆 {memoryCount}
            </span>
            <span className="cursor-mode-menu__eyebrow">当前页</span>
            <button
              type="button"
              className="cursor-mode-menu__close"
              aria-label="关闭 AI 菜单"
              onClick={closeMenu}
            >
              ×
            </button>
          </div>
          <p className="cursor-mode-menu__status" data-tone={statusTone}>
            {status}
          </p>
          <form className="cursor-mode-menu__composer" onSubmit={submitCommand}>
            <input
              ref={inputRef}
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="说一句：打开文本创作，写一个城市夜晚的提纲"
              aria-label="让 AI 光标理解任务"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" aria-label="执行指令">
              执行
            </button>
          </form>
          <div className="cursor-mode-menu__chips">
            <button type="button" onClick={() => openTool('文本创作')}>
              文本创作
            </button>
            <button
              type="button"
              onClick={() => {
                closeMenu();
                const title = findTextTarget('标题');
                if (title) {
                  showHighlight(title, title.innerText || '标题');
                  showToast('AI 光标已高亮标题');
                } else {
                  showToast('当前页标题还没有出现，稍后再试。');
                }
              }}
            >
              高亮标题
            </button>
            <button type="button" onClick={askPage}>
              问这页
            </button>
            <button type="button" onClick={() => openTool('工作台')}>
              工作台
            </button>
          </div>
          <div className="cursor-mode-menu__foot">
            <span>晃一晃鼠标 / <kbd>Alt Shift K</kbd></span>
            <button type="button" onClick={() => { disableMode(); showToast('已恢复原生鼠标'); }}>
              退出光标模式
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
