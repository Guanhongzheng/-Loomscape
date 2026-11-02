import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Components are written for the automatic JSX runtime (what Next uses);
  // without this, esbuild emits `React.createElement` and every render test
  // dies on "React is not defined".
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
