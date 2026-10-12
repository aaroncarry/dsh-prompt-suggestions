/** Auxiliary-call records and the independently transported composer suggestion. */
import type { UserMessage, TokenUsage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'

/** Exact auxiliary model input recorded before dispatch. */
export interface SuggestionRequest {
  readonly sessionId: SessionId
  readonly triggerSeq: SessionSeq
  readonly turn: number
  readonly provider: string
  readonly model: string
  readonly system: string
  readonly messages: UserMessage[]
  readonly maxTokens: number
  readonly temperature: number
  readonly reasoningEffort?: ReasoningEffortId
}

/** One settled call, associated with the main turn's ending event. */
export interface SuggestionResult {
  readonly requestSeq: SessionSeq
  readonly turn: number
  readonly status: 'ready' | 'empty' | 'cancelled' | 'error'
  readonly text: string | null
  readonly usage?: TokenUsage
  readonly error?: string
}

/** Accepted model output available for editing in the composer. */
export interface PromptSuggestion {
  readonly requestSeq: SessionSeq
  readonly turn: number
  readonly text: string
}
