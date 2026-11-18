# 织境 Loomscape

> 面向创作者的多模态工作台：文本、图像、影像、声音、故事与对话收在同一个界面里，数据和模型权重默认留在浏览器。

Loomscape 是一个 **local-first** 的创作工作台：写作、配图、剪辑、配音、分镜和资料检索都在同一个页面完成。它不是一个需要先注册云账号的 SaaS；账户、作品、会话、记忆和端点配置默认写入本机 IndexedDB，模型权重写入 Cache Storage。换设备不会自动同步，断网也能继续使用已经缓存的能力。

- 仓库：<https://github.com/Guanhongzheng/-Loomscape>
- 版本：`0.8.0`
- 许可证：MIT

## 目录

- [先决条件](#先决条件)
- [快速开始](#快速开始)
- [技术栈和架构](#技术栈和架构)
- [安装 / 配置后的关键操作](#安装--配置后的关键操作)
- [危险或不可逆的操作](#危险或不可逆的操作)
- [测试与质量](#测试与质量)
- [仓库说明](#仓库说明)

## 先决条件

### 运行环境

| 项目 | 要求 |
| --- | --- |
| Node.js | **18.17 或更高**（`package.json` 的 `engines`） |
| 包管理器 | npm（仓库使用 `package-lock.json`） |
| 浏览器 | 最新版 Chrome / Edge 推荐；其他现代浏览器可退回 WASM |
| 端口 | 开发默认 `3000` |
| 磁盘 | 本地模型权重从数百 MB 到数 GB，预留足够空间 |
| 内存 | 本地文本与嵌入模型按可用内存加载，低内存设备建议用 WASM int8 |
| 网络 | 首次下载模型或调用云端 API 时需要；纯本地缓存后可离线 |

本地模型需要 **WebAssembly 多线程**，而浏览器只在 **cross-origin isolated** 页面暴露 `SharedArrayBuffer`。本项目的 `next.config.mjs` 已设置 `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`；如果放在 Nginx、Cloudflare 或其它反向代理后面，**不要把这些响应头去掉**，否则 WASM 线程和本地模型会退化为不可用或明显变慢。

WebGPU 只在支持的 Chromium 浏览器中启用；没有 WebGPU 时仍可使用 WASM。麦克风录音、语音转写需要浏览器授权麦克风权限（部署的 `Permissions-Policy` 已允许同源麦克风）。

### 凭据

云端模型不是必需的。没有配置端点时：

- 文本台返回结构草案；
- 对话台只返回本地检索片段，不伪造生成结果；
- 图像台使用本地程序化构图；
- 界面会明确标注「草稿」或「retrieval only」。

如果要接真实模型，可使用浏览器内配置，或部署级环境变量。两种方式见下一节。

## 快速开始

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>。

首页是五屏叙事（封面 + 创作 / 对话 / 底座 / 光标）。进入工作台需要登录或以访客身份继续；工作台位于 `/studio/*`，也可以直接访问 `/studio/create`。

### 可选：服务端默认凭据

```bash
cp .env.example .env.local
# Windows PowerShell:
# Copy-Item .env.example .env.local
```

然后填入需要的变量。**不要把 `.env.local` 提交到仓库。**

```dotenv
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-chat

IMAGE_BASE_URL=https://api.openai.com/v1
IMAGE_API_KEY=
IMAGE_MODEL=gpt-image-1

EMBED_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
EMBED_API_KEY=
EMBED_MODEL=text-embedding-v3

SPEECH_BASE_URL=https://api.openai.com/v1
SPEECH_API_KEY=
SPEECH_MODEL=whisper-1
```

`.env.local` 中的凭据是**同一部署下所有访问者共享的默认值**。用户在 `/studio/settings` 里填写的端点与密钥写入自己的浏览器 IndexedDB，请求时随请求体转发，服务端不落盘；浏览器内的配置优先于环境变量。

### 生产构建

```bash
npm run build
npm start
```

构建前会执行 `scripts/copy-ort.mjs`，把 ONNX Runtime 的 WASM 资源复制到 `public/runtime`。不要把 `public/runtime`、`.next` 或模型缓存提交进仓库。

## 技术栈和架构

### 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | Next.js 14 App Router + React 18 + TypeScript 5.7 |
| 样式 | Tailwind CSS 3.4，主题色与阴影集中在 `globals.css` / `tailwind.config.ts` |
| 状态 | Zustand（auth / endpoints / engines / unread 等），无服务端用户体系 |
| 动效 | Framer Motion；首页织线为 three.js 手写顶点着色器 |
| AI 流式 | Vercel AI SDK 4，统一 SSE `delta` 协议 |
| 端侧推理 | `@huggingface/transformers` + `onnxruntime-web`，WASM int8 / WebGPU fp16（文本另支持 q4f16） |
| 本地存储 | IndexedDB（业务数据与密钥）、Cache Storage（模型权重）、localStorage（会话与轻量偏好） |
| 检索 | 分块 → 嵌入 → 余弦相似度 top-4 → `[n]` 引用 |
| 协议 | 自带 MCP Server（JSON-RPC 2.0），四种纯函数工具 |
| 测试 | Vitest 单元测试 + Playwright-core 端到端 / 扩展 / 性能检查 |

### 分层

```text
浏览器 ── 几乎全部业务都在这里
├─ 视图      src/app/{page,studio/*} + src/components/{intro,studio,ui}
├─ 状态      src/lib/*（db / auth / memory / storage / projects / engines）
├─ 端侧 AI   src/lib/local-runtime.ts（ONNX 加载、缓存扫描、线程预算）
├─ 检索      src/lib/memory.ts + src/lib/rag.ts（分块、嵌入、召回、引用）
└─ 请求      /api/* 同构路由，只做鉴权转发、协议适配与服务端默认凭据
             ├─ chat / embed / image / transcribe / probe / health
             ├─ mcp      本项目 MCP Server 与工具
             └─ cursor/plan  AI 光标规划接口
```

### 数据流

1. **配置优先在浏览器**：端点、密钥、模型、记忆、作品、会话写入 IndexedDB；服务端只提供可选的共享默认值。请求体里的凭据优先。
2. **一种流式格式**：`/api/chat` 把各上游的 SSE 统一成 `delta` 事件，前端只解析一种协议。
3. **检索可回源**：资料按段落切块（带重叠）→ 嵌入入库 → 提问取余弦前 4 → 编号成上下文 → 回答里标 `[n]` → 来源列表区分「被引用」与「没被引用」。
4. **端云同一入口**：文本与嵌入各自可选云端 API 或浏览器内推理，切换只改引擎偏好，不改变调用方。

### 安全与部署边界

- 每次请求生成 CSP nonce；`script-src` 不允许 `unsafe-inline`。
- 页面启用 COOP/COEP，`/api/*` 有来源校验（`ALLOWED_ORIGINS` 可追加允许的来源）。
- 服务端不持久化用户业务数据，也不保存浏览器内填写的 API Key。
- MCP 端点只暴露纯函数工具，不读取用户作品、会话或记忆；仍然建议只部署在可信环境，避免公开暴露后被滥用。
- 浏览器内的 API Key 会随请求经过 `/api/chat` 等转发路由；这不是「密钥不出浏览器」的端到端加密，部署方仍应使用 HTTPS 和可信基础设施。

## 安装 / 配置后的关键操作

### 1. 建立身份

第一次进入工作台会弹出登录框：

- 输入邮箱和密码登录 / 注册；或
- 选择「以访客身份继续」。

账号和访客数据都只存在当前浏览器。退出登录只清除会话，不会删除作品；要删除数据请看[危险操作](#危险或不可逆的操作)。

### 2. 配置云端端点

进入 `/studio/settings` → 端点与模型：

1. 选择文本、图像、语音或嵌入通道；
2. 选择服务商预设或填自建 OpenAI 兼容端点；
3. 填写 Base URL、模型名和 API Key；
4. 保存并使用。

示例端点：

- OpenAI / DeepSeek / 智谱 GLM / 自建兼容服务；
- Anthropic Claude、Google Gemini 通过对应协议适配；
- 图像支持 OpenAI 与 Stability；
- 语音转写兼容 Whisper；
- 嵌入兼容 `POST /embeddings`。

文本通道可以点「测试连接」。图像、语音、嵌入端点建议在各自工作台做一次实际请求验证，因为它们的探活方式不同。

### 3. 加载本地模型

`/studio/settings` → 本地模型：

- 文本：Qwen3 0.6B / 4B、Llama 3.2 3B、Qwen2.5 1.5B、Gemma 3 270M；
- 嵌入：BGE Small / Base / M3。

加载后按后端显示体积与精度：WASM 只有 int8；WebGPU 文本可选 fp16 或 4 位，嵌入固定 fp16。文本与嵌入两个驻留会话可以同时存在，超出内存预算时才卸载另一侧。首次加载需要联网下载权重；之后从 Cache Storage 读取。

### 4. 更换嵌入模型或重建索引

在已有知识库的情况下切换嵌入模型，会弹出确认框：

- **仅切换**：旧资料保留原文，但在切回原模型前检索不到；
- **切换并重建**：逐篇重算向量，完成前旧资料检索不到，失败可重试，已完成部分不重跑。

重建会消耗时间和（使用云端嵌入时）费用。若只是临时换模型，可以选「仅切换」，之后在知识库面板手动「重建索引」。

### 5. 入库与带引用提问

进入 `/studio/chat` → 知识库面板：

1. 填写资料标题和正文；
2. 入库；
3. 在对话输入框提问；
4. 命中片段会带 `[n]`，来源列表区分已引用 / 未引用。

没有配置文本模型时，对话页只展示检索片段，并标注 `retrieval only`。

### 6. 使用五个创作工具

进入 `/studio/create`，用 Tab 切换：

- 文本：流式起草、语气 / 字数 / 标题工具、中断续写、归档、记忆召回；
- 图像：提示词、比例、数量、批量结果、下载与归档；
- 影像：导入源片、播放走查、时间线裁切、拆分排序、导出片段清单；
- 声音：录音、实时波形、转写校对、浏览器朗读、语速与音色；
- 故事：分镜编排、挂接归档画面、Markdown 导出、存为作品。

未配端点时界面使用草案 / 本地构图 / 检索片段降级，不会伪装成模型输出。

### 7. 使用 AI 光标

在首页或工作台：

- 晃动鼠标打开 AI 光标菜单；或按 `Alt+Shift+K`；
- 输入自然语言指令，例如「打开文本创作，写一个城市夜晚的提纲」；
- `Esc` 退出 AI 光标模式，恢复原生鼠标；
- 菜单可拖动，位置限制在浏览器视口内。

复杂指令优先交给已配置的云端模型，简单动作可由本地规则或本地模型完成；没有模型时会回退到本地指令解析。

### 8. 使用 MCP Server

端点：

```text
POST /api/mcp
Content-Type: application/json
```

支持：

- `server/discover`
- `tools/list`
- `tools/call`
- `initialize`（兼容旧客户端）

工具均为纯函数，不读取用户数据：

| 工具 | 作用 |
| --- | --- |
| `chunk_text` | 把长文切成带编号的段落 |
| `measure_text` | 统计字数、段落数、句长与预计朗读时长 |
| `title_variants` | 围绕主题生成中文标题备选 |
| `plan_cursor_actions` | 把自然语言拆成工作台动作 |

MCP 是可选能力；不使用外部客户端时无需额外配置。

### 9. 密钥保险箱

`/studio/settings` → 密钥保险箱：

- 启用口令后，已保存的 API Key 会被重新加密；
- 口令**不会保存**；
- 锁定后需要重新输入口令；
- 忘记口令只能重置保险箱（见下节）。

### 10. 备份

`/studio/settings` → 本地数据 → 「导出备份」会下载 JSON，包含当前浏览器中的业务数据表。建议在清空数据、换设备或大规模改配置前先导出。

## 危险或不可逆的操作

> **先导出备份。** 这个应用默认不做云同步；浏览器数据丢失后，服务端没有副本可以帮你恢复。

### 清空本地数据

路径：`/studio/settings` → 本地数据 → 「清空数据」→ 二次确认。

影响：

- 删除当前浏览器 IndexedDB 中的账户、作品、会话、记忆、端点和密钥记录；
- 退出登录并回到首页；
- **无法撤销**。

它不等于清理整个站点：已下载的模型权重在 Cache Storage 中，可能仍占用磁盘；需要彻底回收空间时，使用浏览器的「清除站点数据」。反过来说，清空浏览器站点数据会连模型缓存一起删除，之后要重新下载。

### 重置密钥保险箱

路径：`/studio/settings` → 密钥保险箱 → 「忘记口令？重置保险箱」→ 两段确认。

影响：

- 覆盖并删除已加密的密钥记录；
- 清空文本 / 图像 / 语音 / 嵌入四个通道已保存的 API Key；
- 清掉当前页面内存中的明文副本；
- **无法恢复**，只能重新填写密钥。

口令本身从不保存，因此忘记口令没有「找回」路径。重置是设计上的唯一出口。

### 更换嵌入模型

切换嵌入模型本身不会删除原文，但在重建完成前，旧向量无法用于检索：

- 选「仅切换」且不重建：旧资料暂时搜不到；
- 选「切换并重建」：重建期间检索不可用，云端嵌入会产生费用；
- 重建失败可重试，已完成部分不会重跑。

这是可逆的（切回原模型或重建完成即可恢复检索），但不要在重要检索前临时切换。

### 删除作品、会话或记忆

工作台内的单条删除、清空全部记忆、清空数据都是本地删除，**没有回收站**。删除前先导出备份。

### 退出登录

「退出登录」只删除会话标记并返回首页，**不会删除**账户、作品或密钥。访客身份退出后，原来的访客数据仍保存在浏览器中；要彻底清理请使用「清空数据」。

### 运行时下载与公网 MCP

- `npm run check:runtime -- --model=... --allow-download` 会真的下载模型权重到缓存，可能占用数 GB；默认不带该参数时不会下载。
- MCP 端点没有用户级鉴权，只有来源校验和纯函数工具；不要在没有额外访问控制的情况下公开到公网。
- 环境变量中的 API Key 是部署级共享凭据；不要把 `.env.local` 提交到 Git，也不要在共享部署中放入个人长期密钥。

## 测试与质量

测试不需要联网或真实密钥：

```bash
npm run verify         # lint + typecheck + 单元测试，提交前跑这个
npm test               # 仅单元测试
npm run test:e2e       # 端到端，需要先 npm run build
npm run test:extension # 浏览器扩展检查
npm run test:perf      # 构建后的性能预算检查
```

本地模型冒烟测试默认拒绝下载权重：

```bash
npm run check:runtime -- --model=qwen3-0.6b --backend=wasm
# 确认要下载时再加：
npm run check:runtime -- --model=qwen3-0.6b --backend=wasm --allow-download
```

端到端脚本会自行启动本地 Next 服务，使用独立端口，不依赖已经运行的开发服务器。性能检查默认预算见 `scripts/perf.mjs`，可用 `PERF_*` 环境变量调整。

## 仓库说明

### 这是什么

Loomscape 是一个比赛 / 作品集导向的 **AI WEB 创作工作台**：用浏览器把多模态创作、端侧模型、RAG、AI 光标和 MCP 串成一个可演示、可离线降级的完整产品。

### 这不是什么

- 不是云同步网盘：没有服务端用户数据库，换设备不会自动同步；
- 不是模型训练平台：只做推理与编排；
- 不是「没配模型也假装有结果」的演示：未配置时会明确标注降级来源；
- 不是只支持某一家模型：端点走 OpenAI 兼容协议，另有 Anthropic / Gemini 适配。

### 主要目录

```text
src/
├─ app/                 Next.js 路由
│  ├─ page.tsx          首页五屏叙事 + 工作台入口
│  ├─ studio/           总览、创作、对话、社交、设置
│  └─ api/              chat / image / embed / transcribe / mcp / cursor
├─ components/
│  ├─ intro/            封面、四屏介绍、首页背景
│  ├─ studio/           工作台壳、总览、创作工具、设置面板
│  ├─ cursor/           AI 光标、菜单、动作反馈
│  └─ ui/               按钮、输入、对话框等基础组件
├─ lib/
│  ├─ cursor/           意图规划与动作注册表
│  ├─ mcp/              MCP 协议与工具
│  ├─ server/           上游请求、消息与来源校验
│  ├─ db.ts             IndexedDB 封装
│  ├─ auth.ts           本地账户 / 访客会话
│  ├─ engines.ts        模型目录与驻留策略
│  ├─ local-runtime.ts  ONNX / WebGPU / WASM 运行时
│  ├─ memory.ts         RAG 入库、检索与重建
│  └─ vault.ts          API Key 保险箱
└─ scripts/             构建辅助、E2E、性能、扩展、运行时冒烟
```

### 状态

- 首页、工作台、AI 光标、本地模型、RAG、MCP 和扩展检查均已实现；
- 测试覆盖单元、端到端、扩展与性能预算；
- 仍在快速迭代，界面和数据结构可能随版本变化；升级前请先导出备份。

### 贡献

提交前至少运行：

```bash
npm run verify
npm run test:e2e
```

请勿提交 `.env.local`、`public/runtime`、`.next`、`.artifacts`、模型权重、截图或本地备份 JSON。

## License

MIT。详见 [LICENSE](./LICENSE)。
