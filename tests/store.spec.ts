import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { DomainRepository, callSchema, recordFor, suggestionDomain } from '../src/store.ts'
import { SYSTEM_PROMPT } from '../src/prompt.ts'
import type { SuggestionRequest } from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const request: SuggestionRequest = {
  sessionId: SessionId('main'), triggerSeq: SessionSeq(4), turn: 1, provider: 'fixture', model: 'fixture',
  system: SYSTEM_PROMPT, messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '继续测试' }] })],
  maxTokens: 128, temperature: 0.3,
}
async function repository(root: string) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(root)
  ctx.effect(() => ctx.storage.backend.register('json', backend))
  const facility = new DomainFacility(ctx, { backend: 'json' })
  const domain = await facility.open(suggestionDomain)
  const close = async () => { await domain.close(); await ctx.fiber.dispose() }
  cleanups.push(close)
  return { repository: new DomainRepository(domain), close }
}

describe('plugin-owned persistence', () => {
  it('records standard Session events for the exact auxiliary input', () => {
    const record = recordFor(request)
    expect(record.log.events).toMatchObject([
      { type: 'system/message', data: { message: { role: 'system', content: [{ type: 'text', text: SYSTEM_PROMPT }] } } },
      { type: 'request/header', data: { header: { config: { provider: 'fixture', model: 'fixture' } } } },
      { type: 'user/message', data: request.messages[0] },
    ])
    expect(record.input).toEqual(request)
  })

  it('rejects an inconsistent ready result at the durable read', () => {
    expect(() => callSchema.parse({ ...recordFor(request),
      result: { requestSeq: 4, turn: 1, status: 'ready', text: null },
    })).toThrow(/ready results/)
  })

  it('restores records from disk and keeps a late old result from replacing a newer call', async () => {
    const root = await mkdtemp(join(tmpdir(), 'suggestions-storage-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const first = await repository(root)
    const older = await first.repository.begin(request)
    const newer = await first.repository.begin({ ...request, triggerSeq: SessionSeq(9), turn: 2 })
    await first.repository.settle(newer, { requestSeq: SessionSeq(9), turn: 2, status: 'ready', text: '运行测试' })
    await first.repository.settle(older, { requestSeq: SessionSeq(4), turn: 1, status: 'ready', text: 'old' })
    expect(first.repository.latest(request.sessionId)?.result?.text).toBe('运行测试')
    await first.close()
    const second = await repository(root)
    expect(second.repository.latest(request.sessionId)?.result?.text).toBe('运行测试')
  })
})
