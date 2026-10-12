/** Cordis Client plugin registering the suggestion overlay and authenticated reader. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SuggestionOverlay } from './SuggestionOverlay.tsx'
import { useSuggestion } from './use-suggestion.ts'
import { en, zh } from './locales.ts'
import css from './style.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { promptSuggestions: keyof typeof en }
}

/** Existing Client service requirements. */
export const inject = ['slots', 'locale', 'connection']

/** Install reversible Client contributions.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: Context & { readonly connection: ConnectionHandle }): void {
  ctx.effect(() => ctx.locale.register('promptSuggestions', { en, zh }), 'prompt-suggestions: dictionaries')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    return () => style.remove()
  }, 'prompt-suggestions: stylesheet')
  const warn = (error: unknown): void => { ctx.logger.warn(`prompt-suggestions: ${String(error)}`) }
  function SuggestionSlot({ useInput, useSession, inputActions, t }:
    PropsRuntime<'conversation.input.overlay'> & PropsLocale<'promptSuggestions'>) {
    const sessionId = useSession(value => value.sessionId)
    const running = useSession(value => value.running)
    const suggestion = useSuggestion(ctx.connection, sessionId, warn)
    const input = useInput(value => value)
    return <SuggestionOverlay suggestion={suggestion} input={input} running={running} actions={inputActions}
      acceptLabel={t('accept')} shortcutLabel={t('shortcut')} keyLabel={t('keyLabel')} />
  }
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay', id: 'prompt-suggestions', order: 20, locale: 'promptSuggestions',
  }, SuggestionSlot))
}
