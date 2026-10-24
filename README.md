# 织境 Loomscape

一个面向创作者的多模态工作台：文字、画面、声音与时间放在同一个工作面里，从一句提纲起稿，在同一个地方收尾。

仓库当前是 v0.1，两页式结构——第一页横向翻阅产品介绍，继续向下滚动吸附到第二页：完整的工作台。两页在同一个文档里，数据默认只写进浏览器，不经过服务端。

## 现在能做什么

| 工作台 | 已实现 | 需要外部服务 |
| --- | --- | --- |
| 文本 | 流式起草、工具调用（语气规则/字数测量/标题备选）、中断续写、归档、记忆召回；可切本地模型 | 是（未配置时给结构草案） |
| 图像 | 提示词出图、比例与数量、批量结果、下载与归档 | 否（未配置时本地程序化构图） |
| 影像 | 导入源片、播放走查、时间线裁切、拆分排序、导出片段清单 | 否 |
| 声音 | 浏览器录音、实时波形、转写校对、浏览器朗读（TTS）、语速与音色 | 转写需要 |
| 故事 | 分镜编排、挂接归档画面、Markdown 导出、存为作品 | 否 |
| 社交 | UID 通讯录、群组、消息收发（同设备多标签通过 BroadcastChannel） | 否 |
| 设置 | AI 引擎（云端/本地）、四类端点、模型下载与进度、记忆管理、数据导出与清空 | — |

未配置端点时，文本工作台输出的是**结构草案**（立意、骨架、语气备选），不是伪造的模型结果——界面会明确标注。

## 引擎：云端与端侧

文本和嵌入各有两条路径，在设置页切换：

- **云端**：OpenAI、Anthropic Claude、Google Gemini、智谱 AI、DeepSeek，或任何兼容端点。各家用各自的协议（OpenAI 与 GLM、DeepSeek 走 chat completions，Claude 走 Messages API，Gemini 走 Generative Language API），由服务端按 `wire` 选择对应 SDK provider。
- **本地**：权重通过 transformers.js 在浏览器内运行，下载后断网可用。

| 模型 | 任务 | 体积 | 说明 |
| --- | --- | --- | --- |
| Qwen2.5 0.5B Instruct | 文本 | 约 760 MB | q4，WASM 推理，不支持工具调用 |
| BGE Small 中文 | 嵌入 | 约 24 MB | 512 维，中文短文本，冷启动最快 |
| E5 Small 多语 | 嵌入 | 约 118 MB | 384 维，中英混排 |
| BGE-M3 | 嵌入 | 约 570 MB | 1024 维，多语长文本，质量最好 |

下载源可切 **阿里 ModelScope**（国内直连）与 **HuggingFace**（官方）；两者使用同一份文件路径规则，切换后需要重新下载。下载过程有按文件的进度与字节数显示，权重存在浏览器 Cache Storage，可在设置页删除。

后端策略：默认走 **WASM + 量化权重**，体积最小、兼容性最好。选择 **WebGPU** 会改用 fp32 权重（约为量化的 4 倍体积）换取更快的推理；浏览器没有适配器时自动回落到 WASM。

## 快速开始

```bash
npm install
cp .env.example .env.local   # 可选，也可以直接在设置页里填
npm run dev
```

打开 <http://localhost:3000>。Node 18.17 以上。

生产构建：

```bash
npm run build
npm start
```

## 配置生成服务

两种方式，任选其一：

1. **在界面里配置**（推荐）：`/studio/settings` → 端点与模型 → 填 Base URL、模型、API Key → 保存。配置写在浏览器 IndexedDB，请求时随请求体转发，服务端不落盘。
2. **服务端环境变量**：复制 `.env.example` 为 `.env.local`，填 `OPENAI_*` / `IMAGE_*` / `SPEECH_*`。这样同一部署下的所有访问者共享一套凭据，适合内网或个人部署。

支持的协议：

- 文本：OpenAI、Anthropic Claude、Google Gemini、智谱 GLM、DeepSeek，或任何兼容 `POST /chat/completions` 的自建服务
- 嵌入：任何兼容 `POST /embeddings` 的服务（通义 text-embedding-v3/v4、OpenAI text-embedding-3-*）
- 图像：OpenAI `POST /images/generations`、Stability `POST /v2beta/stable-image/generate/sd3`
- 语音：Whisper 兼容 `POST /audio/transcriptions`

`/api/chat` 会把上游的 SSE 转成统一的 `delta` 事件，浏览器端只解析一种格式。

## 目录

