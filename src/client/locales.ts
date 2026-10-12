/** Locale-owned composer suggestion copy. */
export const en = { accept: 'Use suggested message', shortcut: 'Tab to use · Esc to dismiss', keyLabel: 'Tab ↹' }
/** Chinese composer suggestion copy. */
export const zh: Record<keyof typeof en, string> = { accept: '使用建议消息', shortcut: 'Tab 使用 · Esc 关闭', keyLabel: 'Tab ↹' }
/** Dictionary key vocabulary. */
export type SuggestionKey = keyof typeof en
