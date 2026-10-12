import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { frameConversation, parseSuggestion, SYSTEM_PROMPT } from '../src/prompt.ts'
import { resolveConfig } from '../src/config.ts'
import { config } from './helpers.ts'

describe('output validation', () => {
  it.each(['', 'NONE', 'first\nsecond', 'bad\u0000text', '"quoted"', '1. a list', '```code```', '- item'])('hides malformed output %j', text => {
    expect(parseSuggestion(text, 160)).toBe(null)
  })
  it('counts Unicode code points and trims harmless outer whitespace', () => {
    expect(parseSuggestion('  继续😀  ', 3)).toBe('继续😀')
    expect(parseSuggestion('继续😀', 2)).toBe(null)
  })
})

describe('input framing', () => {
  const messages = [
    createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '你好😀' }] }),
    createAssistantMessage({ source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: '你好！' }] }),
  ]
  it('applies the byte bound to the complete prompt and keeps the exact boundary', () => {
    const framed = frameConversation(messages, config)
    const text = framed?.[0]?.content[0]
    if (text?.type !== 'text') throw new Error('expected framed text')
    const bytes = Buffer.byteLength(SYSTEM_PROMPT + text.text)
    expect(frameConversation(messages, { ...config, maxInputBytes: bytes })?.[0]?.content).toEqual(framed?.[0]?.content)
    expect(frameConversation(messages, { ...config, maxInputBytes: bytes - 1 })).toBe(null)
  })
  it('rejects a half-configured auxiliary route and invalid limits', () => {
    expect(() => resolveConfig({ ...config, provider: 'fixture' })).toThrow(/together/)
    expect(() => resolveConfig({ ...config, timeoutMs: 0 })).toThrow()
  })
})
