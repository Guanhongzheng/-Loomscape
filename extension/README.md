# Loomscape AI Cursor — Extension MVP

A visible browser cursor that can find, highlight, click, scroll and type on the
current page. This is the Phase 1 MVP described in the project plan.

> Scope of this MVP: **current tab only**, **user-initiated**, **local parser**,
> **no model call yet**, and **no background automation**. Dangerous clicks always
> require an explicit confirmation.

## Load it

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this `extension/` directory.
4. Open any normal web page.
5. Click the small **AI** puck in the bottom-right corner, use the extension
   toolbar button, or press `Alt+Shift+K`.

Everything stays in the current page. There is no separate extension task page.

Chrome does not allow content scripts on `chrome://`, `edge://`, or extension
pages. The launcher will not appear there.

## Commands

| Command | Result |
| --- | --- |
| `高亮 搜索框` | Find the target, scroll it into view, draw a selection box |
| `点击 登录` | Move the AI cursor to the target and click |
| `滚动到 页面底部` | Scroll a matching element into view |
| `向下滚动` / `向上滚动` | Scroll one viewport |
| `填写 搜索 为 猫` | Set the value of a matching input |
| `在 搜索框 输入 猫` | Same, target-first form |
| `读取页面` | Count visible interactive elements in the current page |
| `停止` / `Esc` | Stop the current action |

### Multi-step tasks

The local planner can chain explicit clauses. This is a queue, not a model yet:

```text
先高亮 搜索，然后填写 搜索 为 猫，最后点击 保存文章
```

Each step is shown in the panel timeline. If a dangerous step is cancelled, the
remaining steps do **not** run. `停止` / `Esc` cancels the entire queue.

The command bar also has quick chips. `Esc` closes the panel when idle.

## Safety rules in this MVP

- Click targets containing delete / remove / pay / purchase / submit / send /
  confirm / reset / logout / unsubscribe (Chinese equivalents included) open a
  confirmation dialog before clicking.
- Password inputs are refused outright.
- A cancelled danger step stops the remaining steps in a multi-step task.
- The overlay only runs in the top frame.
- The AI cursor cannot run in the background, on a timer, or without a command.
- `停止` and `Esc` cancel the current action.

## How it works

```text
background.js       toolbar / keyboard -> tab message, task history
content.js          overlay, page snapshot, target scoring,
                    click / type / scroll / highlight, local plan queue
content.css         cursor, selection box, command bar, confirmation
manifest.json       MV3 manifest (all URLs, current-tab scope)
```

The content script exposes a small test API at `window.__loomAiCursor`:
`open`, `close`, `toggle`, `execute`, `stop`, `snapshot`, `parse`, `getState`.
It is used by `scripts/test-extension.mjs` and is available for manual debugging.

### Deliberately local

The target finder is deterministic and runs in the page. It scores visible
interactive elements by accessible name, text, placeholder and role. Open shadow
roots are traversed. There is no network request in this MVP, so using the
extension does not send page content to a model. The in-page command bar is the
only UI; there is no separate extension page to open.

## Test

From the repository root:

```bash
npm run test:extension
```

The test mounts the real `content.js` and `content.css` in a Playwright page and
checks:

- API and launcher
- page snapshot, including open shadow roots
- highlight
- text input
- password refusal
- normal click
- dangerous click cancel and confirm
- scroll
- command parser and compound planner
- multi-step execution and timeline
- a cancelled danger step aborting the rest of the plan
- command bar submission

## Known limits (intentional for the current MVP)

- Top frame only; no iframes or closed shadow roots yet.
- Multi-step queue is local and explicit (`先…然后…最后`).
- The model planner is not exposed in the in-page UI yet.
- No vision fallback or multi-tab context.
- The selector is returned for debugging; actions use the live element reference.
- No icon asset or store packaging yet.
