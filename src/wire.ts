/** JSON validation shared by the plugin's authenticated RPC and storage readers. */
import { z } from 'zod'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'

/** Validate and brand a main-session event sequence. */
export const sequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(value => value as SessionSeq)
/** Validate and brand a session identity received over a wire or from storage. */
export const sessionIdSchema = z.string().min(1).transform(value => value as SessionId)
/** One editable suggestion; its request sequence identifies the triggering main turn. */
export const suggestionSchema = z.object({ requestSeq: sequenceSchema, turn: z.number().int().nonnegative(), text: z.string().min(1) })
/** A long-poll response; versions belong to the current Host process. */
export const snapshotSchema = z.object({ version: z.number().int().nonnegative(), suggestion: suggestionSchema.nullable() })
/** Validated plugin read request. */
export const watchSchema = z.object({ sessionId: sessionIdSchema, after: z.number().int().nonnegative().optional() }).strict()
/** Shared private RPC channel, carried by the standard authenticated Connection. */
export const CHANNEL = '/api'
/** Plugin-owned endpoint below the existing authenticated API channel. */
export const ENDPOINT = 'prompt-suggestions/watch'
