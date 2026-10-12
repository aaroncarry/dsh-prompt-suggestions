/** Plugin-owned auxiliary audit snapshots and latest-suggestion indexing. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createSystemMessage } from '@deepseek-ai/dsh-llm'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { SuggestionRequest, SuggestionResult } from './types.ts'
import { sequenceSchema, sessionIdSchema } from './wire.ts'

const usage = z.object({
  inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative().optional(), cacheReadTokens: z.number().nonnegative().optional(),
  cacheWriteTokens: z.number().nonnegative().optional(), reasoningTokens: z.number().nonnegative().optional(),
})
const result = z.object({
  requestSeq: sequenceSchema, turn: z.number().int().nonnegative(),
  status: z.enum(['ready', 'empty', 'cancelled', 'error']), text: z.string().min(1).nullable(),
  usage: usage.optional(), error: z.string().optional(),
}).refine(value => (value.status === 'ready') === (value.text !== null), 'only ready results carry text')

/** Stored call: the JSON input is for inspection, never re-executed after restore. */
export const callSchema = z.object({
  id: sessionIdSchema, sessionId: sessionIdSchema, triggerSeq: sequenceSchema, turn: z.number().int().nonnegative(),
  input: z.json(), log: z.object({ header: z.json(), events: z.array(z.json()) }), result: result.nullable(),
})
/** A validated plugin audit record. */
export type CallRecord = z.infer<typeof callSchema>
/** Plugin-owned storage; no table contributes events to the main Session. */
export const suggestionDomain = defineDomain({
  name: 'prompt_suggestions', version: 1, layout: 'per-record',
  tables: {
    calls: domainTable<SessionId, CallRecord>(callSchema),
    latest: domainTable<SessionId, { callId: SessionId }>(z.object({ callId: sessionIdSchema })),
  },
})
/** Typed handle over this plugin's domain. */
export type SuggestionDomain = Domain<typeof suggestionDomain>

/** Durable operations needed by the generation owner. */
export interface SuggestionRepository {
  /** Read the latest call associated with one main Session. */
  latest(sessionId: SessionId): CallRecord | undefined
  /** Record exact input before dispatch and return its detached audit Session id. */
  begin(request: SuggestionRequest): Promise<SessionId>
  /** Settle one exact call without changing the latest-call pointer. */
  settle(callId: SessionId, result: SuggestionResult): Promise<void>
}

/** Build a standard detached Session log for reconstructing the auxiliary model input.
 * @param request - exact request about to be dispatched.
 * @returns plugin-owned snapshot containing only existing Session event types.
 */
export function recordFor(request: SuggestionRequest): CallRecord {
  const audit = Session.create(SessionId(randomUUID()))
  audit.append('system/message', { turn: 1, step: 1, message: createSystemMessage(request.system) }, { surfaceOp: 'append' })
  audit.append('request/header', { reason: 'initial', header: { config: {
    provider: request.provider, model: request.model, maxTokens: request.maxTokens,
    ...request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort },
  } } })
  for (const message of request.messages) audit.append('user/message', message, { surfaceOp: 'append' })
  return {
    id: audit.id, sessionId: request.sessionId, triggerSeq: request.triggerSeq, turn: request.turn,
    input: z.json().parse(request),
    log: { header: z.json().parse(audit.header), events: z.array(z.json()).parse(audit.snapshotEvents()) },
    result: null,
  }
}

/** Persist call snapshots through the existing Storage Domain service. */
export class DomainRepository implements SuggestionRepository {
  constructor(private readonly domain: SuggestionDomain) {}

  /** Read the latest persisted call.
   * @param sessionId - main Session identity.
   * @returns current call, or absence before the first request.
   */
  latest(sessionId: SessionId): CallRecord | undefined {
    const pointer = this.domain.table('latest').get(sessionId)
    return pointer === undefined ? undefined : this.domain.table('calls').get(pointer.callId)
  }

  /** Durably record input before allowing model dispatch.
   * @param request - exact auxiliary request.
   * @returns identity of its plugin-owned audit snapshot.
   */
  async begin(request: SuggestionRequest): Promise<SessionId> {
    const record = recordFor(request)
    await this.domain.table('calls').put(record.id, record)
    await this.domain.table('latest').put(request.sessionId, { callId: record.id })
    return record.id
  }

  /** Persist settlement without replacing a newer request's suggestion.
   * @param callId - exact previously recorded call.
   * @param value - provider settlement and usage.
   * @returns completion after durable publication.
   */
  async settle(callId: SessionId, value: SuggestionResult): Promise<void> {
    await this.domain.table('calls').update(callId, record => ({ ...record, result: value }))
  }
}
