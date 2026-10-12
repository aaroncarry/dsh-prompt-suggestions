/** Composer overlay using public draft actions and a card-scoped DOM key binding. */
import { useLayoutEffect, useRef, useState } from 'react'
import type { InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PromptSuggestion } from '../types.ts'

/** Presentation values from the standard Session and input hooks. */
export interface SuggestionOverlayProps {
  readonly suggestion: PromptSuggestion | null | undefined
  readonly input: InputState
  readonly running: boolean
  readonly actions: InputActions
  readonly acceptLabel: string
  readonly shortcutLabel: string
  readonly keyLabel: string
}

/** Render a one-line suggestion that fills a revision-checked draft without sending it.
 * @param props - current suggestion, input state, actions, and localized copy.
 * @returns the card overlay and its lifecycle anchor.
 */
export function SuggestionOverlay({ suggestion, input, running, actions, acceptLabel, shortcutLabel, keyLabel }: SuggestionOverlayProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [dismissed, setDismissed] = useState<PromptSuggestion['requestSeq'] | null>(null)
  const empty = input.draft === '' && input.attachmentIds.length === 0 && input.phase === 'plain'
  const visible = suggestion != null && empty && !running && dismissed !== suggestion.requestSeq

  const accept = (): boolean => {
    if (!visible || suggestion == null) return false
    const inserted = actions.insertText(suggestion.text, { start: 0, end: 0, draftRev: input.draftRev })
    if (inserted) setDismissed(suggestion.requestSeq)
    return inserted
  }

  useLayoutEffect(() => {
    if (suggestion != null && !empty) setDismissed(suggestion.requestSeq)
  }, [suggestion, empty])

  useLayoutEffect(() => {
    const card = anchor.current?.closest<HTMLElement>('[data-composer-card]')
    if (card === undefined || card === null || !visible || suggestion == null) return
    card.setAttribute('data-dsh-prompt-suggestion', '')
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const target = event.target
      if (!(target instanceof HTMLElement) || target.closest('[contenteditable="true"]')?.closest('[data-composer-card]') !== card) return
      if (event.key === 'Escape') {
        setDismissed(suggestion.requestSeq)
      } else if (event.key !== 'Tab' && event.key !== 'ArrowRight') {
        return
      } else if (!accept()) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
    }
    card.addEventListener('keydown', onKey, true)
    return () => {
      card.removeEventListener('keydown', onKey, true)
      card.removeAttribute('data-dsh-prompt-suggestion')
    }
  })

  return <>
    <span ref={anchor} hidden />
    {visible && <button type="button" className="dsh-prompt-suggestion" aria-label={acceptLabel} title={shortcutLabel}
      onMouseDown={event => event.preventDefault()} onClick={accept}>
      <span className="dsh-prompt-suggestion-text">{suggestion.text}</span>
      <span className="dsh-prompt-suggestion-key" aria-hidden>{keyLabel}</span>
    </button>}
  </>
}
