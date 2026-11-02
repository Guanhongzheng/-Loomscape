# Memory64 架构设计

> 状态：**设计完成，闸门关闭**。代码里今天不会有第二条运行路径，因为浏览器还没放行
> （实测见下）。这份文档定义的是"放行那天怎么接"，以及在那之前 P0 能先落地的部分。

## 0. 先看约束

三行实测决定整个设计，任何一条变了都要重做判断：

| 事实 | 来源 | 影响 |
| --- | --- | --- |
| `WebAssembly.validate(memory64 模块)` = true，`new WebAssembly.Memory({index:'i64'})` 可建 | Edge 156 | 指令层已就绪，不是语法问题 |
| `initial` / `maximum` 超过 65536 页被拒，`grow` 停在 4.00GB | Edge 156 | **引擎仍封顶 4GB**，memory64 不带来容量 |
| ort-web 1.31.0-dev 只发 wasm32 产物；`onnxruntime_ENABLE_WEBASSEMBLY_MEMORY64` 是 CMake 开关，无 npm 产物 | 本机 dist 目录 / 上游 PR #21260 | 要用得自己编，且编完仍受上一条限制 |

结论：**memory64 的收益不在"更大"，在"等引擎放开后不用回头改架构"**。所以设计目标不是
今天跑 8GB 模型，而是让那天的改动收敛在一个开关里。

## 1. 分层

```
capabilities.ts   能力探测，唯一闸门
      │  flavor: 'wasm32' | 'wasm64'
      ▼
public/runtime/{wasm32,wasm64}/   产物目录，平级且互不覆盖
      │  wasmPaths = /runtime/<flavor>/
      ▼
local-runtime.ts  加载、驻留、驱逐（两把锁不变）
      │  resident.flavor
      ▼
engines.ts        预算按 flavor 求值，不再是一个常量
```

变化只发生在两处：`wasmPaths` 的目录、预算的取值。会话调度、缓存、UI 的"驻留"行都不动。

## 2. 能力探测（`src/lib/capabilities.ts`）

纯函数 + 一次探测，全部可在 node 里用假对象测：

```ts
export type WasmFlavor = 'wasm32' | 'wasm64';

export type Caps = {
  memory64: boolean;    // validate 一个 i64 内存模块
  largeMemory: boolean; // 能否 grow 到 4GB 以上——真正的闸门
  threads: boolean;     // crossOriginIsolated && SharedArrayBuffer
  webgpu: boolean;
  hostMemoryMB: number; // deviceMemory ?? 8192
};

export function probeCaps(): Caps;              // 结果缓存在模块作用域
export function pickFlavor(caps: Caps): WasmFlavor; // largeMemory ? 'wasm64' : 'wasm32'
```

三个要点：

- **闸门是 `largeMemory`，不是 `memory64`**。前者要求真的 `grow(65537)` 成功。Edge 156 上
  这条会抛，于是永远选 wasm32——这正是我们想要的行为，不需要靠判断浏览器版本。
- 探测必须廉价：一次 validate、一次构造、一次 grow。失败路径是抛异常，不占内存。
- `threads` 单独判。memory64 与共享内存的组合**未验证**，所以两个能力不许相乘推断。

## 3. 产物与加载

目录从「一拍平铺」改成两级，文件名保持 ORT 原样，这样 `wasmPaths` 一个变量就能切换：

```
public/runtime/
  wasm32/ort-wasm-simd-threaded.asyncify.{mjs,wasm}
  wasm64/ort-wasm-simd-threaded.asyncify.{mjs,wasm}
  manifest.json          # {flavor, ortVersion, buildId, files:[{name,bytes,sha256}]}
```

`manifest.json` 解决的是踩过的坑：胶水与二进制不同批构建时，
`WebAssembly.instantiate` 只报一句没信息的话。加载前比对 `buildId`，对不上就明确报错，
而不是让用户看到 `Aborted()`。

`local-runtime.ts` 的改动收敛为三行：

```ts
const flavor = pickFlavor(caps);
wasmBackend.wasmPaths = `/runtime/${flavor}/`;
wasmBackend.numThreads = caps.threads ? threadCount(task, sharing) : 1;
```

会话键要带上 flavor，否则回退后会命中旧的 64 位会话：

```ts
`${task}:${repo}:${dtype}:${backend}:${flavor}:${threads}`
```

## 4. 内存模型与预算

`engines.ts` 里的 `WASM_BUDGET_MB = 3400` 拆成按 flavor 求值的函数：

```ts
export function wasmBudgetMB(caps: Caps): number {
  if (pickFlavor(caps) === 'wasm32') return 3400;          // 现状，不动
  return Math.min(caps.hostMemoryMB * 0.6, 32768) - 1024;  // 64 位：留 40% 给页面与 GPU
}
```

峰值公式沿用 `base + 权重 × 系数`，但 64 位要加两笔：

- `RUNTIME_BASE_MB` 从 600 提到约 800：指针从 4 字节变 8 字节，ORT 的索引表、`size_t` 结构
  都会变大（**待标定**，不许拍脑袋写死）。
- 系数保持 3.0（int8 反量化副本 + 每线程 arena + KV 仍在同一堆里），64 位只影响地址宽度，
  不影响这几块的体积。**不要因为"内存变大了"就下调系数**——这是过去 1.7B 崩在 4.1GB 的原因。

