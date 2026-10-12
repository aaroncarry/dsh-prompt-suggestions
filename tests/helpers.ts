import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SuggestionConfig } from '../src/config.ts'
import { recordFor } from '../src/store.ts'
import type { CallRecord, SuggestionRepository } from '../src/store.ts'
import type { SuggestionRequest, SuggestionResult } from '../src/types.ts'

export const config: SuggestionConfig = {
  enabled: true, maxContextMessages: 12, maxInputBytes: 16384, maxOutputTokens: 128,
  maxResponseBytes: 32768, maxSuggestionChars: 160, timeoutMs: 8000, temperature: 0.3,
}
export class MemoryRepository implements SuggestionRepository {
  readonly calls = new Map<SessionId, CallRecord>()
  readonly heads = new Map<SessionId, SessionId>()
  private readonly waiters: Array<(value: SuggestionResult) => void> = []
  latest(id: SessionId): CallRecord | undefined {
    const callId = this.heads.get(id)
    return callId === undefined ? undefined : this.calls.get(callId)
  }
  async begin(request: SuggestionRequest): Promise<SessionId> {
    const record = recordFor(request)
    this.calls.set(record.id, record)
    this.heads.set(request.sessionId, record.id)
    return record.id
  }
  async settle(id: SessionId, result: SuggestionResult): Promise<void> {
    const record = this.calls.get(id)
    if (record === undefined) throw new Error('missing test call')
    this.calls.set(id, { ...record, result })
    for (const resolve of this.waiters.splice(0)) resolve(result)
  }
  nextResult(): Promise<SuggestionResult> {
    return new Promise(resolve => this.waiters.push(resolve))
  }
}
export async function makeSession(ctx: Context, id = 'suggestion-test'): Promise<Session> {
  if (!ctx.get('sessions')) await ctx.plugin(SessionStore)
  return ctx.sessions.create(SessionId(id))
}
export function finishTurn(session: Session, turn = 1, human = true): void {
  session.append('turn/start', { turn })
  session.append('request/header', { reason: 'initial', header: { config: { provider: 'fixture', model: 'fixture' } } })
  if (human) session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '解释一下这个插件。' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', { turn, step: 1, stream: [], message: createAssistantMessage({
    content: [{ type: 'text', text: '插件会在回复完成后生成下一句话建议。' }], source: { kind: 'model', provider: 'fixture', model: 'fixture' },
  }) }, { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}
