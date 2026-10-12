/** Real DSH profile smoke; only the external model is deterministic. */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, symlink, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { dshCommand } from './dsh.mjs'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(process.env.DSH_REPO ?? join(project, '../deepseek-harness'))
const home = await mkdtemp(join(tmpdir(), 'dsh-suggestions-smoke-'))
const profile = join(home, 'profiles', 'suggestion-smoke')
const packageName = '@aaroncarry/dsh-prompt-suggestions'
await mkdir(join(profile, 'node_modules', '@aaroncarry'), { recursive: true })
await symlink(project, join(profile, 'node_modules', '@aaroncarry', 'dsh-prompt-suggestions'), 'junction')
await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true, type: 'module',
  dependencies: { [packageName]: `link:${project}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', packageName] } },
}, null, 2) + '\n')
const overlay = join(profile, 'cordis.patch.yml')
await writeFile(overlay, `- id: hmr
  disabled: true
- id: session-title-llm
  disabled: true
- id: agent-instructions
  disabled: true
- id: llm-deepseek
  disabled: true
- id: llm-pi-ai
  disabled: true
- id: session-log-deepseek
  disabled: true
- id: session-persistence-jsonl
  config:
    root: '${join(home, 'sessions').replaceAll('\\', '/')}'
    compression: none
- id: workspace-controller
  config:
    documentsDirectory: '${join(home, 'documents').replaceAll('\\', '/')}'
    documentsLookupTimeoutMs: 10000
- id: agent-default-model
  config:
    provider: suggestion-fixture
    model: fixture
- insert:
    - id: suggestion-fixture
      name: '${join(project, 'tests/fixtures/model.mjs').replaceAll('\\', '/')}'
`)
const command = dshCommand(repo, ['--profile', 'suggestion-smoke', '--patch', join(repo, 'apps/web/tests/pin-browse-picker.overlay.yml'), '--no-open', '--port', '0'], home)
const child = spawn(command.executable, command.args, { ...command.options, stdio: ['pipe', 'pipe', 'pipe'] })
let output = ''
const ready = Promise.withResolvers()
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
  output += chunk.toString()
  const match = output.match(/dsh web: (http:\/\/[^\s]+)/)
  if (match) ready.resolve(match[1])
})
const closed = new Promise(resolveExit => child.once('exit', (code, signal) => {
  ready.reject(new Error(`DSH exited (${code ?? signal}) before startup:\n${output.slice(-10000)}`))
  resolveExit()
}))
const timeout = setTimeout(() => ready.reject(new Error(`Profile startup timed out:\n${output.slice(-10000)}`)), 90000)
let browser
const artifacts = join(project, '.test-output')
await mkdir(artifacts, { recursive: true })
try {
  const url = await ready.promise
  clearTimeout(timeout)
  console.log(`Loaded real profile at ${new URL(url).origin}`)
  const require = createRequire(join(repo, 'apps/web/package.json'))
  const { chromium } = require('playwright')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('[data-composer-card]'), { timeout: 30000 })
  await writeFile(join(artifacts, 'initial-page.txt'), await page.locator('body').innerText())
  await page.screenshot({ path: join(artifacts, 'initial-page.png') })
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.getByRole('button', { name: '继续', exact: true }).waitFor({ state: 'hidden' })
  const editor = page.locator('[contenteditable="true"]')
  await editor.waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '选择模型，当前 suggestion-fixture/fixture', exact: true }).waitFor()
  await editor.click()
  await editor.pressSequentially('解释一下这个插件。')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  const suggested = page.getByRole('button', { name: '使用建议消息', exact: true })
  await suggested.waitFor({ timeout: 15000 })
  assert.match(await suggested.innerText(), /给我看一个具体例子。/)
  assert.equal(await page.locator('[data-composer-placeholder]').evaluate(element => getComputedStyle(element).visibility), 'hidden')
  await page.screenshot({ path: join(artifacts, 'suggestion-light.png') })
  await editor.focus()
  await editor.press('Tab')
  assert.equal(await editor.innerText(), '给我看一个具体例子。')
  assert.equal(await suggested.count(), 0)
  assert.equal(await page.getByText('插件会在回复完成后生成下一句话建议。', { exact: true }).count(), 1)
  await editor.press('Enter')
  await suggested.waitFor({ timeout: 15000 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: join(artifacts, 'suggestion-dark.png') })
  await editor.press('Escape')
  await suggested.waitFor({ state: 'hidden' })
  assert.equal(await suggested.count(), 0)
  await page.reload()
  await suggested.waitFor({ timeout: 15000 })
  await editor.fill('我自己输入。')
  await suggested.waitFor({ state: 'hidden' })
  assert.equal(await suggested.count(), 0)
  assert.equal(await editor.innerText(), '我自己输入。')
  await writeFile(join(artifacts, 'profile-result.json'), JSON.stringify({
    passed: ['profile load', 'generated suggestion', 'Tab inserts without sending', 'Enter sends', 'Escape dismisses', 'reload plugin storage', 'typing suppresses', 'light and dark rendering'],
    browserErrors: errors,
  }, null, 2) + '\n')
  console.log('Passed: profile load, generation, Tab/Enter/Escape, reload, typing, light/dark rendering')
  if (errors.length) throw new Error(`Browser errors: ${errors.join('\n')}`)
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]
  if (page) {
    await writeFile(join(artifacts, 'failure-page.txt'), await page.locator('body').innerText())
    await page.screenshot({ path: join(artifacts, 'failure-page.png') })
  }
  throw error
} finally {
  clearTimeout(timeout)
  await browser?.close()
  child.kill('SIGTERM')
  await closed
  await writeFile(join(artifacts, 'host.log'), output)
  console.log(`Isolated test home: ${home}`)
}

const installation = createRequire(join(repo, 'packages/session/session-persistence/package.json'))
const { validateStoredEvents } = installation('@deepseek-ai/dsh-session-persistence')
const { Session, KNOWN_SESSION_EVENT_TYPES } = installation('@deepseek-ai/dsh-session')
async function sessionFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sessionFiles(path))
    else if (entry.name.endsWith('.jsonl')) files.push(path)
  }
  return files
}
const [logPath] = await sessionFiles(join(home, 'sessions'))
assert.ok(logPath, 'real profile must persist a session')
const [header, ...events] = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
assert.equal(KNOWN_SESSION_EVENT_TYPES.has('prompt-suggestions/request'), false)
const validated = validateStoredEvents({ ...header, isSeeded: false }, events)
const restored = Session.create(header.id, validated)
assert.equal(restored.deriveMessages().filter(message => message.role === 'user' && message.source.kind === 'user').length, 2)
assert.equal(events.some(event => event.type.startsWith('prompt-suggestions/')), false)
const storage = createRequire(join(repo, 'packages/storage/storage-json/package.json'))
const { JsonStorageBackend } = storage('@deepseek-ai/dsh-storage-json')
const backend = new JsonStorageBackend(join(home, 'storages'))
try {
  const unit = await backend.kv.open({ name: 'prompt_suggestions', version: 1, layout: 'per-record', tables: ['calls', 'latest'], hasGlobal: false })
  const stored = await unit.loadAll()
  const calls = Object.values(stored.tables.calls)
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.equal(call.result.status, 'ready')
    const audit = Session.create(call.id, call.log.events, call.log.header)
    assert.equal(audit.deriveMessages()[0].content[0].text, call.input.system)
    assert.deepEqual(audit.deriveMessages().slice(1), call.input.messages)
    assert.ok(call.log.events.every(event => KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable === undefined))
  }
} finally { await backend.close() }
console.log('Passed: main Session restores without the plugin; exact auxiliary inputs persist in plugin-owned standard audit logs')
