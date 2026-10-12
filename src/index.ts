/** Independent Cordis plugin: background suggestions with plugin-owned audit storage. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { Config, resolveConfig } from './config.ts'
import type { SuggestionConfig } from './config.ts'
import { SuggestionEngine } from './engine.ts'
import { DomainRepository, suggestionDomain } from './store.ts'
import { suggestionRoute } from './transport.ts'
import { generateSuggestion } from './generate.ts'

export { Config }
export type { SuggestionConfig } from './config.ts'
export type { PromptSuggestion, SuggestionRequest, SuggestionResult } from './types.ts'
/** Loader identity. */
export const name = 'prompt-suggestions'
/** Existing Host services required by this plugin. */
export const inject = ['sessions', 'storageDomain', 'connection', 'llm']

/** Mount independent generation, storage, and the authenticated read channel.
 * @param ctx - Host plugin context.
 * @param input - complete deployment policy.
 * @returns completion after the plugin's durable storage is open.
 */
export async function apply(ctx: Context, input: SuggestionConfig): Promise<void> {
  const config = resolveConfig(input)
  const domain = await ctx.storageDomain.open(suggestionDomain)
  const engine = new SuggestionEngine(config, {
    repository: new DomainRepository(domain),
    session: id => ctx.sessions.get(id),
    warn: error => ctx.logger.warn(`prompt-suggestions: ${String(error)}`),
    generate: (request, signal) => generateSuggestion(request, config, options => ctx.llm.stream(options), signal),
  })
  ctx.effect(() => async () => { await engine.dispose(); await domain.close() }, 'prompt-suggestions: background calls and storage')
  ctx.connection.fetch.register(suggestionRoute(engine))
  ctx.on('session/event', (session, event) => engine.observe(session, event))
  ctx.on('session/disposed', session => engine.forget(session))
}
