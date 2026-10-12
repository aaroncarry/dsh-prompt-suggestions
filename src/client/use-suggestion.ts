/** Cancellable suggestion reads over the standard authenticated browser Connection. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PromptSuggestion } from '../types.ts'
import { CHANNEL, ENDPOINT, snapshotSchema } from '../wire.ts'

/** Follow one Session's suggestions without polling or changing its durable events.
 * @param connection - current browser Connection.
 * @param sessionId - selected main Session.
 * @param warn - caller-owned diagnostic sink for a failed read.
 * @returns the latest validated suggestion, or absence.
 */
export function useSuggestion(connection: Pick<ConnectionHandle, 'state' | 'rpc'>, sessionId: SessionId, warn: (error: unknown) => void): PromptSuggestion | null {
  const [current, setCurrent] = useState<{ sessionId: SessionId; suggestion: PromptSuggestion | null } | null>(null)
  const state = useSyncExternalStore(connection.state.subscribe, connection.state.getSnapshot)
  useEffect(() => {
    const controller = new AbortController()
    setCurrent(null)
    void (async () => {
      let after: number | undefined
      while (!controller.signal.aborted) {
        const reply = await connection.rpc.call(CHANNEL, ENDPOINT, { sessionId, ...after === undefined ? {} : { after } }, controller.signal)
        controller.signal.throwIfAborted()
        if (!reply.ok) throw new Error(reply.error.message)
        const snapshot = snapshotSchema.parse(reply.value)
        after = snapshot.version
        setCurrent({ sessionId, suggestion: snapshot.suggestion })
      }
    })().catch(error => { if (!controller.signal.aborted) warn(error) })
    return () => controller.abort(new Error('suggestion view detached'))
  }, [connection, sessionId, state, warn])
  return current?.sessionId === sessionId ? current.suggestion : null
}
