/** Authenticated auxiliary reads through the existing Connection Fetch registry. */
import { z } from 'zod'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import type { SuggestionEngine } from './engine.ts'
import { CHANNEL, ENDPOINT, watchSchema } from './wire.ts'

const envelope = z.object({
  type: z.literal('client-request'), rpcId: z.string().min(1), method: z.literal(ENDPOINT), payload: watchSchema,
}).strict()

/** Build a read-only route using Connection's standard unary RPC envelopes.
 * @param engine - suggestion generation and read owner.
 * @returns an exact route admitted by the existing API trust and authentication policy.
 */
export function suggestionRoute(engine: Pick<SuggestionEngine, 'watch'>): ConnectionFetchRoute {
  return {
    path: `${CHANNEL}/${ENDPOINT}`, methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }
      let body: unknown
      try { body = await request.json() }
      catch (error) { return new Response('body is not JSON', { status: 400 }) }
      const parsed = envelope.safeParse(body)
      if (!parsed.success) return new Response('invalid suggestion read request', { status: 400 })
      const { rpcId, payload } = parsed.data
      const value = await engine.watch(payload.sessionId, payload.after, request.signal)
      return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } },
        { headers: { 'cache-control': 'no-store' } })
    },
  }
}
