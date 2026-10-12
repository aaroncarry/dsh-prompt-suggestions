// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { SuggestionOverlay } from '../src/client/SuggestionOverlay.tsx'
import type { SuggestionOverlayProps } from '../src/client/SuggestionOverlay.tsx'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let editor: HTMLDivElement
const suggestion = { requestSeq: SessionSeq(8), turn: 1, text: '给我看一个具体例子。' }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  container.setAttribute('data-composer-card', '')
  editor = document.createElement('div')
  editor.setAttribute('contenteditable', 'true')
  container.append(editor)
  document.body.append(container)
  const overlay = document.createElement('div')
  container.append(overlay)
  root = createRoot(overlay)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function props(overrides: Partial<SuggestionOverlayProps> = {}): SuggestionOverlayProps {
  return {
    suggestion, running: false,
    input: { draft: '', draftRev: 4, phase: 'plain', occurrences: [], attachmentIds: [], queue: [] },
    actions: { captureInsertion: vi.fn(), insertText: vi.fn(() => true), setDraft: vi.fn(), addAttachments: vi.fn(),
      removeAttachment: vi.fn(), pruneAttachments: vi.fn(), submit: vi.fn() },
    acceptLabel: '使用建议消息', shortcutLabel: 'Tab 使用 · Esc 关闭', keyLabel: 'Tab ↹', ...overrides,
  }
}

function render(value: SuggestionOverlayProps) { act(() => root.render(<SuggestionOverlay {...value} />)) }
function key(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  act(() => editor.dispatchEvent(event))
  return event
}

describe('composer suggestion interaction', () => {
  it.each(['Tab', 'ArrowRight'])('accepts %s through a revision-checked insertion without sending', name => {
    const value = props()
    render(value)
    expect(container.hasAttribute('data-dsh-prompt-suggestion')).toBe(true)
    expect(key(name).defaultPrevented).toBe(true)
    expect(value.actions.insertText).toHaveBeenCalledWith(suggestion.text, { start: 0, end: 0, draftRev: 4 })
    expect(value.actions.submit).not.toHaveBeenCalled()
    expect(container.querySelector('button')).toBe(null)
  })

  it('preserves Enter as the normal submit gesture', () => {
    const value = props()
    render(value)
    expect(key('Enter').defaultPrevented).toBe(false)
    expect(value.actions.insertText).not.toHaveBeenCalled()
  })

  it('supports clicking the suggestion', () => {
    const value = props()
    render(value)
    act(() => container.querySelector('button')?.click())
    expect(value.actions.insertText).toHaveBeenCalledOnce()
    expect(value.actions.submit).not.toHaveBeenCalled()
  })

  it('dismisses with Escape and displays a later suggestion', () => {
    render(props())
    expect(key('Escape').defaultPrevented).toBe(true)
    expect(container.querySelector('button')).toBe(null)
    render(props({ suggestion: { ...suggestion, requestSeq: SessionSeq(14), turn: 2 } }))
    expect(container.querySelector('button')?.textContent).toContain(suggestion.text)
  })

  it('leaves changed drafts and their keyboard gesture intact when insertion refuses', () => {
    const value = props()
    vi.mocked(value.actions.insertText).mockReturnValue(false)
    render(value)
    expect(key('Tab').defaultPrevented).toBe(false)
    expect(container.querySelector('button')).not.toBe(null)
  })

  it.each([{ isComposing: true }, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }])('passes composition and modified gestures: %j', modifiers => {
    const value = props()
    render(value)
    expect(key('Tab', modifiers).defaultPrevented).toBe(false)
    expect(value.actions.insertText).not.toHaveBeenCalled()
  })

  it('hides a suggestion when typing begins and keeps it dismissed after clearing', () => {
    const value = props()
    render(value)
    render({ ...value, input: { ...value.input, draft: '我自己写', draftRev: 5 } })
    expect(container.querySelector('button')).toBe(null)
    render({ ...value, input: { ...value.input, draftRev: 6 } })
    expect(container.querySelector('button')).toBe(null)
  })

  it('hides during an active turn and removes its DOM binding on unmount', () => {
    const value = props()
    render({ ...value, running: true })
    expect(container.querySelector('button')).toBe(null)
    render(value)
    act(() => root.render(null))
    expect(container.hasAttribute('data-dsh-prompt-suggestion')).toBe(false)
    expect(key('Tab').defaultPrevented).toBe(false)
  })
})
