/** Validate the README pair with the DSH documentation helpers. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
const repo = resolve(process.env.DSH_REPO ?? join(project, '../deepseek-harness'))
const pairing = await import(pathToFileURL(join(repo, 'scripts/translation-pairing.ts')))
const records = await import(pathToFileURL(join(repo, 'scripts/translation-pairing-record.ts')))
const paths = records.translationPairPaths('README.md')
const en = await readFile(join(project, paths.source), 'utf8')
const zh = await readFile(join(project, paths.zh), 'utf8')
const context = { repoRoot: project, isTranslationPairSource: source => source === 'README.md' }
const source = pairing.translationStructureSignature(pairing.parseTranslationMarkdown(en), 'README.zh.md', { ...context, sourcePath: paths.source, markdown: en })
const translated = pairing.translationStructureSignature(pairing.parseTranslationMarkdown(zh), 'README.md', { ...context, sourcePath: paths.zh, markdown: zh })
assert.deepEqual(pairing.translationStructureDiff(source, translated), [])
assert.equal(en.split('\n').length, zh.split('\n').length, 'the README pair must stay line-aligned')
const expected = records.renderTranslationPairingRecord(paths, records.computeTranslationPairingRecord(paths, en, zh, context))
if (process.argv.includes('--write')) await writeFile(join(project, paths.meta), expected)
assert.equal(await readFile(join(project, paths.meta), 'utf8'), expected, 'confirm both README versions and run test:docs --write')
for (const text of [en, zh]) {
  for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
    const target = match[1].split('#')[0]
    if (target && !/^https?:/.test(target)) assert.ok(existsSync(join(project, target)), `missing README target: ${target}`)
  }
}
console.log('Passed: README pairing, structure, line alignment, and local link targets')
