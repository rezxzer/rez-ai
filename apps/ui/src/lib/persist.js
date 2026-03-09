export const STORAGE_KEY = 'rez-ai-chats-v1'

const asString = (v, fallback = '') =>
  typeof v === 'string' ? v : (v == null ? fallback : String(v))

const normalizeMessage = (msg, idx) => {
  const role = msg?.role === 'user' ? 'user' : 'assistant'
  return {
    id: asString(msg?.id, `msg-${Date.now()}-${idx}`),
    role,
    content: asString(msg?.content, ''),
    // Keep as string in persisted schema; UI can convert when rendering
    timestamp: asString(msg?.timestamp, new Date().toISOString())
  }
}

const normalizeChat = (chat, idx, defaults) => {
  const rawMessages = Array.isArray(chat?.messages) ? chat.messages : []
  return {
    id: asString(chat?.id, `chat-${Date.now()}-${idx}`),
    title: asString(chat?.title, `Chat ${idx + 1}`),
    messages: rawMessages.map((m, mIdx) => normalizeMessage(m, mIdx)),
    systemPrompt: asString(chat?.systemPrompt, defaults.systemPrompt || ''),
    provider: asString(chat?.provider, defaults.provider || 'lmstudio'),
    model: asString(chat?.model, defaults.model || ''),
    presetId: asString(chat?.presetId, defaults.presetId || 'general'),
    notes: asString(chat?.notes, '')
  }
}

export function loadPersistedState(defaults = {}) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    const rawChats = Array.isArray(parsed.chats) ? parsed.chats : []
    const chats = rawChats.map((c, idx) => normalizeChat(c, idx, defaults))
    if (!chats.length) return null

    const rawActive = asString(parsed.activeChatId, '')
    const activeChatId = chats.some((c) => c.id === rawActive) ? rawActive : chats[0].id

    return { chats, activeChatId }
  } catch {
    // Corrupted payload should not keep breaking hydration.
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
    return null
  }
}

export function savePersistedState(payload) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Keep UI responsive even if storage quota/permissions fail.
  }
}