```
src/
├── app/
│   ├── page.tsx                # 两页式入口：横向介绍 + 向下吸附的工作台
│   ├── studio/                 # 七个工作台页面（总览重定向回首页第二页）
│   └── api/                    # chat / embed / image / probe / transcribe / health
├── components/
│   ├── intro/                  # 织纹画布、纸飞机、四屏叙事
│   ├── studio/                 # 外壳、面板、工作台公共件
│   └── ui/                     # 按钮、输入、对话框、骨架屏
└── lib/
    ├── db.ts                   # IndexedDB 封装
    ├── auth.ts                 # 本地账户（PBKDF2）
    ├── engines.ts               # 引擎偏好与本地模型目录
    ├── local-runtime.ts         # transformers.js 加载、下载进度、推理
    ├── memory.ts               # 记忆召回（哈希 / 本地 / API 三种嵌入）
    ├── demo.ts                 # 离线结构草案与程序化构图
    ├── providers.ts            # 端点预设
    └── social.ts               # 通讯录与会话
```

## 几点设计说明

**拟态与纸面**。整体是浅色立体（neumorphism）：同一色相上做明暗双向投影，按下去阴影翻转为内凹。没有纯白卡片，也没有硬边框，层次靠光影而不是描边。

**织纹背景**。首页背景是一块用顶点着色器变形的线阵，44 条经线与 26 条纬线，鼠标位置会轻微把它拽向光标。用 three.js 手写，不引 R3F，首屏 JS 控制在 90KB 左右（gzip 前）。

**两页之间**。介绍页是 `overflow-x` 的吸附容器，外面再套一层 `overflow-y` 吸附容器。在第 4 屏继续向下滚时，滚轮事件不再被横向容器拦截，交给文档吸附到工作台；在工作台顶部继续向上滚，`overscroll` 会链回介绍页。`/studio` 重定向到 `/#workspace`，直接分享链接也能落到工作台。

**纸飞机**。位置由横向翻阅的滚动进度驱动，沿左下的起点飞到右上，末屏缩小消失。用 `left/top` 百分比而不是位移百分比——后者以元素自身尺寸为基准，会在窗口变化时跑偏。

**记忆**。不引入向量数据库，余弦相似度内存里算。嵌入有三档：哈希 n-gram（零依赖兜底）、本地模型（BGE / E5，端侧推理）、API（通义 / OpenAI）。不同引擎的向量空间不互通，记录里带 `embedder` 标记，切换后旧片段自动退出召回，不会拿两种向量硬比。

**端侧运行时**。transformers.js 与 onnxruntime 不从 CDN 拉，构建时复制进 `public/runtime`，用原生 `import()` 加载——webpack 无法处理 onnxruntime 内部的 `import.meta`。这样首屏不带这个包，只有真正启用本地模型时才加载。

**工具调用**。服务端用 AI SDK 的 `streamText` + `maxSteps: 3`，挂了三个纯函数工具：`style_guide`（语气规则）、`measure`（字数/段落/朗读时长）、`title_variants`（标题备选）。它们没有副作用，因此不需要在客户端回传结果。

**骨架屏**。首次进入的骨架直接写在服务端输出里，第一帧就是骨架而不是半成品页面；字体就绪后淡出，与最终 UI 的宽高严格对齐，避免切换时抖动。骨架只用 CSS 动画，不额外加载脚本。

## 已知边界

- 账号是**本机账户**，没有服务端用户表，换设备不会同步；清空浏览器数据即注销。
- 模型缓存在浏览器 Cache Storage 里，按 origin 隔离：换端口或域名要重新下载。
- 本地文本模型（0.5B/q4）在 CPU 上约 3–8 token/s，适合起稿不适合长文；本地模式不支持工具调用。
- 实时消息走 BroadcastChannel，限定同一设备的多个标签页。跨设备需要把 `social.ts` 的传输层换成 WebSocket。
- 影像只做工程层：记录片段区间并导出 JSON，不做服务端转码与合片。
- 社交没有服务端 UID 校验，任何符合格式的 UID 都能加进通讯录。
- `/api/*` 是转发路由：部署在公网时请为你的域名设置 `ALLOWED_ORIGINS`，并注意它只做内网地址拦截，不做限流。

## 后续

- 服务端渲染与合片（ffmpeg 或云端转码队列）
- 跨设备账号与协作房间（WebSocket + 任务队列）
- 本地模型支持工具调用（需要模型具备 function calling 模板）
- 模型分块下载与断点续传（当前由浏览器 Cache 与 fetch 流负责，大文件中断需重下）

## 许可

MIT
