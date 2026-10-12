/** Bounded stream assembly for one already-logged auxiliary request. */
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SuggestionConfig } from './config.ts'
import type { SuggestionRequest } from './types.ts'
import type { GeneratedSuggestion } from './engine.ts'
import { parseSuggestion } from './prompt.ts'

/** Assemble one successful text-only auxiliary response.
 * @param request - immutable model-visible input from the Session log.
 * @param config - response byte and character limits.
 * @param stream - the Host LLM dispatch operation.
 * @param signal - lifetime and timeout cancellation for this generation.
 * @returns validated suggestion text and any reported token usage.
 * @throws when cancelled, over budget, incomplete, or finished unsuccessfully.
 */
export async function generateSuggestion(request: SuggestionRequest, config: SuggestionConfig,
  stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>, signal: AbortSignal): Promise<GeneratedSuggestion> {
  signal.throwIfAborted()
  const assembler = new BlockAssembler()
  let bytes = 0
  let finished = false
  for await (const chunk of stream({
    provider: request.provider, model: request.model, messages: request.messages,
    sessionId: request.sessionId, system: request.system, maxTokens: request.maxTokens,
    temperature: request.temperature, signal,
    ...request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort },
  })) {
    signal.throwIfAborted()
    bytes += Buffer.byteLength(JSON.stringify(chunk), 'utf8')
    if (bytes > config.maxResponseBytes) throw new Error('prompt suggestion exceeded maxResponseBytes')
    if (chunk.type === 'finish') finished = true
    assembler.push(chunk)
  }
  signal.throwIfAborted()
  if (!finished || assembler.finish.kind !== 'stop') throw new Error(`prompt suggestion ended with ${finished ? assembler.finish.kind : 'no finish'}`)
  const blocks = assembler.blocks()
  if (blocks.some(block => block.type !== 'text' && block.type !== 'reasoning')) throw new Error('prompt suggestion returned non-text content')
  const text = parseSuggestion(blocks.filter(block => block.type === 'text').map(block => block.text).join(''), config.maxSuggestionChars)
  return { text, ...assembler.usage === undefined ? {} : { usage: assembler.usage } }
}
