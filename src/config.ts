/** Loader configuration and explicit deployment-policy resolution. */
import z from '@deepseek-ai/schemastery'

/** Configurable bounds and optional auxiliary model route. */
export interface SuggestionConfig {
  readonly enabled: boolean
  readonly maxContextMessages: number
  readonly maxInputBytes: number
  readonly maxOutputTokens: number
  readonly maxResponseBytes: number
  readonly maxSuggestionChars: number
  readonly timeoutMs: number
  readonly temperature: number
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
}

/** Deployment settings; the installable profile layer supplies their values. */
export const Config: z<SuggestionConfig> = z.object({
  enabled: z.boolean().required(),
  maxContextMessages: z.number().step(1).min(2).required(),
  maxInputBytes: z.number().step(1).min(1).required(),
  maxOutputTokens: z.number().step(1).min(1).required(),
  maxResponseBytes: z.number().step(1).min(1).required(),
  maxSuggestionChars: z.number().step(1).min(1).required(),
  timeoutMs: z.number().step(1).min(1).max(2_147_483_647).required(),
  temperature: z.number().min(0).max(2).required(),
  provider: z.string(), model: z.string(), reasoningEffort: z.string(),
})

/** Validate a complete policy and reject half-configured routes at load.
 * @param input - Loader or direct-construction settings.
 * @returns validated settings with no implicit dispatch defaults.
 */
export function resolveConfig(input: SuggestionConfig): SuggestionConfig {
  const config = Config(input)
  if ((config.provider === undefined) !== (config.model === undefined)) {
    throw new Error('prompt-suggestions: provider and model must be configured together')
  }
  if (config.provider?.trim() === '' || config.model?.trim() === '') {
    throw new Error('prompt-suggestions: provider and model must be nonempty')
  }
  if (config.reasoningEffort?.trim() === '') throw new Error('prompt-suggestions: reasoningEffort must be nonempty')
  return Object.freeze(config)
}
