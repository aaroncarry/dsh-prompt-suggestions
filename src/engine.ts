/** Background generation, durable plugin records, and cancellable suggestion reads. */
import type { Session, SessionEvent, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SuggestionConfig } from './config.ts'
import type { PromptSuggestion, SuggestionRequest, SuggestionResult } from './types.ts'
import type { SuggestionRepository } from './store.ts'
import { frameConversation, SYSTEM_PROMPT } from './prompt.ts'

/** One provider settlement before association with its recorded request. */
export type GeneratedSuggestion = Pick<SuggestionResult, 'text' | 'usage'>

/** Host-owned operations used by background generation. */
export interface EngineDependencies {
  /** Dispatch an auxiliary request after its input has been persisted. */
  generate(request: SuggestionRequest, signal: AbortSignal): Promise<GeneratedSuggestion>
  /** Resolve the exact live Session, if currently loaded. */
  session(id: SessionId): Session | undefined
  /** Plugin-owned durable call records. */
  repository: SuggestionRepository
  /** Report storage or lifecycle failures outside the main turn. */
  warn(error: unknown): void
}
interface Work { readonly controller: AbortController; readonly triggerSeq: SessionSeq; readonly turn: number }
interface Turn { readonly number: number; human: boolean; assistant: boolean }
interface WatchState { version: number; readonly waiters: Set<() => void> }

/** Owns at most one current generation per live Session and drains all work on unload. */
export class SuggestionEngine {
  private readonly active = new Map<Session, Work>()
  private readonly turns = new Map<Session, Turn>()
  private readonly tasks = new Set<Promise<void>>()
  private readonly watches = new Map<SessionId, WatchState>()
  private version = 0
  private closed = false

  constructor(private readonly config: SuggestionConfig, private readonly deps: EngineDependencies) {}

  /** Consume committed main events without appending to the main Session.
   * @param session - exact live Session receiving the event.
   * @param event - committed event; only user-driven completed turns are eligible.
   */
  observe(session: Session, event: SessionEvent): void {
    if (this.closed || !this.config.enabled || session.header.origin === 'subagent' || session.header.parentSession !== undefined) return
    switch (event.type) {
      case 'turn/start':
        this.cancel(session)
        this.turns.set(session, { number: event.data.turn, human: false, assistant: false })
        this.notify(session.id)
        break
      case 'agent/inbox/spliced':
        this.cancel(session)
        this.notify(session.id)
        break
      case 'user/message': {
        const turn = this.turns.get(session)
        if (turn !== undefined && event.data.source.kind === 'user') turn.human = true
        break
      }
      case 'assistant/message': {
        const turn = this.turns.get(session)
        if (turn !== undefined && !event.data.interrupted) {
          turn.assistant = event.data.message.content.some(block => block.type === 'text' && block.text.trim() !== '')
        }
        break
      }
      case 'turn/end': {
        const turn = this.turns.get(session)
        this.turns.delete(session)
        if (event.data.reason.kind !== 'completed' || turn?.number !== event.data.turn || !turn.human || !turn.assistant) return
        this.cancel(session)
        const work = { controller: new AbortController(), triggerSeq: event.seq, turn: turn.number }
        this.active.set(session, work)
        this.notify(session.id)
        const task = Promise.resolve().then(() => this.run(session, work)).catch(error => this.deps.warn(error))
        this.tasks.add(task)
        void task.then(() => this.tasks.delete(task))
        break
      }
      default: break // Other event owners do not affect suggestion eligibility.
    }
  }

  /** Abort work and invalidate readers when a Session leaves the live store.
   * @param session - detached main Session.
   */
  forget(session: Session): void {
    this.cancel(session)
    this.turns.delete(session)
    this.notify(session.id)
  }

