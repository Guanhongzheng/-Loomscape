import { copyFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * transformers.js and onnxruntime ship as prebuilt browser bundles inside
 * node_modules. They are copied into public/runtime and loaded with a native
 * dynamic import, which keeps webpack out of the picture entirely — the
 * onnxruntime bundle uses import.meta and does not survive bundling.
 */
const files = [
  ['@huggingface/transformers', 'transformers.min.js'],
  ['@huggingface/transformers', 'ort-wasm-simd-threaded.jsep.wasm'],
  ['@huggingface/transformers', 'ort-wasm-simd-threaded.jsep.mjs'],
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
