/** Bounded conversation framing and next-message output validation. */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, Message, UserMessage } from '@deepseek-ai/dsh-llm'
import type { SuggestionConfig } from './config.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-prompt-suggestions': { kind: 'dsh-prompt-suggestions' } & ContextFormed
  }
}

/** Bounded next-user-message prediction instructions. */
export const SYSTEM_PROMPT = `[SUGGESTION MODE: Suggest what the user might naturally type next into the assistant.]

Use only the conversation provided below. Do not assume facts, intent, or context that are not present.

Your job is to predict what THEY would type next — not what you think they should do.

Would they think: "I was just about to type that"?

When the next step is not obvious, output nothing.

NEVER SUGGEST:
- Evaluative comments ("looks good", "thanks")
- Questions ("what about...?")
- Assistant-voice text ("Let me...", "I'll...", "Here's...")
- New ideas or tasks the user did not request
- A new goal, direction, or unrelated action
- Multiple sentences
- Unsafe, sensitive, privacy-invasive, or inappropriate actions

EXAMPLES:
User asked "fix the bug and run tests", and the bug is fixed → "run the tests"
After code is written → "try it out"
The assistant offers options → suggest the option the user would most likely choose
The assistant asks whether to continue → "yes" or "go ahead"
The task is complete and the next step is obvious → "commit this" or "push it"
After an error or misunderstanding → output nothing

Be specific: "run the tests" is better than "continue".

Format: one short, concise phrase in the user's language, no longer than the configured limit. Or nothing.

Reply with exactly one line containing only the suggestion, without quotes or explanation.`

/** Frame the latest human and assistant text within a complete UTF-8 byte budget.
 * @param messages - current derived conversation, including system and tool messages.
 * @param config - input count and byte bounds.
 * @returns one exact model input, or null when the latest exchange cannot fit.
 */
export function frameConversation(messages: readonly Message[], config: SuggestionConfig): UserMessage[] | null {
  const transcript = messages.flatMap(message => {
    if (message.role !== 'assistant' && (message.role !== 'user' || message.source.kind !== 'user')) return []
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim()
    return text === '' ? [] : [{ role: message.role, text }]
  }).slice(-config.maxContextMessages)
  if (transcript.at(-1)?.role !== 'assistant') return null
  while (transcript.length >= 2) {
    const text = JSON.stringify({ transcript })
    if (Buffer.byteLength(SYSTEM_PROMPT + text, 'utf8') <= config.maxInputBytes) {
      if (!transcript.some(message => message.role === 'user')) return null
      return [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'dsh-prompt-suggestions' } })]
    }
    transcript.shift()
  }
  return null
}

/** Validate the complete output; malformed or truncated suggestions stay hidden.
 * @param text - assembled visible model text.
 * @param maxChars - maximum Unicode code points in one suggestion.
 * @returns a plain one-line suggestion or null.
 */
export function parseSuggestion(text: string, maxChars: number): string | null {
  const value = text.trim()
  if (value === '' || value === 'NONE' || /[\r\n\u0000-\u001f\u007f]/u.test(value)) return null
  if ([...value].length > maxChars || /^(?:["'“‘`]|[-*#]\s|\d+[.)]\s)/u.test(value)) return null
  return value
}
