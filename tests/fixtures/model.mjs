/** Deterministic external model seam for real-profile integration tests. */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

class FixtureModel extends LlmAdapter {
  async listModels() {
    return [{ id: 'fixture', name: 'Suggestion fixture', contextWindow: 32768, maxTokens: 2048 }]
  }
  async *stream(options) {
    options.signal?.throwIfAborted()
    const auxiliary = options.system?.startsWith('[SUGGESTION MODE:')
    const text = auxiliary ? '给我看一个具体例子。' : '插件会在回复完成后生成下一句话建议。'
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 16, outputTokens: 8 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
export const inject = ['llm']
export function apply(ctx) { ctx.llm.registerAdapter(['suggestion-fixture'], new FixtureModel()) }