  /** Read a current suggestion, or await the next lifecycle/result change.
   * @param id - selected main Session.
   * @param after - last observed Host version; omit for an immediate baseline.
   * @param signal - caller cancellation, independent of generation ownership.
   * @returns the current version and eligible suggestion.
   */
  async watch(id: SessionId, after: number | undefined, signal: AbortSignal): Promise<{ version: number; suggestion: PromptSuggestion | null }> {
    signal.throwIfAborted()
    if (this.closed) throw new Error('prompt-suggestions is closed')
    const state = this.watchState(id)
    if (after === state.version) {
      await new Promise<void>((resolve, reject) => {
        const release = (): void => { state.waiters.delete(changed); signal.removeEventListener('abort', aborted) }
        const changed = (): void => { release(); resolve() }
        const aborted = (): void => { release(); reject(signal.reason) }
        state.waiters.add(changed)
        signal.addEventListener('abort', aborted, { once: true })
      })
    }
    signal.throwIfAborted()
    return { version: state.version, suggestion: this.read(id) }
  }

  /** Abort generations, release readers, and wait for provider and persistence cleanup.
   * @returns completion after every owned generation settles.
   */
  async dispose(): Promise<void> {
    this.closed = true
    for (const session of this.active.keys()) this.cancel(session)
    for (const id of this.watches.keys()) this.notify(id)
    this.turns.clear()
    await Promise.all(this.tasks)
  }

  private read(id: SessionId): PromptSuggestion | null {
    if (this.closed) return null
    const session = this.deps.session(id)
    const record = this.deps.repository.latest(id)
    if (session === undefined || this.active.has(session) || record?.result?.status !== 'ready' || record.result.text === null) return null
    const events = session.snapshotEvents()
    const trigger = events[record.triggerSeq]
    if (trigger?.type !== 'turn/end' || trigger.data.turn !== record.turn) return null
    if (events.slice(record.triggerSeq + 1).some(event => event.type === 'turn/start' || event.type === 'agent/inbox/spliced')) return null
    return { requestSeq: record.triggerSeq, turn: record.turn, text: record.result.text }
  }

  private watchState(id: SessionId): WatchState {
    let state = this.watches.get(id)
    if (state === undefined) { state = { version: this.version, waiters: new Set() }; this.watches.set(id, state) }
    return state
  }

  private notify(id: SessionId): void {
    const state = this.watchState(id)
    state.version = ++this.version
    for (const changed of [...state.waiters]) changed()
  }

  private cancel(session: Session): void {
    this.active.get(session)?.controller.abort(new Error('prompt suggestion superseded'))
    this.active.delete(session)
  }

  private current(session: Session, work: Work): boolean {
    return !this.closed && this.deps.session(session.id) === session && this.active.get(session) === work && !work.controller.signal.aborted
  }

  private requestFor(session: Session, work: Work): SuggestionRequest | null {
    const route = session.requestHeader()?.config
    const provider = this.config.provider ?? route?.provider
    const model = this.config.model ?? route?.model
    const messages = frameConversation(session.deriveMessages(), this.config)
    if (provider === undefined || model === undefined || messages === null) return null
    return {
      sessionId: session.id, triggerSeq: work.triggerSeq, turn: work.turn, provider, model, messages,
      system: SYSTEM_PROMPT, maxTokens: this.config.maxOutputTokens, temperature: this.config.temperature,
      ...this.config.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(this.config.reasoningEffort) },
    }
  }

  private async run(session: Session, work: Work): Promise<void> {
    try {
      if (!this.current(session, work)) return
      const request = this.requestFor(session, work)
      if (request === null) return
      const timer = setTimeout(() => work.controller.abort(new Error('prompt suggestion timed out')), this.config.timeoutMs)
      timer.unref()
      try {
        const callId = await this.deps.repository.begin(request)
        let result: SuggestionResult
        try {
          work.controller.signal.throwIfAborted()
          const generated = await this.deps.generate(request, work.controller.signal)
          const status = this.current(session, work) ? (generated.text === null ? 'empty' : 'ready') : 'cancelled'
          result = { requestSeq: work.triggerSeq, turn: work.turn, status, text: status === 'ready' ? generated.text : null,
            ...generated.usage === undefined ? {} : { usage: generated.usage } }
        } catch (error) {
          result = { requestSeq: work.triggerSeq, turn: work.turn, text: null,
            status: work.controller.signal.aborted ? 'cancelled' : 'error',
            error: error instanceof Error ? error.message : String(error) }
        }
        await this.deps.repository.settle(callId, result)
      } finally { clearTimeout(timer) }
    } finally {
      if (this.active.get(session) === work) this.active.delete(session)
      this.notify(session.id)
    }
  }
}
