// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ConnectionHandle, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/client'
import { useSuggestion } from '../src/client/use-suggestion.ts'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
function fixture() {
  const calls: Array<{ signal: AbortSignal | undefined; payload: unknown; resolve: (reply: ConnectionRpcResult<unknown>) => void }> = []
  const connection: Pick<ConnectionHandle, 'state' | 'rpc'> = {
    state: { getSnapshot: () => 'connected', subscribe: () => () => {} },
    rpc: { call: vi.fn((_channel, _endpoint, payload, signal) => new Promise(resolve => { calls.push({ signal, payload, resolve }) })) },
  }
  const warn = vi.fn()
  function View({ id }: { id: string }) {
    const suggestion = useSuggestion(connection, SessionId(id), warn)
    return <span>{suggestion?.text}</span>
  }
  const render = (id: string) => act(() => root.render(<View id={id} />))
  const reply = (text: string, version: number) => ({ ok: true as const,
    value: { version, suggestion: { requestSeq: 4, turn: 1, text } } })
  return { calls, warn, render, reply }
}
it('follows versions, aborts the old selection, and discards its late reply', async () => {
  const { calls, render, reply } = fixture()
  render('first')
  await act(async () => calls[0]!.resolve(reply('first suggestion', 1)))
  expect(container.textContent).toBe('first suggestion')
  expect(calls[1]!.payload).toEqual({ sessionId: 'first', after: 1 })
  render('second')
  expect(calls[1]!.signal?.aborted).toBe(true)
  expect(container.textContent).toBe('')
  await act(async () => calls[1]!.resolve(reply('stale suggestion', 2)))
  expect(container.textContent).toBe('')
  await act(async () => calls[2]!.resolve(reply('second suggestion', 3)))
  expect(container.textContent).toBe('second suggestion')
  act(() => root.render(null))
  expect(calls[3]!.signal?.aborted).toBe(true)
})
it('reports invalid wire output without displaying it or issuing another read', async () => {
  const { calls, render, warn } = fixture()
  render('main')
  await act(async () => calls[0]!.resolve({ ok: true, value: { version: -1, suggestion: 'invalid' } }))
  expect(warn).toHaveBeenCalledOnce()
  expect(calls).toHaveLength(1)
  expect(container.textContent).toBe('')
})