MB 仍用 `number`。JS 安全整数到 9PB，权重偏移量不需要 BigInt；只在跨进 wasm 边界的
i64 参数上转 `BigInt`。

**实际收益区间**：×3 的放大决定了 64 位通道能吃的权重上限约为 `堆 / 3.5`。16GB 机器配
20GB 堆 → 权重 5GB 左右；再大的模型不是内存不够，是解码慢到不可用。所以 memory64 不是
"跑 70B"的方案，是"跑 4–8GB 级"的方案。

## 5. 权重搬运

现状：fetch 分片 → ArrayBuffer → ORT 复制进堆，峰值是「堆 + 单个分片」。分片上限 2GB，
所以峰值 = 权重×3 + 2GB。

64 位通道下这个暂存会成为主要浪费。理想做法是预分配权重区、边下边写：

```
[ ORT 堆 | 权重 arena（按分片顺序写入，偏移固定） | KV | 激活 ]
```

但 ORT 没有导出「在堆里分配 N 字节」的接口，`externalData` 又是整文件同步 `subarray`
挂载。所以**今天只能在 ORT 管理的堆里让它自己复制**，设计上分两步：

- **P2a（可做）**：`ort.env.wasm.wasmMemory` 支持外部传入 `WebAssembly.Memory`。由我们
  创建 64 位内存、切出 arena，再交给 ORT；arena 部分靠"永远不释放、只追加"来避免与
  ORT 分配器冲突。
- **P2b（需上游）**：ORT 暴露 arena / malloc 接口，才是真正的零拷贝。

在 P2 之前，预算必须按 `权重×3 + 2GB` 算，否则大模型会在加载阶段就撞墙。

## 6. 生命周期与降级

两把锁的语义不变：`serialised` 管加载/卸载/删除，`exclusive` 管同一会话推理。

新增的只有降级路径：

| 触发 | 处理 |
| --- | --- |
| `Aborted()` / `RangeError`（堆耗尽） | 记中断标记 → 卸载 → 置 `caps.largeMemory = false`（本次会话）→ 若模型能进 3.4GB 则用 wasm32 重试，否则报"内存不足" |
| 产物 404 / `buildId` 不符 | 退回 wasm32 目录；**不回退 CDN**，"断网可用"是产品承诺 |
| 探测抛异常 | 一律按 wasm32，不重试探测 |

## 7. 构建流水线

`scripts/build-ort-wasm64.mjs`（新增，默认拒绝执行，仿 `check:runtime` 的护栏）：

1. 固定 emsdk 版本与 ORT commit（不许用 `latest`，否则产物不可复现）
2. `--build_wasm --enable_wasm_simd --enable_wasm_threads --enable_wasm_memory64`
   （后者目前只在 CMake 层，`build.py` 可能要手工加 `--cmake_extra_defines`）
3. `-sMEMORY64=1`，注意所有 `pointer → int` 的转换都会在 64 位下失效
4. 产物落到 `public/runtime/wasm64/`，生成 `manifest.json`，算 sha256
5. `scripts/copy-ort.mjs` 巡检两个目录，缺 wasm64 不影响 wasm32 构建

发布物体积增加约 30MB（64 位代码段更大），只在 release 构建，PR 不跑。

## 8. 分期与验收

| 阶段 | 内容 | 验收 | 状态 |
| --- | --- | --- | --- |
| P0 | `capabilities.ts` + `pickFlavor` + 目录分层 + 会话键带 flavor | 单测覆盖三种 caps；Edge 156 上仍走 wasm32，行为零变化 | 可做 |
| P1 | wasm64 产物 + 加载路径 | 需要一台 `largeMemory` 为 true 的引擎；**当前无** | 阻塞 |
| P2a | 外部传入 `WebAssembly.Memory` + arena | 4GB 权重能加载，峰值不超过 `权重×3 + 512MB` | 待 P1 |
| P2b | 上游 arena 接口 | 零拷贝 | 需上游 |
| P3 | 目录里加 4–8GB 级模型 | 端到端跑通、断网可用 | 待 P2 |

P0 只做"把闸门装上"，不做任何未经证实的优化。它的价值是：那天来的时候，
改的是一个函数返回值，而不是重写运行时。

## 9. 风险与未验证项

- **引擎 4GB 上限**：已实测，不会因换编译目标消失。这是整个方案的前置条件。
- **memory64 + 共享内存**：未验证。若不可用，64 位通道只能单线程，解码慢 2–4 倍，
  可能反而不如 32 位多线程跑小模型。
- **transformers.js 的 i64 兼容性**：它不直接碰裸指针，理论上无感，但未验证；出问题会
  集中在 tokenizer / 张量形状的整数运算上。
- **代码体积**：+30%，首屏不受影响（懒加载），但离线缓存体积会涨。
- **ARTIFACT 复现性**：emsdk 版本漂移会让产物不可复现，必须锁死并在 CI 里记录 hash。

## 10. 不做什么

- 不为了让 64 位"看起来生效"而放宽 `WASM_BUDGET_MB`——在没有真产物时放宽，只会换来
  `Aborted()`。
- 不在 UI 里给 memory64 做开关。用户不该知道这个维度，闸门自己判。
- 不为 memory64 维护独立的分支代码路径；差异只允许出现在 `wasmPaths`、`numThreads`、
  `wasmBudgetMB` 三处。
