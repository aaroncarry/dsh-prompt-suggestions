import { describe, expect, it, vi } from 'vitest'
import { suggestionRoute } from '../src/transport.ts'

function request(body: string, contentType = 'application/json') {
  return new Request('http://localhost/api/prompt-suggestions/watch', {
    method: 'POST', headers: { 'content-type': contentType }, body,
  })
}
describe('plugin route wire validation', () => {
  it.each([
    ['{', 'application/json', 400],
    ['{}', 'text/plain', 415],
    [JSON.stringify({ type: 'client-request', rpcId: 'one', method: 'wrong', payload: { sessionId: 'main' } }), 'application/json', 400],
    [JSON.stringify({ type: 'client-request', rpcId: 'one', method: 'prompt-suggestions/watch', payload: { sessionId: 'main', after: -1 } }), 'application/json', 400],
  ])('refuses %s before reading state', async (body, type, status) => {
    const watch = vi.fn()
    expect((await suggestionRoute({ watch }).fetch(request(body, type))).status).toBe(status)
    expect(watch).not.toHaveBeenCalled()
  })
  it('returns a correlated response and passes request cancellation to the read', async () => {
    const value = { version: 7, suggestion: null }
    const watch = vi.fn(async () => value)
    const input = request(JSON.stringify({ type: 'client-request', rpcId: 'one', method: 'prompt-suggestions/watch', payload: { sessionId: 'main', after: 6 } }))
    const response = await suggestionRoute({ watch }).fetch(input)
    expect(watch).toHaveBeenCalledWith('main', 6, input.signal)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ type: 'server-response', rpcId: 'one', result: { ok: true, value } })
  })
})
