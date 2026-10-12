import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session } from '@deepseek-ai/dsh-session'
import { SuggestionEngine } from '../src/engine.ts'
import { config, finishTurn, makeSession, MemoryRepository } from './helpers.ts'
import type { GeneratedSuggestion } from '../src/engine.ts'
import type { SuggestionRequest } from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
const signal = () => new AbortController().signal

async function harness(generate: (request: SuggestionRequest, signal: AbortSignal) => Promise<GeneratedSuggestion>,
  overrides = {}, repository = new MemoryRepository()) {
  const ctx = new Context()
  const session = await makeSession(ctx)
  const warn = vi.fn()
  const engine = new SuggestionEngine({ ...config, ...overrides }, {
    generate, session: id => ctx.sessions.get(id), repository, warn,
  })
  ctx.on('session/event', (value, event) => engine.observe(value, event))
  ctx.on('session/disposed', value => engine.forget(value))
  cleanups.push(async () => { await engine.dispose(); await ctx.fiber.dispose() })
  return { ctx, session, engine, repository, warn }
}

describe('independent background suggestions', () => {
  it('records exact input before dispatch and never appends to the main Session', async () => {
    let dispatched: SuggestionRequest | undefined
    const { session, engine, repository } = await harness(async request => {
      dispatched = request
      expect(repository.latest(session.id)?.input).toEqual(request)
      return { text: '给我看一个具体例子。', usage: { inputTokens: 12, outputTokens: 9 } }
    })
    const settled = repository.nextResult()
    finishTurn(session)
    const events = session.snapshotEvents()
    const append = vi.spyOn(session, 'append')
    const result = await settled
    await engine.dispose()
    expect(result.status).toBe('ready')
    expect(append).not.toHaveBeenCalled()
    expect(session.snapshotEvents()).toBe(events)
    expect(Session.create(session.id, events).deriveMessages()).toEqual(session.deriveMessages())
    if (dispatched === undefined) throw new Error('expected auxiliary dispatch')
    const request = dispatched
    expect({ system: request.system, messages: request.messages.map(message => ({ role: message.role, content: message.content })),
      route: [request.provider, request.model], maxTokens: request.maxTokens,
      suggestion: { requestSeq: request.triggerSeq, turn: request.turn, text: result.text },
    }).toMatchSnapshot()
  })

  it('returns a stored suggestion after reloading the plugin', async () => {
    const { session, engine, repository } = await harness(async () => ({ text: '继续运行测试' }))
    const settled = repository.nextResult()
    finishTurn(session)
    await settled
    await engine.dispose()
    const restored = Session.create(session.id, session.snapshotEvents())
    const reader = new SuggestionEngine(config, { repository, session: () => restored, generate: vi.fn(), warn: vi.fn() })
    cleanups.push(() => reader.dispose())
    expect((await reader.watch(session.id, undefined, signal())).suggestion?.text).toBe('继续运行测试')
    restored.append('turn/start', { turn: 2 })
    expect((await reader.watch(session.id, undefined, signal())).suggestion).toBe(null)
  })

  it('does not await generation in the main turn and wakes a waiting reader on settlement', async () => {
    const response = Promise.withResolvers<GeneratedSuggestion>()
    const entered = Promise.withResolvers<void>()
    const { session, engine, repository } = await harness(async () => { entered.resolve(); return response.promise })
    const settled = repository.nextResult()
    finishTurn(session)
    expect(session.snapshotEvents().at(-1)?.type).toBe('turn/end')
    await entered.promise
    const baseline = await engine.watch(session.id, undefined, signal())
    const waiting = engine.watch(session.id, baseline.version, signal())
    response.resolve({ text: '运行测试' })
    await settled
    expect((await waiting).suggestion?.text).toBe('运行测试')
  })

  it('rejects a late result from a provider that ignores cancellation', async () => {
    const response = Promise.withResolvers<GeneratedSuggestion>()
    const entered = Promise.withResolvers<AbortSignal>()
    const { session, engine, repository } = await harness(async (_request, abort) => { entered.resolve(abort); return response.promise })
    const settled = repository.nextResult()
    finishTurn(session)
    const abort = await entered.promise
    session.append('turn/start', { turn: 2 })
    expect(abort.aborted).toBe(true)
    response.resolve({ text: 'stale' })
    expect((await settled).status).toBe('cancelled')
    await engine.dispose()
    expect((await engine.watch(session.id, undefined, signal()).catch(() => ({ suggestion: null }))).suggestion).toBe(null)
  })

  it('waits for provider cleanup and releases long-poll readers on unload', async () => {
    const response = Promise.withResolvers<GeneratedSuggestion>()
    const entered = Promise.withResolvers<void>()
    const { session, engine, repository } = await harness(async () => { entered.resolve(); return response.promise })
    const settled = repository.nextResult()
    finishTurn(session)
    await entered.promise
    const baseline = await engine.watch(session.id, undefined, signal())
    const waiting = engine.watch(session.id, baseline.version, signal())
    let drained = false
    const dispose = engine.dispose().then(() => { drained = true })
    expect(drained).toBe(false)
    expect((await waiting).suggestion).toBe(null)
    response.resolve({ text: 'late after unload' })
    await dispose
    expect((await settled).status).toBe('cancelled')
  })

  it('contains provider failures and records their settlement outside the main Session', async () => {
    const { session, repository } = await harness(async () => { throw new Error('fixture provider unavailable') })
    const settled = repository.nextResult()
    finishTurn(session)
    expect(await settled).toMatchObject({ status: 'error', error: 'fixture provider unavailable', text: null })
    expect(session.deriveMessages()).toHaveLength(2)
  })

  it('cancels at the configured deadline', async () => {
    vi.useFakeTimers()
    try {
      const entered = Promise.withResolvers<void>()
      const { session, repository } = await harness(async (_request, abort) => new Promise<GeneratedSuggestion>((_resolve, reject) => {
        abort.addEventListener('abort', () => reject(abort.reason), { once: true })
        entered.resolve()
      }))
      const settled = repository.nextResult()
      finishTurn(session)
      await entered.promise
      await vi.advanceTimersByTimeAsync(config.timeoutMs)
      expect(await settled).toMatchObject({ status: 'cancelled', error: 'prompt suggestion timed out' })
    } finally { vi.useRealTimers() }
  })

  it('cancels a read without cancelling its background generation', async () => {
    const { session, engine } = await harness(async () => ({ text: null }))
    const baseline = await engine.watch(session.id, undefined, signal())
    const controller = new AbortController()
    const pending = engine.watch(session.id, baseline.version, controller.signal)
    controller.abort(new Error('reader detached'))
    await expect(pending).rejects.toThrow('reader detached')
    expect((await engine.watch(session.id, undefined, signal())).suggestion).toBe(null)
  })

  it('does not dispatch when durable input recording fails', async () => {
    const repository = new MemoryRepository()
    vi.spyOn(repository, 'begin').mockRejectedValue(new Error('disk unavailable'))
    const generate = vi.fn(async () => ({ text: 'unused' }))
    const { session, engine, warn } = await harness(generate, {}, repository)
    finishTurn(session)
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce())
    await engine.dispose()
    expect(generate).not.toHaveBeenCalled()
    expect(session.snapshotEvents().at(-1)?.type).toBe('turn/end')
  })

  it.each([{ enabled: false }, { maxInputBytes: 1 }])('skips generation when policy disallows it: %j', async overrides => {
    const generate = vi.fn(async () => ({ text: 'unused' }))
    const { session, engine } = await harness(generate, overrides)
    finishTurn(session)
    await engine.dispose()
    expect(generate).not.toHaveBeenCalled()
  })

  it('skips turns without a new human message', async () => {
    const generate = vi.fn(async () => ({ text: 'unused' }))
    const { session, engine } = await harness(generate)
    finishTurn(session, 1, false)
    await engine.dispose()
    expect(generate).not.toHaveBeenCalled()
  })
})
