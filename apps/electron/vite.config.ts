import { defineConfig } from 'electron-vite'
import { resolve } from 'path'

// Packages shimmed or optional — mark as external
const shimPatterns = [
  /^@anthropic-ai\//,
  /^@ant\//,
  /^bun:/,
  /^image-processor-napi$/,
  /^audio-capture-napi$/,
  /^color-diff-napi$/,
  /^modifiers-napi$/,
  /^url-handler-napi$/,
  /^sharp$/,
]

function isExternal(id: string): boolean | undefined {
  if (id === 'electron' || id === 'better-sqlite3') return true
  if (shimPatterns.some(p => p.test(id))) return true
  return undefined
}

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      lib: {
        entry: resolve(__dirname, 'src/main/index.ts'),
      },
      rollupOptions: {
        external: isExternal,
        output: {
          // Keep dynamic imports as-is
          inlineDynamicImports: false,
        },
      },
    },
    resolve: {
      alias: {
        'bun:bundle': resolve(__dirname, 'src/engine/shims/bun-bundle.ts'),
        'src/constants': resolve(__dirname, 'src/engine/constants'),
        'src/utils': resolve(__dirname, 'src/engine/utils'),
        'src/services': resolve(__dirname, 'src/engine/services'),
        'src/types': resolve(__dirname, 'src/engine/types'),
        'src/tools': resolve(__dirname, 'src/engine/tools'),
        'src/hooks': resolve(__dirname, 'src/engine/hooks'),
      },
    },
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      lib: {
        entry: resolve(__dirname, 'src/preload/preload.ts'),
      },
      rollupOptions: {
        external: ['electron'],
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
})
