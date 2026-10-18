/** Exercise DSH's package-manager install/remove path in an isolated profile. */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { dshCommand } from './dsh.mjs'

const project = fileURLToPath(new URL('../', import.meta.url))
const repo = resolve(process.env.DSH_REPO ?? join(project, '../deepseek-harness'))
const home = await mkdtemp(join(tmpdir(), 'dsh-suggestions-install-'))
const profile = 'suggestion-install-smoke'
const packageName = '@aaroncarry/dsh-prompt-suggestions'
const packageManifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
const tarballName = `${packageName.slice(1).replace('/', '-')}-${packageManifest.version}.tgz`
const tarball = (await readdir(project)).find(name => name === tarballName)
assert.ok(tarball, `pack ${packageName}@${packageManifest.version} before running test:install`)
async function cli(args) {
  const command = dshCommand(repo, args, home)
  const child = spawn(command.executable, command.args, { ...command.options, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk.toString() })
  const timer = setTimeout(() => child.kill('SIGTERM'), 90000)
  try {
    await new Promise((resolveExit, reject) => {
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolveExit() : reject(new Error(`dsh ${args[0]} failed (${code}):\n${output.slice(-3000)}`)))
    })
    return output
  } finally { clearTimeout(timer) }
}

await cli(['--profile', profile, '--from-default-profile', 'web', '--dump-config'])
await cli(['plugin', '--profile', profile, 'add', join(project, tarball)])
const manifestPath = join(home, 'profiles', profile, 'package.json')
const installed = JSON.parse(await readFile(manifestPath, 'utf8'))
assert.ok(installed.dependencies[packageName])
assert.ok(installed.dsh.profile.bundles.includes(packageName))
assert.match(await cli(['--profile', profile, '--dump-config']), /^- id: prompt-suggestions$/m)
await cli(['plugin', '--profile', profile, 'remove', packageName])
const removed = JSON.parse(await readFile(manifestPath, 'utf8'))
assert.equal(removed.dependencies?.[packageName], undefined)
assert.equal(removed.dsh.profile.bundles.includes(packageName), false)
console.log('Passed: packed plugin add/remove and bundle reconciliation in an isolated profile')
