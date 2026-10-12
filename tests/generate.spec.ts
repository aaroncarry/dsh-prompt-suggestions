import { describe, expect, it, vi } from 'vitest'
import { ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { generateSuggestion } from '../src/generate.ts'
import { SYSTEM_PROMPT } from '../src/prompt.ts'
import type { SuggestionRequest } from '../src/types.ts'
import { config } from './helpers.ts'

const request: SuggestionRequest = { sessionId: SessionId('generation'), triggerSeq: SessionSeq(4), turn: 1,
  provider: 'fixture', model: 'fixture', messages: [], system: SYSTEM_PROMPT, maxTokens: 128, temperature: 0.3,
  reasoningEffort: ReasoningEffortId('off'),
}
const signal = () => new AbortController().signal
function chunks(values: StreamChunk[]) { return async function* () { yield* values } }
const good: StreamChunk[] = [
  { type: 'reasoning-delta', index: 0, text: 'private reasoning' },
  { type: 'text-delta', index: 1, text: '给我看一个例子。' },
  { type: 'usage', usage: { inputTokens: 16, outputTokens: 8 } },
  { type: 'finish', reason: { kind: 'stop' } },
]

describe('auxiliary stream assembly', () => {
  it('returns only visible text, preserves usage, and forwards exact routing settings', async () => {
    const stream = vi.fn(chunks(good))
    expect(await generateSuggestion(request, config, stream, signal())).toEqual({ text: '给我看一个例子。', usage: { inputTokens: 16, outputTokens: 8 } })
    expect(stream.mock.calls[0]?.[0]).toMatchObject({ sessionId: request.sessionId, provider: 'fixture', model: 'fixture', reasoningEffort: 'off', maxTokens: 128 })
  })
  it.each([undefined, '', ' \n '])('treats successful empty output %j as no suggestion and preserves usage', async text => {
    const values: StreamChunk[] = [
      ...text === undefined ? [] : [{ type: 'text-delta' as const, index: 0, text }],
      { type: 'usage', usage: { inputTokens: 16, outputTokens: 0 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    expect(await generateSuggestion(request, config, chunks(values), signal())).toEqual({
      text: null, usage: { inputTokens: 16, outputTokens: 0 },
    })
  })
  it('bounds the complete raw response at an exact multibyte byte limit', async () => {
    const bytes = good.reduce((total, chunk) => total + Buffer.byteLength(JSON.stringify(chunk)), 0)
    expect(await generateSuggestion(request, { ...config, maxResponseBytes: bytes }, chunks(good), signal())).toHaveProperty('text')
    await expect(generateSuggestion(request, { ...config, maxResponseBytes: bytes - 1 }, chunks(good), signal())).rejects.toThrow(/maxResponseBytes/)
  })
  it.each<StreamChunk[]>([
    [{ type: 'text-delta', index: 0, text: 'unfinished' }],
    [{ type: 'finish', reason: { kind: 'max-tokens' } }],
    [{ type: 'finish', reason: { kind: 'error', failure: { code: 'FAIL', message: 'unavailable' } } }],
  ])('rejects incomplete or unsuccessful generation %j', async (...values) => {
    await expect(generateSuggestion(request, config, chunks(values), signal())).rejects.toThrow(/ended with/)
  })
  it('rejects tool calls even when the stream claims success', async () => {
    const values: StreamChunk[] = [{ type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('unexpected'), name: 'shell', arguments: '{}' } }, { type: 'finish', reason: { kind: 'stop' } }]
    await expect(generateSuggestion(request, config, chunks(values), signal())).rejects.toThrow(/non-text/)
  })
  it('does not dispatch a cancelled request', async () => {
    const stream = vi.fn(chunks(good))
    const controller = new AbortController()
    controller.abort(new Error('cancelled before dispatch'))
    await expect(generateSuggestion(request, config, stream, controller.signal)).rejects.toThrow(/cancelled before/)
    expect(stream).not.toHaveBeenCalled()
  })
})
