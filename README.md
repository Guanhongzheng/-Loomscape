# 织境 Loomscape

一个面向创作者的多模态工作台：文本、图像、影像、声音、故事与对话收在同一个界面里，数据默认只写进浏览器。

## 快速开始

需要 Node 18.17 以上。

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>，工作台在第二屏，也可以直接访问 `/studio/create`。

生成服务不配也能用：文本台给结构草案，对话台只给检索片段，界面会标注来源。要接真模型，两种方式任选：

1. **在界面里配置**（推荐）：`/studio/settings` → 端点与模型 → 填 Base URL、模型、API Key。配置写在浏览器 IndexedDB，请求时随请求体转发，服务端不落盘。
2. **服务端环境变量**：复制 `.env.example` 为 `.env.local`，填 `OPENAI_*` / `IMAGE_*` / `SPEECH_*`；同一部署下的访问者共享这套凭据。

支持 OpenAI、Anthropic Claude、Google Gemini、智谱 GLM、DeepSeek 及任何 OpenAI 兼容端点；图像支持 OpenAI 与 Stability，语音转写兼容 Whisper，嵌入兼容 `POST /embeddings`。

生产构建与启动：

```bash
npm run build
npm start
```

测试都不需要联网，也不需要密钥：

```bash
npm run verify         # lint + 类型 + 单元，提交前跑这个
npm test               # 单元测试
npm run test:e2e       # 端到端，需先 npm run build
npm run check:runtime -- --model=qwen3-0.6b --backend=wasm
                       # 真实模型冒烟，默认拒绝下载，加 --allow-download 才下权重
```

## 功能

| 模块 | 能做什么 |
| --- | --- |
| 创作 · 文本 | 流式起草、工具调用（语气规则 / 字数测量 / 标题备选）、中断续写、归档、记忆召回 |
| 创作 · 图像 | 提示词出图、比例与数量、批量结果、下载与归档；未配端点时本地程序化构图 |
| 创作 · 影像 | 导入源片、播放走查、时间线裁切、拆分排序、导出片段清单 |
| 创作 · 声音 | 浏览器录音与实时波形、转写校对、浏览器朗读、语速与音色 |
| 创作 · 故事 | 分镜编排、挂接归档画面、Markdown 导出、存为作品 |
| 对话 | 多轮流式问答、知识库入库与检索、引用编号与来源列表 |
| 社交 | UID 通讯录、群组与群公告、消息收发与未读红点 |
| 设置 | 引擎与本地模型、四类端点、记忆管理、数据导出与清空 |

五个创作工具在 `/studio/create` 里用 Tab 切换，底部坞只有五个入口：总览 · 创作 · 对话 · 社交 · 设置。旧的 `/studio/text` 等路径仍可用，会跳转到对应 Tab。

**云端或本地。** 文本与嵌入各自可选云端 API 或浏览器内推理（transformers.js + ONNX）。本地文本有 Qwen3 0.6B / 4B、Llama 3.2 3B、Qwen2.5 1.5B、Gemma 3 270M，嵌入有 BGE Small / Base / M3；卡片上的体积与精度跟着后端走：WASM 只有 int8，WebGPU 文本可选 fp16 或 4 位（嵌入固定 fp16）。文本与嵌入两个会话可以同时驻留，超出内存预算时才卸载另一侧。

**检索带引用。** 资料按段落切块入库，提问时先算相似度取前 4 条，低于阈值直接丢弃；命中片段拼成编号上下文，回答里标注 `[n]`，来源列表会区分「被引用」与「没被引用」。

**数据留在本机。** 账户、作品、记忆与模型权重都在浏览器（IndexedDB + Cache Storage），换设备不同步；设置里可以导出 JSON 备份或一键清空。本地权重下载后写入缓存，断网也能起草与检索。

## 后续

- 服务端渲染与合片（ffmpeg 或云端转码队列）
- 跨设备账号与协作房间（WebSocket + 任务队列）
- 本地模型支持工具调用（需要模型具备 function calling 模板）
- 分片权重的断点续传（当前中断要重下整片）
- 超过 4GB 的本地模型（受 wasm32 限制，需要 WASM64 或 direct GPU weight loading）
- 对话历史与多会话管理（当前只保留在标签页内）
- 知识库支持文件导入（现在只有粘贴）
