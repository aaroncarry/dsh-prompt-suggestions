/** Build separate Host ESM and Client module-loader artifacts. */
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'

await mkdir(new URL('../lib/', import.meta.url), { recursive: true })
await build({
  entryPoints: ['src/index.ts', 'src/types.ts'], outdir: 'lib', bundle: true,
  format: 'esm', platform: 'node', target: 'node22', packages: 'external', sourcemap: true,
})
await build({
  entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', bundle: true,
  format: 'cjs', platform: 'browser', target: 'es2024', sourcemap: true,
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis'],
  loader: { '.css': 'text' },
  banner: { js: 'window.__ModuleLoader__.load({ id: "@aaroncarry/dsh-prompt-suggestions", factory: (require) => { var module = { exports: {} }; var exports = module.exports;' },
  footer: { js: 'return module.exports; } });' },
})
