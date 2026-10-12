/** Invoke the source CLI or the installed Desktop's unchanged bundled CLI. */
import { join } from 'node:path'
export function dshCommand(repo, args, home) {
  const installed = process.env.DSH_INSTALLED_ROOT
  return {
    executable: installed ? join(installed, 'DeepSeek Harness.exe') : process.execPath,
    args: installed
      ? ['--expose-internals', join(installed, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'), ...args]
      : ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', ...args],
    options: { cwd: repo, env: { ...process.env, ...installed ? { ELECTRON_RUN_AS_NODE: '1' } : {},
      DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, windowsHide: true },
  }
}
