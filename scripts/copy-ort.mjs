import { copyFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * transformers.js and onnxruntime ship as prebuilt browser bundles inside
 * node_modules. They are copied into public/runtime and loaded with a native
 * dynamic import, which keeps webpack out of the picture entirely — the
 * onnxruntime bundle uses import.meta and does not survive bundling.
 *
 * transformers 4.x no longer ships the wasm binary, only the 46KB JS glue, so
 * the pair is taken from onnxruntime-web. Both files must come from the same
 * build: the glue and the binary share an ABI, and a mismatch fails at
 * `WebAssembly.instantiate` with no useful message.
 */
const files = [
  ['@huggingface/transformers', 'transformers.min.js'],
  // 4.x imports the asyncify build by name (`Failed to fetch dynamically
  // imported module: /runtime/ort-wasm-simd-threaded.asyncify.mjs`), and it
  // serves both CPU and WebGPU sessions. The jsep pair is what 3.x wanted and
  // is no longer referenced, so it is not vendored — 28MB of dead weight.
  ['onnxruntime-web', 'ort-wasm-simd-threaded.asyncify.mjs'],
  ['onnxruntime-web', 'ort-wasm-simd-threaded.asyncify.wasm'],
];

const target = path.join(process.cwd(), 'public', 'runtime');

await mkdir(target, { recursive: true });

for (const [pkg, file] of files) {
  const from = path.join(process.cwd(), 'node_modules', pkg, 'dist', file);
  const to = path.join(target, file);

  if (!existsSync(from)) {
    console.warn(`[runtime] missing ${pkg}/dist/${file}`);
    continue;
  }
  if (existsSync(to)) {
    const [a, b] = await Promise.all([stat(from), stat(to)]);
    if (a.size === b.size) continue;
  }
  await copyFile(from, to);
  console.log(`[runtime] copied ${file}`);
}
