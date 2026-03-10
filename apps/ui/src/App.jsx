import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import './App.css'
import { PRESETS, getPresetById } from './presets'
import { STORAGE_KEY, loadPersistedState, savePersistedState } from './lib/persist'

const PROVIDERS = [
  { id: 'lmstudio', label: 'LM Studio' },
  { id: 'ollama', label: 'Ollama' }
]
const LOCAL_PROVIDER_IDS = ['lmstudio', 'ollama']
const DEFAULT_FALLBACK_ORDER = ['lmstudio', 'ollama']
const PLAN_MODES = [
  { id: 'free', label: 'Free' },
  { id: 'pro', label: 'Pro' }
]
const parsedMaxMessageChars = Number.parseInt(import.meta.env.VITE_MAX_MESSAGE_CHARS ?? '8000', 10)
const MAX_MESSAGE_CHARS = Number.isFinite(parsedMaxMessageChars) && parsedMaxMessageChars > 0
  ? parsedMaxMessageChars
  : 8000
const SOFT_WARNING_THRESHOLD = Math.max(Math.floor(MAX_MESSAGE_CHARS * 0.875), 1)
const SUMMARY_INTERVAL = 6
const SUMMARY_MAX_LENGTH = 400
const parsedTimeout = Number.parseInt(import.meta.env.VITE_REQUEST_TIMEOUT_MS ?? '30000', 10)
const REQUEST_TIMEOUT_MS = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 30000
const BACKEND_BASE_URL = (import.meta.env.VITE_BACKEND_BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
const DEV_RESPONSE_STRUCTURE_RULE = [
  'Developer response structure (mandatory, exact order):',
  '1) Files touched',
  '2) Exact edits (copy-paste ready)',
  '3) Manual verify (3-5)',
  '4) Optional: max 1 precise question only if blocked'
].join('\n')
const OPS_SNAPSHOT_KEY = 'rez-ai-ops-snapshot-v1'
const OPS_WINDOW_SIZE = 50
const FALLBACK_ORDER_KEY = 'rez-ai-provider-fallback-order-v1'
const PREFLIGHT_RESULT_KEY = 'rez-ai-preflight-last-v1'
const MAINT_REMINDER_DISMISS_KEY = 'rez-ai-maint-reminder-dismiss-v1'
const MAINT_REMINDER_COOLDOWN_KEY = 'rez-ai-maint-reminder-cooldown-v1'
const MAINT_REMINDER_COOLDOWN_MS = 120000
const RECOVERY_FEEDBACK_KEY = 'rez-ai-recovery-feedback-v1'
const RECOVERY_CONFIDENCE_HINT_KEY = 'rez-ai-recovery-confidence-hint-v1'
const RECENCY_ALIGNMENT_HINT_KEY = 'rez-ai-recency-alignment-hint-v1'
const ALIGNMENT_CONFIDENCE_MARKER_KEY = 'rez-ai-alignment-confidence-marker-v1'
const RECHECK_OUTCOME_MARKER_KEY = 'rez-ai-recheck-outcome-marker-v1'
const RECHECK_CONFIDENCE_STABILITY_MARKER_KEY = 'rez-ai-recheck-confidence-stability-marker-v1'
const RECHECK_ALIGNMENT_MARKER_KEY = 'rez-ai-recheck-alignment-marker-v1'
const RECHECK_POSTURE_CONFIDENCE_MARKER_KEY = 'rez-ai-recheck-posture-confidence-marker-v1'
const ADVISORY_DETAILS_STATS_KEY = 'rez-ai-advisory-details-stats-v1'
const ADVISORY_DETAILS_PREFLIGHT_KEY = 'rez-ai-advisory-details-preflight-v1'
const ADVANCED_COMPOSER_TOOLS_KEY = 'rez-ai-advanced-composer-tools-v1'

const normalizeFallbackOrder = (rawOrder) => {
  const src = Array.isArray(rawOrder) ? rawOrder : []
  const unique = src
    .map((v) => String(v || '').trim().toLowerCase())
    .filter((v) => LOCAL_PROVIDER_IDS.includes(v))
    .filter((v, idx, arr) => arr.indexOf(v) === idx)
  for (const id of LOCAL_PROVIDER_IDS) {
    if (!unique.includes(id)) unique.push(id)
  }
  return unique.slice(0, LOCAL_PROVIDER_IDS.length)
}

const parseMarkdownBlocks = (text) => {
  const source = String(text || '')
  const blocks = []
  const codeFenceRe = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g
  let cursor = 0
  let match

  while ((match = codeFenceRe.exec(source)) !== null) {
    if (match.index > cursor) {
      blocks.push({ type: 'text', content: source.slice(cursor, match.index) })
    }
    blocks.push({
      type: 'code',
      lang: (match[1] || '').trim(),
      code: match[2] || ''
    })
    cursor = codeFenceRe.lastIndex
  }

  if (cursor < source.length) {
    blocks.push({ type: 'text', content: source.slice(cursor) })
  }

  return blocks
}

const renderInlineFormatting = (text, keyPrefix) => {
  const parts = String(text || '').split(/(`[^`]+`)/g)
  const out = []
  let i = 0

  parts.forEach((part) => {
    if (!part) return
    const isInlineCode = /^`[^`]+`$/.test(part)
    if (isInlineCode) {
      out.push(
        <code key={`${keyPrefix}-code-${i++}`} className="md-inline-code">
          {part.slice(1, -1)}
        </code>
      )
      return
    }

    const styled = part.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
    styled.forEach((token) => {
      if (!token) return
      if (/^\*\*[^*]+\*\*$/.test(token)) {
        out.push(
          <strong key={`${keyPrefix}-bold-${i++}`} className="md-bold">
            {token.slice(2, -2)}
          </strong>
        )
        return
      }
      if (/^\*[^*]+\*$/.test(token)) {
        out.push(
          <em key={`${keyPrefix}-italic-${i++}`} className="md-italic">
            {token.slice(1, -1)}
          </em>
        )
        return
      }
      out.push(<span key={`${keyPrefix}-txt-${i++}`}>{token}</span>)
    })
  })

  return out
}

const renderTextBlock = (text, keyPrefix) => {
  const lines = String(text || '').split('\n')
  const nodes = []
  let i = 0

  while (i < lines.length) {
    const ulMatch = lines[i].match(/^\s*[-*]\s+(.+)$/)
    const olMatch = lines[i].match(/^\s*\d+\.\s+(.+)$/)

    if (ulMatch) {
      const items = []
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*]\s+(.+)$/)
        if (!m) break
        items.push(m[1])
        i++
      }
      nodes.push(
        <ul key={`${keyPrefix}-ul-${i}`} className="md-list">
          {items.map((item, idx) => (
            <li key={`${keyPrefix}-ul-item-${idx}`} className="md-list-item">
              {renderInlineFormatting(item, `${keyPrefix}-ul-inline-${idx}`)}
            </li>
          ))}
        </ul>
      )
      continue
    }

    if (olMatch) {
      const items = []
      while (i < lines.length) {
        const m = lines[i].match(/^\s*\d+\.\s+(.+)$/)
        if (!m) break
        items.push(m[1])
        i++
      }
      nodes.push(
        <ol key={`${keyPrefix}-ol-${i}`} className="md-olist">
          {items.map((item, idx) => (
            <li key={`${keyPrefix}-ol-item-${idx}`} className="md-list-item">
              {renderInlineFormatting(item, `${keyPrefix}-ol-inline-${idx}`)}
            </li>
          ))}
        </ol>
      )
      continue
    }

    const line = lines[i]
    nodes.push(
      <p key={`${keyPrefix}-line-${i}`} className="md-line">
        {line ? renderInlineFormatting(line, `${keyPrefix}-line-inline-${i}`) : '\u00A0'}
      </p>
    )
    i++
  }

  return nodes
}

const renderMarkdownLite = ({ text, messageId, onCopyCode, copiedCodeKey }) => {
  const blocks = parseMarkdownBlocks(text)
  return blocks.map((block, i) => {
    if (block.type === 'code') {
      const codeKey = `${messageId}-code-${i}`
      return (
        <div key={codeKey} className="md-code-block">
          <div className="md-code-head">
            <span className="md-code-lang">{block.lang || 'text'}</span>
            <button className="md-code-copy" onClick={() => onCopyCode(block.code, codeKey)}>
              {copiedCodeKey === codeKey ? 'Copied' : 'Copy code'}
            </button>
          </div>
          <pre className="md-code">
            <code>{block.code}</code>
          </pre>
        </div>
      )
    }

    return (
      <div key={`${messageId}-text-${i}`} className="md-text-block">
        {renderTextBlock(block.content, `${messageId}-text-${i}`)}
      </div>
    )
  })
}

// ---- Time formatting ----
const formatTime = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

const buildConversationSummary = (messages, prevSummary = '') => {
  const compact = (value, max = 140) => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim()
    if (!normalized) return ''
    return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
  }
  const truncate = (value, max = SUMMARY_MAX_LENGTH) => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim()
    if (!normalized) return ''
    return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
  }

  const list = Array.isArray(messages) ? messages.filter((m) => m && typeof m === 'object') : []
  if (!list.length) return truncate(prevSummary || '')

  const latestByRole = (role) => [...list].reverse().find((m) => m.role === role && String(m.content || '').trim())
  const latestUser = latestByRole('user')
  const latestAssistant = latestByRole('assistant')
  const pickLine = (text, re) => {
    const lines = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    const hit = lines.find((line) => re.test(line))
    return hit || lines[0] || ''
  }

  const goalLine = latestUser
    ? pickLine(latestUser.content, /(goal|task|build|implement|fix|update|add|create|მიზანი|ამოცანა)/i)
    : ''
  const resultLine = latestAssistant
    ? pickLine(latestAssistant.content, /(result|implemented|done|completed|updated|fixed|added|status|pass|improved|no-change|regressed|დასრულ)/i)
    : ''

  const parts = []
  if (goalLine) parts.push(`Goal: ${compact(goalLine, 120)}`)
  if (resultLine) parts.push(`Latest result: ${compact(resultLine, 120)}`)

  if (!parts.length) {
    const recentTurns = list
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .slice(-3)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${compact(String(m.content || '').split(/\r?\n/)[0], 80)}`)
    if (recentTurns.length) {
      parts.push(`Recent: ${recentTurns.join(' | ')}`)
    } else if (prevSummary) {
      parts.push(compact(prevSummary, 160))
    }
  }

  return truncate(`SUMMARY: ${parts.join(' ')}`)
}

const compactContextText = (value, max = 180) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

const assembleContextMessages = (messages, conversationSummary) => {
  const list = Array.isArray(messages) ? messages : []
  const summary = String(conversationSummary || '').trim()
  if (summary) {
    return [
      { role: 'system', content: `Conversation summary: ${compactContextText(summary, SUMMARY_MAX_LENGTH)}` },
      ...list.slice(-4).map((m) => ({
        role: String(m?.role || 'user'),
        content: compactContextText(m?.content || '', 180)
      }))
    ]
  }
  return list.slice(-6).map((m) => ({
    role: String(m?.role || 'user'),
    content: compactContextText(m?.content || '', 180)
  }))
}

// ---- Animated dots ----
const ThinkingDots = () => {
  const [dots, setDots] = useState(1)
  useEffect(() => {
    const interval = setInterval(() => setDots((prev) => (prev % 3) + 1), 500)
    return () => clearInterval(interval)
  }, [])
  return <span className="thinking-dots">{'●'.repeat(dots)}{'○'.repeat(3 - dots)}</span>
}

// ---- Toast ----
const Toast = ({ message, onClose, tone = 'warn', icon = '⚠️' }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 8000)
    return () => clearTimeout(timer)
  }, [onClose])

  // Esc closes toast (innovation)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={`toast ${tone}`} role="status" aria-live="polite">
      <span className="toast-icon">{icon}</span>
      <span className="toast-message">{message}</span>
      <button className="toast-close" onClick={onClose} aria-label="Close">×</button>
    </div>
  )
}

function App() {
  // State
  const DEFAULT_PRESET_ID = 'general'
  const DEFAULT_SYSTEM_PROMPT = getPresetById(DEFAULT_PRESET_ID).systemPromptTemplate

  const [promptSavedToast, setPromptSavedToast] = useState(null)

  const makeWelcome = () => ([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Welcome to REZ-AI Local Operator Console.\nShare a practical goal, context, and constraints. I can help break work into executable steps, use KB context when enabled, and keep workflows local-first/private.\n\nStarter developer/project flows:\n- Feature planning: scope -> dependencies -> implementation steps -> verify checklist\n- Bug breakdown: reproduce -> likely root cause -> minimal fix plan -> regression checks\n- Execution handoff: extract checklist -> draft Cursor-ready prompt -> run + verify\n\nBackend connected to LM Studio at localhost:3001.',
      timestamp: new Date()
    }
  ])

  const makeDefaultChats = useCallback(() => ([
    {
      id: 'default',
      title: 'Default Chat',
      messages: makeWelcome(),
      presetId: DEFAULT_PRESET_ID,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      provider: 'lmstudio',
      model: '',
      notes: ''
    }
  ]), [DEFAULT_PRESET_ID, DEFAULT_SYSTEM_PROMPT])

  const [persistedInit] = useState(() => loadPersistedState({
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    provider: 'lmstudio',
    model: '',
    presetId: DEFAULT_PRESET_ID
  }))

  const [chats, setChats] = useState(() => persistedInit?.chats ?? makeDefaultChats())
  const [activeChatId, setActiveChatId] = useState(() => (
    persistedInit?.activeChatId || persistedInit?.chats?.[0]?.id || 'default'
  ))

  // Derived: active messages
  const activeChat = useMemo(
    () => chats.find(c => c.id === activeChatId) || chats[0],
    [chats, activeChatId]
  )
  const activePreset = useMemo(
    () => getPresetById(activeChat?.presetId || DEFAULT_PRESET_ID),
    [activeChat?.presetId]
  )
  const chatId = String(activeChatId || '')
  const messages = useMemo(
    () => activeChat?.messages ?? [],
    [activeChat?.messages]
  )
  const [conversationSummary, setConversationSummary] = useState('')
  const [summaryLoadedChatId, setSummaryLoadedChatId] = useState('')

  useEffect(() => {
    if (!chatId) return
    try {
      const cached = localStorage.getItem(`conversationSummary:${chatId}`)
      setConversationSummary(cached ? String(cached) : '')
    } catch {
      setConversationSummary('')
    }
    setSummaryLoadedChatId(chatId)
  }, [chatId])

  useEffect(() => {
    if (!chatId) return
    if (summaryLoadedChatId !== chatId) return
    const count = Array.isArray(messages) ? messages.length : 0
    if (!count || count % SUMMARY_INTERVAL !== 0) return
    setConversationSummary((prev) => {
      const nextSummary = buildConversationSummary(messages, prev)
      return prev === nextSummary ? prev : nextSummary
    })
  }, [messages, messages.length, chatId, summaryLoadedChatId])

  useEffect(() => {
    if (!chatId) return
    if (summaryLoadedChatId !== chatId) return
    try {
      localStorage.setItem(`conversationSummary:${chatId}`, String(conversationSummary || ''))
    } catch {
      // ignore localStorage write failures for summary cache
    }
  }, [chatId, summaryLoadedChatId, conversationSummary])

  // Save chats on change
  useEffect(() => {
    savePersistedState({ chats, activeChatId })
  }, [chats, activeChatId])

  useEffect(() => {
    console.log('[persist] hydrated', { key: STORAGE_KEY, chatCount: chats.length, activeChatId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-clear small "saved" toast
  useEffect(() => {
    if (!promptSavedToast) return
    const t = setTimeout(() => setPromptSavedToast(null), 1800)
    return () => clearTimeout(t)
  }, [promptSavedToast])

  const [inputValue, setInputValue] = useState('')
  const [lastUserText, setLastUserText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [rebuildHelperChatId, setRebuildHelperChatId] = useState(null)
  const [lastStats, setLastStats] = useState({ tokensIn: 0, tokensOut: 0 })
  const [lastLatencyMs, setLastLatencyMs] = useState(null)
  const [lastModelName, setLastModelName] = useState(null)
  const [lastProviderName, setLastProviderName] = useState(null)
  const [lastUsageMode, setLastUsageMode] = useState('approx')
  const [lastKbEnabled, setLastKbEnabled] = useState(false)
  const [lastKBHits, setLastKBHits] = useState(0)
  const [lastKBMode, setLastKBMode] = useState('lexical')
  const [lastKBInfluenced, setLastKBInfluenced] = useState(false)
  const [lastKBSourceCount, setLastKBSourceCount] = useState(0)
  const [lastKBCitations, setLastKBCitations] = useState([])
  const [lastKBTopK, setLastKBTopK] = useState(4)
  const [providerId, setProviderId] = useState(() => {
    try {
      const raw = String(localStorage.getItem('rez-ai-provider-v1') || '').trim().toLowerCase()
      return LOCAL_PROVIDER_IDS.includes(raw) ? raw : 'lmstudio'
    } catch {
      return 'lmstudio'
    }
  })
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('rez-ai-model-v1') || '')
  const [planMode, setPlanMode] = useState(() => localStorage.getItem('rez-ai-plan-mode-v1') || 'free')
  const [providerFallbackOrder, setProviderFallbackOrder] = useState(() => {
    try {
      const raw = localStorage.getItem(FALLBACK_ORDER_KEY)
      const parsed = raw ? JSON.parse(raw) : DEFAULT_FALLBACK_ORDER
      return normalizeFallbackOrder(parsed)
    } catch {
      return DEFAULT_FALLBACK_ORDER
    }
  })
  const [availableModels, setAvailableModels] = useState([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState(null)
  const [insertPresetId, setInsertPresetId] = useState(() => activeChat?.presetId || DEFAULT_PRESET_ID)
  const [chunkProgress, setChunkProgress] = useState(null)
  const [useKB, setUseKB] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [editingChatId, setEditingChatId] = useState(null)
  const [editingChatTitle, setEditingChatTitle] = useState('')
  const [lastContractSnapshot, setLastContractSnapshot] = useState(null)
  const [dismissedReminderKey, setDismissedReminderKey] = useState(() => localStorage.getItem(MAINT_REMINDER_DISMISS_KEY) || '')
  const [recoveryFeedback, setRecoveryFeedback] = useState(() => {
    try {
      const raw = localStorage.getItem(RECOVERY_FEEDBACK_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (!parsed) return null
      const before = {
        contract: String(parsed?.before?.contract || '-'),
        provider: String(parsed?.before?.provider || '-'),
        trend: String(parsed?.before?.trend || '-')
      }
      const after = parsed?.after
        ? {
          contract: String(parsed?.after?.contract || '-'),
          provider: String(parsed?.after?.provider || '-'),
          trend: String(parsed?.after?.trend || '-')
        }
        : null
      const result = String(parsed?.result || '')
      if (!['improved', 'no-change', 'regressed'].includes(result)) return null
      return {
        actionLabel: String(parsed?.actionLabel || 'action'),
        before,
        after,
        result,
        at: String(parsed?.at || new Date().toISOString())
      }
    } catch {
      return null
    }
  })
  const [recoveryConfidenceHint, setRecoveryConfidenceHint] = useState(() => {
    try {
      const raw = localStorage.getItem(RECOVERY_CONFIDENCE_HINT_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      const level = String(parsed?.level || '')
      if (!['rising', 'stable', 'uncertain'].includes(level)) return null
      return {
        level,
        text: String(parsed?.text || `confidence ${level}`),
        at: String(parsed?.at || new Date().toISOString())
      }
    } catch {
      return null
    }
  })
  const [recencyAlignmentHint, setRecencyAlignmentHint] = useState(() => {
    try {
      const raw = localStorage.getItem(RECENCY_ALIGNMENT_HINT_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      const label = String(parsed?.label || '')
      if (!['aligned', 'lagging', 'na'].includes(label)) return null
      return {
        label,
        text: String(parsed?.text || ''),
        at: String(parsed?.at || new Date().toISOString())
      }
    } catch {
      return null
    }
  })
  const [alignmentConfidenceMarker, setAlignmentConfidenceMarker] = useState(() => {
    try {
      const raw = localStorage.getItem(ALIGNMENT_CONFIDENCE_MARKER_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      const label = String(parsed?.label || '')
      if (!['coherent', 'mixed'].includes(label)) return null
      return {
        label,
        text: String(parsed?.text || ''),
        at: String(parsed?.at || new Date().toISOString())
      }
    } catch {
      return null
    }
  })
  const [recheckOutcomeMarker, setRecheckOutcomeMarker] = useState(() => {
    try {
      const raw = localStorage.getItem(RECHECK_OUTCOME_MARKER_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      const label = String(parsed?.label || '')
      if (!['confirming', 'mixed', 'degraded'].includes(label)) return null
      return {
        label,
        text: String(parsed?.text || ''),
        at: String(parsed?.at || new Date().toISOString())
      }
    } catch {
      return null
    }
  })
  const [recheckConfidenceStabilityMarker, setRecheckConfidenceStabilityMarker] = useState(() => {
    try {
      const raw = localStorage.getItem(RECHECK_CONFIDENCE_STABILITY_MARKER_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      const label = String(parsed?.label || '')
      if (!['stabilizing', 'mixed', 'degrading'].includes(label)) return null
      return {
        label,
        text: String(parsed?.text || ''),
        at: String(parsed?.at || new Date().toISOString())
      }
    } catch {
      return null
    }
  })
  const [recheckAlignmentMarker, setRecheckAlignmentMarker] = useState(() => {
    try {
      const raw = localStorage.getItem(RECHECK_ALIGNMENT_MARKER_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      const label = String(parsed?.label || '')
      if (!['aligned', 'mixed', 'lagging'].includes(label)) return null
      return {
        label,
        text: String(parsed?.text || ''),
        at: String(parsed?.at || new Date().toISOString())
      }
    } catch {
      return null
    }
  })
  const [recheckPostureConfidenceMarker, setRecheckPostureConfidenceMarker] = useState(() => {
    try {
      const raw = localStorage.getItem(RECHECK_POSTURE_CONFIDENCE_MARKER_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      const label = String(parsed?.label || '')
      if (!['confirmed', 'mixed', 'at-risk'].includes(label)) return null
      return {
        label,
        text: String(parsed?.text || ''),
        at: String(parsed?.at || new Date().toISOString())
      }
    } catch {
      return null
    }
  })
  const [showDetailsStats, setShowDetailsStats] = useState(() => localStorage.getItem(ADVISORY_DETAILS_STATS_KEY) === '1')
  const [showDetailsPreflight, setShowDetailsPreflight] = useState(() => localStorage.getItem(ADVISORY_DETAILS_PREFLIGHT_KEY) === '1')
  const [showAdvancedComposerTools, setShowAdvancedComposerTools] = useState(() => localStorage.getItem(ADVANCED_COMPOSER_TOOLS_KEY) === '1')
  const [showContextDebugPreview, setShowContextDebugPreview] = useState(false)
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [warningStateMarker, setWarningStateMarker] = useState(() => ({
    kind: 'none',
    text: 'no warning',
    at: new Date().toISOString()
  }))
  const [warningStabilityQualifier, setWarningStabilityQualifier] = useState(() => ({
    kind: 'stable',
    text: 'no warning baseline',
    at: new Date().toISOString()
  }))
  const [warningNoiseClassifier, setWarningNoiseClassifier] = useState(() => ({
    level: 'quiet',
    text: 'low warning transition noise',
    at: new Date().toISOString()
  }))
  const [warningNoiseTrend, setWarningNoiseTrend] = useState(() => ({
    label: 'steady',
    text: 'warning noise is steady',
    at: new Date().toISOString()
  }))
  const [pressureSnapshots, setPressureSnapshots] = useState([])
  const [consistencySnapshots, setConsistencySnapshots] = useState([])
  const [confidencePostureSnapshots, setConfidencePostureSnapshots] = useState([])
  const [coherencePostureSnapshots, setCoherencePostureSnapshots] = useState([])
  const [assurancePostureSnapshots, setAssurancePostureSnapshots] = useState([])
  const [convergencePostureSnapshots, setConvergencePostureSnapshots] = useState([])
  const [sessionPostureTimeline, setSessionPostureTimeline] = useState([])
  const [reminderCooldown, setReminderCooldown] = useState(() => {
    try {
      const raw = localStorage.getItem(MAINT_REMINDER_COOLDOWN_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      return {
        signature: String(parsed?.signature || ''),
        until: Number.isFinite(parsed?.until) ? Number(parsed.until) : 0
      }
    } catch {
      return { signature: '', until: 0 }
    }
  })
  const [preflightChecks, setPreflightChecks] = useState(() => {
    try {
      const raw = localStorage.getItem(PREFLIGHT_RESULT_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      const checks = Array.isArray(parsed?.checks)
        ? parsed.checks.map((c) => ({
          label: String(c?.label || ''),
          pass: Boolean(c?.pass),
          detail: String(c?.detail || '')
        }))
        : []
      if (!checks.length) return null
      return {
        ranAt: String(parsed?.ranAt || new Date().toISOString()),
        checks,
        passCount: Number.isFinite(parsed?.passCount) ? parsed.passCount : checks.filter((c) => c.pass).length,
        warnCount: Number.isFinite(parsed?.warnCount) ? parsed.warnCount : checks.filter((c) => !c.pass).length
      }
    } catch {
      return null
    }
  })
  const [opsSnapshot, setOpsSnapshot] = useState(() => {
    try {
      const raw = localStorage.getItem(OPS_SNAPSHOT_KEY)
      if (!raw) {
        return { events: [] }
      }
      const parsed = JSON.parse(raw)
      const events = Array.isArray(parsed?.events)
        ? parsed.events
          .map((e) => ({
            ok: Boolean(e?.ok),
            provider: String(e?.provider || 'unknown'),
            latencyMs: Number.isFinite(e?.latencyMs) ? Number(e.latencyMs) : null
          }))
          .slice(-OPS_WINDOW_SIZE)
        : []
      return { events }
    } catch {
      return { events: [] }
    }
  })

  // Innovations (small but useful)
  const [copiedId, setCopiedId] = useState(null)       // show "Copied!" per message
  const [copiedCodeKey, setCopiedCodeKey] = useState(null)
  const [debug, setDebug] = useState(false)            // debug toggle (prints response)
  const backendUrl = `${BACKEND_BASE_URL}/api/chat`
  const backendBase = BACKEND_BASE_URL
  const fallbackModelLabel = 'qwen2.5-coder-14b-instruct'
  const ollamaModelLabel = 'llama3.2:latest'
  const [healthUi, setHealthUi] = useState({
    kind: 'warn',
    text: 'Checking...',
    modelHint: null
  })
  const providerLabel = useMemo(() => {
    const match = PROVIDERS.find((p) => p.id === providerId)
    return match ? match.label : providerId
  }, [providerId])
  const isProMode = planMode === 'pro'
  const planEntitlementHint = isProMode
    ? 'Workflow mode: Pro simulation (extra drafting helpers unlocked locally).'
    : 'Workflow mode: Free simulation (switch to Pro for extra drafting helpers).'
  const planGateTooltip = isProMode
    ? 'Enabled in local Pro simulation.'
    : 'Local simulation only: switch workflow mode to Pro.'
  const visibleProviders = useMemo(() => PROVIDERS, [])
  const isProviderUnreachable = healthUi.kind === 'warn' && String(healthUi.text || '').includes('Unreachable')
  const suggestedFallbackProvider = useMemo(() => {
    if (!isProviderUnreachable) return null
    const visibleIds = new Set(visibleProviders.map((p) => p.id))
    const pick = providerFallbackOrder.find((id) => id !== providerId && visibleIds.has(id))
    return pick || null
  }, [isProviderUnreachable, visibleProviders, providerFallbackOrder, providerId])
  const suggestedFallbackLabel = useMemo(() => {
    if (!suggestedFallbackProvider) return null
    const match = PROVIDERS.find((p) => p.id === suggestedFallbackProvider)
    return match ? match.label : suggestedFallbackProvider
  }, [suggestedFallbackProvider])
  const currentModelLabel = useMemo(() => {
    if (lastModelName) return lastModelName
    if (selectedModel) return selectedModel
    if (providerId === 'ollama') return lastModelName || ollamaModelLabel
    return healthUi.modelHint || lastModelName || fallbackModelLabel
  }, [selectedModel, providerId, healthUi.modelHint, lastModelName])
  const kbPanelStatusLabel = useMemo(() => (
    useKB ? 'Enabled (manual rebuild flow)' : 'Disabled'
  ), [useKB])
  const kbInfluenceLabel = useMemo(() => {
    if (!lastKbEnabled) return 'No (KB off)'
    return lastKBInfluenced ? 'Yes' : 'No'
  }, [lastKbEnabled, lastKBInfluenced])
  const kbModeLabel = useMemo(() => {
    if (!lastKbEnabled) return '—'
    const mode = String(lastKBMode || '').trim().toLowerCase()
    if (mode === 'hybrid') return 'hybrid'
    if (mode === 'semantic') return 'semantic'
    return 'lexical'
  }, [lastKbEnabled, lastKBMode])
  const kbPanelFlowHint = useMemo(() => (
    rebuildHelperChatId === activeChatId
      ? 'Step 2 ready: use "Copy rebuild command" in MEMORY, run it, then send with Use KB ON.'
      : 'Step 1: Save to Memory. Step 2: run kb:build. Step 3: send message with Use KB ON.'
  ), [rebuildHelperChatId, activeChatId])
  const visibleCitations = useMemo(() => {
    const src = Array.isArray(lastKBCitations) ? lastKBCitations : []
    if (!src.length) return []
    const unique = []
    const seen = new Set()
    for (const c of src) {
      const source = String(c?.source || '(kb)')
      const chunkIndex = Number.isFinite(c?.chunkIndex) ? Number(c.chunkIndex) : null
      const key = `${source}::${chunkIndex ?? 'na'}`
      if (seen.has(key)) continue
      seen.add(key)
      unique.push({ source, chunkIndex })
    }
    const limit = Number.isFinite(lastKBTopK) && lastKBTopK > 0 ? lastKBTopK : 4
    return unique.slice(0, limit)
  }, [lastKBCitations, lastKBTopK])
  const opsMetrics = useMemo(() => {
    const events = Array.isArray(opsSnapshot?.events) ? opsSnapshot.events : []
    const providers = {}
    let requestsOk = 0
    let requestsFail = 0
    const latencies = []
    for (const e of events) {
      if (e?.ok) requestsOk += 1
      else requestsFail += 1
      const provider = String(e?.provider || 'unknown')
      providers[provider] = (providers[provider] || 0) + 1
      if (Number.isFinite(e?.latencyMs)) latencies.push(Number(e.latencyMs))
    }
    const avgLatency = latencies.length
      ? Math.round(latencies.reduce((acc, n) => acc + n, 0) / latencies.length)
      : null
    return {
      requestsTotal: events.length,
      requestsOk,
      requestsFail,
      providers,
      avgLatency
    }
  }, [opsSnapshot?.events])
  const opsProviderMix = useMemo(() => {
    const entries = Object.entries(opsMetrics.providers || {})
      .filter(([, count]) => Number.isFinite(count) && count > 0)
      .sort((a, b) => b[1] - a[1])
    if (!entries.length) return '—'
    return entries.slice(0, 2).map(([name, count]) => `${name}:${count}`).join(' | ')
  }, [opsMetrics.providers])
  const providerStability = useMemo(() => {
    const events = Array.isArray(opsSnapshot?.events) ? opsSnapshot.events : []
    const selectedEvents = events.filter((e) => String(e?.provider || '') === providerId)
    const selectedTotal = selectedEvents.length
    const selectedOk = selectedEvents.filter((e) => Boolean(e?.ok)).length
    const successRate = selectedTotal > 0 ? Math.round((selectedOk / selectedTotal) * 100) : null
    const fallbackPath = `${providerFallbackOrder[0]} -> ${providerFallbackOrder[1]}`
    const status = isProviderUnreachable || selectedTotal === 0 || (Number.isFinite(successRate) && successRate < 80)
      ? 'WARN'
      : 'PASS'
    const detail = selectedTotal === 0
      ? `selected:${providerId}, no recent data`
      : `selected:${providerId}, ok:${selectedOk}/${selectedTotal} (${successRate}%), fallback:${fallbackPath}`
    return { status, detail }
  }, [opsSnapshot?.events, providerId, providerFallbackOrder, isProviderUnreachable])
  const stabilityTrend = useMemo(() => {
    const events = Array.isArray(opsSnapshot?.events) ? opsSnapshot.events : []
    if (!events.length) return { status: 'WARN', label: 'insufficient data' }
    const windowSize = 8
    const recent = events.slice(-windowSize)
    const prev = events.slice(-(windowSize * 2), -windowSize)
    const rate = (arr) => {
      if (!arr.length) return null
      const ok = arr.filter((e) => Boolean(e?.ok)).length
      return ok / arr.length
    }
    const recentRate = rate(recent)
    const prevRate = rate(prev)
    if (!Number.isFinite(recentRate)) return { status: 'WARN', label: 'insufficient data' }
    if (!Number.isFinite(prevRate)) {
      const label = recentRate >= 0.8 ? 'stable' : 'degrading'
      return { status: recentRate >= 0.8 ? 'PASS' : 'WARN', label }
    }
    const delta = recentRate - prevRate
    if (delta > 0.08) return { status: 'PASS', label: 'improving' }
    if (delta < -0.08) return { status: 'WARN', label: 'degrading' }
    return { status: recentRate >= 0.8 ? 'PASS' : 'WARN', label: 'stable' }
  }, [opsSnapshot?.events])
  const maintenanceReminder = useMemo(() => {
    if (isProviderUnreachable) {
      return {
        key: 'provider-unreachable',
        text: 'Provider looks unreachable. Run preflight or switch to fallback.',
        actionLabel: 'Run preflight'
      }
    }
    if (stabilityTrend.status === 'WARN') {
      return {
        key: 'stability-warn',
        text: `Stability trend is ${stabilityTrend.label}. Re-run preflight check.`,
        actionLabel: 'Run preflight'
      }
    }
    if (preflightChecks && Number(preflightChecks.warnCount) > 0) {
      return {
        key: 'preflight-warn',
        text: `Preflight has ${preflightChecks.warnCount} warning(s). Review and adjust settings.`,
        actionLabel: 'Review'
      }
    }
    return null
  }, [isProviderUnreachable, stabilityTrend.status, stabilityTrend.label, preflightChecks])
  const maintenanceReminderSignature = useMemo(() => {
    if (!maintenanceReminder) return ''
    return `${maintenanceReminder.key}:${maintenanceReminder.text}`
  }, [maintenanceReminder])
  const shouldShowMaintenanceReminder = Boolean(
    maintenanceReminder && (
      maintenanceReminderSignature !== dismissedReminderKey ||
      maintenanceReminderSignature !== String(reminderCooldown?.signature || '') ||
      Date.now() >= Number(reminderCooldown?.until || 0)
    )
  )
  const warningSignatureRef = useRef('')
  const warningBehaviorHistoryRef = useRef([])
  const warningTransitionsRef = useRef(0)
  useEffect(() => {
    const prev = String(warningSignatureRef.current || '')
    const next = String(maintenanceReminderSignature || '')
    const nowMs = Date.now()
    let marker = null
    if (!prev && !next) {
      marker = { kind: 'none', text: 'no warning' }
    } else if (!prev && next) {
      marker = { kind: 'new', text: 'new warning state' }
    } else if (prev && !next) {
      marker = { kind: 'cleared', text: 'warning cleared' }
    } else if (prev === next) {
      marker = { kind: 'unchanged', text: 'unchanged warning state' }
    } else {
      marker = { kind: 'changed', text: 'warning state changed' }
    }
    warningSignatureRef.current = next
    setWarningStateMarker({
      kind: marker.kind,
      text: marker.text,
      at: new Date().toISOString()
    })
    const signature = next || '__none__'
    const history = [
      ...warningBehaviorHistoryRef.current,
      { signature, atMs: nowMs }
    ]
      .filter((e) => (nowMs - Number(e.atMs || 0)) <= 60000)
      .slice(-8)
    warningBehaviorHistoryRef.current = history
    let qualifier = { kind: 'stable', text: 'stable warning behavior' }
    if (!prev && next) {
      qualifier = { kind: 'new', text: 'new warning detected' }
    } else if (prev && !next) {
      qualifier = { kind: 'cleared', text: 'warning cleared' }
    } else {
      let transitions = 0
      for (let i = 1; i < history.length; i += 1) {
        if (history[i].signature !== history[i - 1].signature) transitions += 1
      }
      if (transitions >= 3) {
        qualifier = { kind: 'flapping', text: 'warning state is flapping' }
      } else if (!next) {
        qualifier = { kind: 'stable', text: 'no active warning' }
      } else {
        qualifier = { kind: 'stable', text: 'warning is stable' }
      }
    }
    setWarningStabilityQualifier({
      kind: qualifier.kind,
      text: qualifier.text,
      at: new Date().toISOString()
    })
    let noise = { level: 'quiet', text: 'low warning transition noise' }
    let transitions = 0
    for (let i = 1; i < history.length; i += 1) {
      if (history[i].signature !== history[i - 1].signature) transitions += 1
    }
    if (transitions >= 5) {
      noise = { level: 'noisy', text: 'high warning transition noise' }
    } else if (transitions >= 2) {
      noise = { level: 'normal', text: 'moderate warning transition noise' }
    }
    setWarningNoiseClassifier({
      level: noise.level,
      text: noise.text,
      at: new Date().toISOString()
    })
    const prevTransitions = Number(warningTransitionsRef.current || 0)
    let trend = { label: 'steady', text: 'warning noise is steady' }
    if (transitions >= prevTransitions + 2) {
      trend = { label: 'worsening', text: 'warning noise is increasing' }
    } else if (transitions + 1 < prevTransitions) {
      trend = { label: 'calming', text: 'warning noise is calming' }
    }
    warningTransitionsRef.current = transitions
    setWarningNoiseTrend({
      label: trend.label,
      text: trend.text,
      at: new Date().toISOString()
    })
  }, [maintenanceReminderSignature])
  const compatibilityHints = useMemo(() => {
    const hints = []
    if (isProviderUnreachable && suggestedFallbackProvider) {
      hints.push({
        id: 'provider-unreachable',
        text: `Current provider looks unreachable. Suggested fallback: ${suggestedFallbackLabel}`,
        actionLabel: 'Apply fallback'
      })
    }
    if (modelsError) {
      const fallbackLabel = PROVIDERS.find((p) => p.id === providerFallbackOrder[0])?.label || providerFallbackOrder[0]
      hints.push({
        id: 'models-list-error',
        text: `Model list fetch failed. Suggest switching to fallback primary (${fallbackLabel}).`,
        actionLabel: 'Switch primary'
      })
    }
    return hints
  }, [
    isProviderUnreachable,
    suggestedFallbackProvider,
    suggestedFallbackLabel,
    modelsError,
    providerFallbackOrder
  ])
  const contractDriftChecks = useMemo(() => {
    if (!lastContractSnapshot) {
      return [{
        key: 'snapshot',
        pass: false,
        detail: 'no response snapshot yet'
      }]
    }
    const checks = []
    checks.push({
      key: 'ok-boolean',
      pass: typeof lastContractSnapshot.ok === 'boolean',
      detail: `ok:boolean=${typeof lastContractSnapshot.ok === 'boolean'}`
    })
    checks.push({
      key: 'meta-shape',
      pass: Boolean(lastContractSnapshot.hasMetaObject),
      detail: `meta:object=${Boolean(lastContractSnapshot.hasMetaObject)}`
    })
    if (lastContractSnapshot.ok === true) {
      checks.push({
        key: 'ok-reply-meta',
        pass: Boolean(lastContractSnapshot.hasReplyString && lastContractSnapshot.hasMetaProviderField && lastContractSnapshot.hasMetaModelField),
        detail: `reply:string=${Boolean(lastContractSnapshot.hasReplyString)}, meta.provider=${Boolean(lastContractSnapshot.hasMetaProviderField)}, meta.model=${Boolean(lastContractSnapshot.hasMetaModelField)}`
      })
    }
    if (lastContractSnapshot.ok === false) {
      checks.push({
        key: 'err-shape',
        pass: Boolean(lastContractSnapshot.hasErrorObject),
        detail: `error:object=${Boolean(lastContractSnapshot.hasErrorObject)}`
      })
    }
    return checks
  }, [lastContractSnapshot])
  const contractDriftSummary = useMemo(() => {
    const passCount = contractDriftChecks.filter((c) => c.pass).length
    const warnCount = contractDriftChecks.length - passCount
    return {
      passCount,
      warnCount,
      status: warnCount === 0 ? 'PASS' : 'WARN'
    }
  }, [contractDriftChecks])
  const sessionPostureNow = useMemo(() => {
    const hasWarn = (
      contractDriftSummary.status === 'WARN' ||
      providerStability.status === 'WARN' ||
      stabilityTrend.status === 'WARN' ||
      shouldShowMaintenanceReminder
    )
    const reasons = []
    if (contractDriftSummary.status === 'WARN') reasons.push('contract')
    if (providerStability.status === 'WARN') reasons.push('provider')
    if (stabilityTrend.status === 'WARN') reasons.push('trend')
    if (shouldShowMaintenanceReminder) reasons.push('reminder')
    const label = hasWarn ? 'warn' : 'healthy'
    const detail = reasons.length ? reasons.join(',') : 'stable'
    return { label, detail }
  }, [
    contractDriftSummary.status,
    providerStability.status,
    stabilityTrend.status,
    shouldShowMaintenanceReminder
  ])
  const sessionPostureSignature = useMemo(
    () => `${sessionPostureNow.label}:${sessionPostureNow.detail}`,
    [sessionPostureNow.label, sessionPostureNow.detail]
  )
  useEffect(() => {
    setSessionPostureTimeline((prev) => {
      const last = prev[prev.length - 1]
      if (last?.signature === sessionPostureSignature) return prev
      const next = [
        ...prev,
        {
          at: new Date().toISOString(),
          label: sessionPostureNow.label,
          detail: sessionPostureNow.detail,
          signature: sessionPostureSignature
        }
      ]
      return next.slice(-6)
    })
  }, [sessionPostureSignature, sessionPostureNow.label, sessionPostureNow.detail])
  const sessionPostureTimelineText = useMemo(() => {
    if (!sessionPostureTimeline.length) return '—'
    return sessionPostureTimeline
      .slice(-4)
      .map((e) => `${formatTime(e.at)} ${e.label}${e.detail ? `(${e.detail})` : ''}`)
      .join(' -> ')
  }, [sessionPostureTimeline])
  const signalSnapshotStrip = useMemo(() => {
    const reminderState = shouldShowMaintenanceReminder ? 'active' : 'quiet'
    const preflightState = preflightChecks
      ? (Number(preflightChecks.warnCount) > 0 ? `warn:${preflightChecks.warnCount}` : 'ok')
      : 'na'
    return `contract:${contractDriftSummary.status} | provider:${providerStability.status} | trend:${stabilityTrend.status}/${stabilityTrend.label} | reminder:${reminderState} | preflight:${preflightState}`
  }, [
    contractDriftSummary.status,
    providerStability.status,
    stabilityTrend.status,
    stabilityTrend.label,
    shouldShowMaintenanceReminder,
    preflightChecks
  ])
  const recoveryPosturePair = useMemo(() => {
    if (!recoveryFeedback || recoveryFeedback.result === 'checking') return '—'
    const after = recoveryFeedback.after || recoveryFeedback.before || { contract: '-', provider: '-', trend: '-' }
    return `${recoveryFeedback.actionLabel} -> ${recoveryFeedback.result.toUpperCase()} (C:${after.contract}, P:${after.provider}, T:${after.trend})`
  }, [recoveryFeedback])
  const recoveryConfidenceHintText = useMemo(() => {
    if (!recoveryConfidenceHint) return '—'
    return `${recoveryConfidenceHint.level.toUpperCase()} - ${recoveryConfidenceHint.text}`
  }, [recoveryConfidenceHint])
  const recoveryConfidenceRecencyText = useMemo(() => {
    const atMs = new Date(recoveryConfidenceHint?.at).getTime()
    if (!Number.isFinite(atMs)) return '—'
    const ageSec = Math.max(0, Math.round((Date.now() - atMs) / 1000))
    if (ageSec <= 20) return 'just now'
    if (ageSec <= 120) return 'recently'
    return 'stale'
  }, [recoveryConfidenceHint?.at])
  const consistencyStatusStrip = useMemo(() => {
    const posture = sessionPostureNow.label === 'healthy' ? 'stable' : 'watch'
    const warning = warningStabilityQualifier.kind || 'stable'
    const recovery = recoveryFeedback?.result && recoveryFeedback.result !== 'checking'
      ? recoveryFeedback.result
      : 'none'
    return `consistency:${posture} | warning:${warning} | recovery:${recovery}`
  }, [sessionPostureNow.label, warningStabilityQualifier.kind, recoveryFeedback])
  const signalFreshnessIndicator = useMemo(() => {
    const candidates = [
      preflightChecks?.ranAt,
      recoveryFeedback?.at,
      recoveryConfidenceHint?.at,
      warningStateMarker?.at,
      warningStabilityQualifier?.at,
      warningNoiseClassifier?.at,
      sessionPostureTimeline[sessionPostureTimeline.length - 1]?.at
    ]
      .map((v) => new Date(v).getTime())
      .filter((n) => Number.isFinite(n))
    if (!candidates.length) return 'STALE - no recent signal'
    const latestMs = Math.max(...candidates)
    const ageSec = Math.max(0, Math.round((Date.now() - latestMs) / 1000))
    const level = ageSec <= 45 ? 'FRESH' : 'STALE'
    return `${level} - ${ageSec}s ago`
  }, [
    preflightChecks?.ranAt,
    recoveryFeedback?.at,
    recoveryConfidenceHint?.at,
    warningStateMarker?.at,
    warningStabilityQualifier?.at,
    warningNoiseClassifier?.at,
    sessionPostureTimeline
  ])
  const recencyAlignmentDerived = useMemo(() => {
    const freshnessIsFresh = String(signalFreshnessIndicator).startsWith('FRESH')
    const recency = recoveryConfidenceRecencyText
    if (recency === '—') {
      return { label: 'na', text: 'no recovery confidence context yet' }
    }
    const recencyIsFresh = recency === 'just now' || recency === 'recently'
    const aligned = (freshnessIsFresh && recencyIsFresh) || (!freshnessIsFresh && recency === 'stale')
    return aligned
      ? { label: 'aligned', text: 'freshness and recovery recency are aligned' }
      : { label: 'lagging', text: 'freshness and recovery recency are lagging' }
  }, [signalFreshnessIndicator, recoveryConfidenceRecencyText])
  const recencyAlignmentHintText = useMemo(() => {
    const src = recencyAlignmentHint || recencyAlignmentDerived
    if (!src) return 'NA - no alignment context'
    return `${String(src.label || 'na').toUpperCase()} - ${String(src.text || '')}`
  }, [recencyAlignmentHint, recencyAlignmentDerived])
  const warningVolatilityPosture = useMemo(() => {
    const noise = String(warningNoiseClassifier?.level || 'quiet')
    const trend = String(warningNoiseTrend?.label || 'steady')
    if (noise === 'noisy' || trend === 'worsening') {
      return 'HIGH - elevated warning volatility'
    }
    if (noise === 'normal' || trend === 'steady') {
      return 'MEDIUM - moderate warning volatility'
    }
    return 'LOW - calm warning volatility'
  }, [warningNoiseClassifier?.level, warningNoiseTrend?.label])
  const volatilityPressureTag = useMemo(() => {
    const volatility = String(warningVolatilityPosture || '')
    const trend = String(warningNoiseTrend?.label || 'steady')
    const elevated = volatility.startsWith('HIGH') || trend === 'worsening'
    return elevated
      ? 'ELEVATED - pressure building'
      : 'LOW - pressure stable'
  }, [warningVolatilityPosture, warningNoiseTrend?.label])
  const driftPressureComparator = useMemo(() => {
    const toScore = (value) => String(value || '').startsWith('ELEVATED') ? 1 : 0
    const currentScore = toScore(volatilityPressureTag)
    const baselineScores = pressureSnapshots
      .slice(0, -1)
      .slice(-5)
      .map((entry) => toScore(entry.level))
    if (!baselineScores.length) {
      return 'STEADY - pressure baseline forming'
    }
    const baselineAvg = baselineScores.reduce((sum, v) => sum + v, 0) / baselineScores.length
    if (currentScore > baselineAvg + 0.25) {
      return 'WORSENING - pressure is rising versus recent snapshots'
    }
    if (currentScore < baselineAvg - 0.25) {
      return 'IMPROVING - pressure is easing versus recent snapshots'
    }
    return 'STEADY - pressure is near recent baseline'
  }, [volatilityPressureTag, pressureSnapshots])
  const signalTrustBadge = useMemo(() => {
    let score = 0
    if (contractDriftSummary.status === 'PASS') score += 1
    if (providerStability.status === 'PASS') score += 1
    if (stabilityTrend.status === 'PASS') score += 1
    if (warningNoiseClassifier.level === 'quiet') score += 1
    if (String(signalFreshnessIndicator).startsWith('FRESH')) score += 1
    if (score >= 4) return 'HIGH - healthy trust posture'
    if (score >= 2) return 'MED - mixed trust posture'
    return 'LOW - degraded trust posture'
  }, [
    contractDriftSummary.status,
    providerStability.status,
    stabilityTrend.status,
    warningNoiseClassifier.level,
    signalFreshnessIndicator
  ])
  const readinessSignalRollup = useMemo(() => {
    const trust = String(signalTrustBadge || '')
    const freshness = String(signalFreshnessIndicator || '')
    const volatility = String(warningVolatilityPosture || '')
    const trustHealthy = trust.startsWith('HIGH')
    const trustMixed = trust.startsWith('MED')
    const fresh = freshness.startsWith('FRESH')
    const volLow = volatility.startsWith('LOW')
    const volMed = volatility.startsWith('MEDIUM')
    if (trustHealthy && fresh && volLow) return 'HEALTHY - readiness signals are coherent'
    if ((trustHealthy || trustMixed) && (fresh || volMed)) return 'MIXED - readiness signals need review'
    return 'WATCH - readiness signals show elevated risk'
  }, [signalTrustBadge, signalFreshnessIndicator, warningVolatilityPosture])
  const reliabilityHandshakeSummary = useMemo(() => {
    const readiness = String(readinessSignalRollup || '')
    const trust = String(signalTrustBadge || '')
    const alignment = String(recencyAlignmentHintText || '')
    const healthy = readiness.startsWith('HEALTHY') && trust.startsWith('HIGH') && alignment.startsWith('ALIGNED')
    const mixed = readiness.startsWith('MIXED') || trust.startsWith('MED') || alignment.startsWith('MIXED')
    if (healthy) return 'HEALTHY - handshake looks consistent'
    if (mixed) return 'MIXED - handshake needs review'
    return 'WATCH - handshake risk elevated'
  }, [readinessSignalRollup, signalTrustBadge, recencyAlignmentHintText])
  const handshakeContinuitySignal = useMemo(() => {
    const handshake = String(reliabilityHandshakeSummary || '')
    const readiness = String(readinessSignalRollup || '')
    const trust = String(signalTrustBadge || '')
    const alignment = String(recencyAlignmentHintText || '')
    const consistent = handshake.startsWith('HEALTHY') && readiness.startsWith('HEALTHY') && trust.startsWith('HIGH')
    const elevated = handshake.startsWith('WATCH') || readiness.startsWith('WATCH') || trust.startsWith('LOW')
    if (consistent && alignment.startsWith('ALIGNED')) {
      return 'CONSISTENT - follow-through posture is stable'
    }
    if (elevated) {
      return 'DRIFTING - follow-through posture needs recheck'
    }
    return 'MIXED - follow-through posture is partially aligned'
  }, [reliabilityHandshakeSummary, readinessSignalRollup, signalTrustBadge, recencyAlignmentHintText])
  const recheckOutcomeDerived = useMemo(() => {
    const freshness = String(signalFreshnessIndicator || '')
    const pressure = String(volatilityPressureTag || '')
    const continuity = String(handshakeContinuitySignal || '')
    const fresh = freshness.startsWith('FRESH')
    const lowPressure = pressure.startsWith('LOW')
    const continuityConsistent = continuity.startsWith('CONSISTENT')
    const stale = freshness.startsWith('STALE')
    const elevatedPressure = pressure.startsWith('ELEVATED')
    const continuityDrifting = continuity.startsWith('DRIFTING')
    if (fresh && lowPressure && continuityConsistent) {
      return { label: 'confirming', text: 'latest recheck signals are confirming' }
    }
    if (stale || elevatedPressure || continuityDrifting) {
      return { label: 'degraded', text: 'latest recheck signals are degraded' }
    }
    return { label: 'mixed', text: 'latest recheck signals are mixed' }
  }, [signalFreshnessIndicator, volatilityPressureTag, handshakeContinuitySignal])
  const recheckOutcomeMarkerText = useMemo(() => {
    const src = recheckOutcomeMarker || recheckOutcomeDerived
    if (!src) return 'MIXED - latest recheck signals are mixed'
    return `${String(src.label || 'mixed').toUpperCase()} - ${String(src.text || '')}`
  }, [recheckOutcomeMarker, recheckOutcomeDerived])
  const driftDirectionQualifier = useMemo(() => {
    const toScore = (value) => String(value || '').startsWith('watch') ? 1 : 0
    const currentScore = toScore(consistencyStatusStrip)
    const baselineScores = consistencySnapshots
      .slice(0, -1)
      .slice(-5)
      .map((entry) => toScore(entry.level))
    if (!baselineScores.length) {
      return 'STEADY - consistency baseline forming'
    }
    const baselineAvg = baselineScores.reduce((sum, v) => sum + v, 0) / baselineScores.length
    if (currentScore > baselineAvg + 0.25) {
      return 'WORSENING - consistency drift is increasing'
    }
    if (currentScore < baselineAvg - 0.25) {
      return 'IMPROVING - consistency drift is easing'
    }
    return 'STEADY - consistency drift is near baseline'
  }, [consistencyStatusStrip, consistencySnapshots])
  const followThroughConfidenceRollup = useMemo(() => {
    const continuity = String(handshakeContinuitySignal || '')
    const recheck = String(recheckOutcomeMarkerText || '')
    const drift = String(driftDirectionQualifier || '')
    const healthy = continuity.startsWith('CONSISTENT') && recheck.startsWith('CONFIRMING') && drift.startsWith('IMPROVING')
    const watch = continuity.startsWith('DRIFTING') || recheck.startsWith('DEGRADED') || drift.startsWith('WORSENING')
    if (healthy) {
      return 'HEALTHY - follow-through confidence is calibrated'
    }
    if (watch) {
      return 'WATCH - follow-through confidence needs attention'
    }
    return 'MIXED - follow-through confidence is partially calibrated'
  }, [handshakeContinuitySignal, recheckOutcomeMarkerText, driftDirectionQualifier])
  const recheckConfidenceStabilityDerived = useMemo(() => {
    const freshness = String(signalFreshnessIndicator || '')
    const outcome = String(recheckOutcomeMarkerText || '')
    const drift = String(driftDirectionQualifier || '')
    const fresh = freshness.startsWith('FRESH')
    const confirming = outcome.startsWith('CONFIRMING')
    const improvingOrSteady = drift.startsWith('IMPROVING') || drift.startsWith('STEADY')
    const stale = freshness.startsWith('STALE')
    const degraded = outcome.startsWith('DEGRADED')
    const worsening = drift.startsWith('WORSENING')
    if (fresh && confirming && improvingOrSteady) {
      return { label: 'stabilizing', text: 'recheck confidence is stabilizing' }
    }
    if (stale || degraded || worsening) {
      return { label: 'degrading', text: 'recheck confidence is degrading' }
    }
    return { label: 'mixed', text: 'recheck confidence is mixed' }
  }, [signalFreshnessIndicator, recheckOutcomeMarkerText, driftDirectionQualifier])
  const recheckConfidenceStabilityMarkerText = useMemo(() => {
    const src = recheckConfidenceStabilityMarker || recheckConfidenceStabilityDerived
    if (!src) return 'MIXED - recheck confidence is mixed'
    return `${String(src.label || 'mixed').toUpperCase()} - ${String(src.text || '')}`
  }, [recheckConfidenceStabilityMarker, recheckConfidenceStabilityDerived])
  const consistencyDivergenceTag = useMemo(() => {
    const toScore = (value) => {
      const normalized = String(value || '').toLowerCase()
      if (normalized === 'healthy') return 0
      if (normalized === 'watch') return 2
      return 1
    }
    const currentMatch = String(followThroughConfidenceRollup || '').match(/^([A-Z]+)/)
    const currentLevel = String(currentMatch?.[1] || 'MIXED').toLowerCase()
    const currentScore = toScore(currentLevel)
    const baselineScores = confidencePostureSnapshots
      .slice(0, -1)
      .slice(-5)
      .map((entry) => toScore(entry.level))
    if (!baselineScores.length) {
      return 'STEADY - confidence baseline forming'
    }
    const baselineAvg = baselineScores.reduce((sum, v) => sum + v, 0) / baselineScores.length
    if (currentScore > baselineAvg + 0.25) {
      return 'WORSENING - confidence divergence is increasing'
    }
    if (currentScore < baselineAvg - 0.25) {
      return 'IMPROVING - confidence divergence is easing'
    }
    return 'STEADY - confidence divergence is near baseline'
  }, [followThroughConfidenceRollup, confidencePostureSnapshots])
  const calibrationCoherenceRollup = useMemo(() => {
    const confidence = String(followThroughConfidenceRollup || '')
    const stability = String(recheckConfidenceStabilityMarkerText || '')
    const divergence = String(consistencyDivergenceTag || '')
    const healthy = confidence.startsWith('HEALTHY') && stability.startsWith('STABILIZING') && divergence.startsWith('IMPROVING')
    const watch = confidence.startsWith('WATCH') || stability.startsWith('DEGRADING') || divergence.startsWith('WORSENING')
    if (healthy) {
      return 'HEALTHY - calibration coherence is strong'
    }
    if (watch) {
      return 'WATCH - calibration coherence needs attention'
    }
    return 'MIXED - calibration coherence is partially aligned'
  }, [followThroughConfidenceRollup, recheckConfidenceStabilityMarkerText, consistencyDivergenceTag])
  const recheckAlignmentDerived = useMemo(() => {
    const freshness = String(signalFreshnessIndicator || '')
    const stability = String(recheckConfidenceStabilityMarkerText || '')
    const coherence = String(calibrationCoherenceRollup || '')
    const fresh = freshness.startsWith('FRESH')
    const stabilizing = stability.startsWith('STABILIZING')
    const coherenceHealthy = coherence.startsWith('HEALTHY')
    const stale = freshness.startsWith('STALE')
    const degrading = stability.startsWith('DEGRADING')
    const coherenceWatch = coherence.startsWith('WATCH')
    if (fresh && stabilizing && coherenceHealthy) {
      return { label: 'aligned', text: 'recheck confidence is aligned with current posture' }
    }
    if (stale || degrading || coherenceWatch) {
      return { label: 'lagging', text: 'recheck confidence is lagging current posture' }
    }
    return { label: 'mixed', text: 'recheck confidence is partially aligned' }
  }, [signalFreshnessIndicator, recheckConfidenceStabilityMarkerText, calibrationCoherenceRollup])
  const recheckAlignmentMarkerText = useMemo(() => {
    const src = recheckAlignmentMarker || recheckAlignmentDerived
    if (!src) return 'MIXED - recheck confidence is partially aligned'
    return `${String(src.label || 'mixed').toUpperCase()} - ${String(src.text || '')}`
  }, [recheckAlignmentMarker, recheckAlignmentDerived])
  const coherenceTrendTag = useMemo(() => {
    const toScore = (value) => {
      const normalized = String(value || '').toLowerCase()
      if (normalized === 'healthy') return 0
      if (normalized === 'watch') return 2
      return 1
    }
    const currentMatch = String(calibrationCoherenceRollup || '').match(/^([A-Z]+)/)
    const currentLevel = String(currentMatch?.[1] || 'MIXED').toLowerCase()
    const currentScore = toScore(currentLevel)
    const baselineScores = coherencePostureSnapshots
      .slice(0, -1)
      .slice(-5)
      .map((entry) => toScore(entry.level))
    if (!baselineScores.length) {
      return 'STEADY - coherence baseline forming'
    }
    const baselineAvg = baselineScores.reduce((sum, v) => sum + v, 0) / baselineScores.length
    if (currentScore > baselineAvg + 0.25) {
      return 'WORSENING - coherence trend is degrading'
    }
    if (currentScore < baselineAvg - 0.25) {
      return 'IMPROVING - coherence trend is recovering'
    }
    return 'STEADY - coherence trend is near baseline'
  }, [calibrationCoherenceRollup, coherencePostureSnapshots])
  const coherenceAssuranceRollup = useMemo(() => {
    const coherence = String(calibrationCoherenceRollup || '')
    const alignment = String(recheckAlignmentMarkerText || '')
    const trend = String(coherenceTrendTag || '')
    const healthy = coherence.startsWith('HEALTHY') && alignment.startsWith('ALIGNED') && trend.startsWith('IMPROVING')
    const watch = coherence.startsWith('WATCH') || alignment.startsWith('LAGGING') || trend.startsWith('WORSENING')
    if (healthy) {
      return 'HEALTHY - coherence assurance is stable'
    }
    if (watch) {
      return 'WATCH - coherence assurance needs attention'
    }
    return 'MIXED - coherence assurance is partially aligned'
  }, [calibrationCoherenceRollup, recheckAlignmentMarkerText, coherenceTrendTag])
  const recheckPostureConfidenceDerived = useMemo(() => {
    const freshness = String(signalFreshnessIndicator || '')
    const alignment = String(recheckAlignmentMarkerText || '')
    const assurance = String(coherenceAssuranceRollup || '')
    const fresh = freshness.startsWith('FRESH')
    const aligned = alignment.startsWith('ALIGNED')
    const assuranceHealthy = assurance.startsWith('HEALTHY')
    const stale = freshness.startsWith('STALE')
    const lagging = alignment.startsWith('LAGGING')
    const assuranceWatch = assurance.startsWith('WATCH')
    if (fresh && aligned && assuranceHealthy) {
      return { label: 'confirmed', text: 'recheck posture confidence is confirmed' }
    }
    if (stale || lagging || assuranceWatch) {
      return { label: 'at-risk', text: 'recheck posture confidence is at risk' }
    }
    return { label: 'mixed', text: 'recheck posture confidence is mixed' }
  }, [signalFreshnessIndicator, recheckAlignmentMarkerText, coherenceAssuranceRollup])
  const recheckPostureConfidenceMarkerText = useMemo(() => {
    const src = recheckPostureConfidenceMarker || recheckPostureConfidenceDerived
    if (!src) return 'MIXED - recheck posture confidence is mixed'
    return `${String(src.label || 'mixed').toUpperCase()} - ${String(src.text || '')}`
  }, [recheckPostureConfidenceMarker, recheckPostureConfidenceDerived])
  const assuranceDriftTrendTag = useMemo(() => {
    const toScore = (value) => {
      const normalized = String(value || '').toLowerCase()
      if (normalized === 'healthy') return 0
      if (normalized === 'watch') return 2
      return 1
    }
    const currentMatch = String(coherenceAssuranceRollup || '').match(/^([A-Z]+)/)
    const currentLevel = String(currentMatch?.[1] || 'MIXED').toLowerCase()
    const currentScore = toScore(currentLevel)
    const baselineScores = assurancePostureSnapshots
      .slice(0, -1)
      .slice(-5)
      .map((entry) => toScore(entry.level))
    if (!baselineScores.length) {
      return 'STEADY - assurance baseline forming'
    }
    const baselineAvg = baselineScores.reduce((sum, v) => sum + v, 0) / baselineScores.length
    if (currentScore > baselineAvg + 0.25) {
      return 'WORSENING - assurance trend is degrading'
    }
    if (currentScore < baselineAvg - 0.25) {
      return 'IMPROVING - assurance trend is recovering'
    }
    return 'STEADY - assurance trend is near baseline'
  }, [coherenceAssuranceRollup, assurancePostureSnapshots])
  const assuranceConvergenceRollup = useMemo(() => {
    const assurance = String(coherenceAssuranceRollup || '')
    const posture = String(recheckPostureConfidenceMarkerText || '')
    const drift = String(assuranceDriftTrendTag || '')
    const healthy = assurance.startsWith('HEALTHY') && posture.startsWith('CONFIRMED') && drift.startsWith('IMPROVING')
    const watch = assurance.startsWith('WATCH') || posture.startsWith('AT-RISK') || drift.startsWith('WORSENING')
    if (healthy) {
      return 'HEALTHY - assurance convergence is stable'
    }
    if (watch) {
      return 'WATCH - assurance convergence needs attention'
    }
    return 'MIXED - assurance convergence is partially aligned'
  }, [coherenceAssuranceRollup, recheckPostureConfidenceMarkerText, assuranceDriftTrendTag])
  const convergenceDriftTrendTag = useMemo(() => {
    const toScore = (value) => {
      const normalized = String(value || '').toLowerCase()
      if (normalized === 'healthy') return 0
      if (normalized === 'watch') return 2
      return 1
    }
    const currentMatch = String(assuranceConvergenceRollup || '').match(/^([A-Z]+)/)
    const currentLevel = String(currentMatch?.[1] || 'MIXED').toLowerCase()
    const currentScore = toScore(currentLevel)
    const baselineScores = convergencePostureSnapshots
      .slice(0, -1)
      .slice(-5)
      .map((entry) => toScore(entry.level))
    if (!baselineScores.length) {
      return 'STEADY - convergence baseline forming'
    }
    const baselineAvg = baselineScores.reduce((sum, v) => sum + v, 0) / baselineScores.length
    if (currentScore > baselineAvg + 0.25) {
      return 'WORSENING - convergence trend is degrading'
    }
    if (currentScore < baselineAvg - 0.25) {
      return 'IMPROVING - convergence trend is recovering'
    }
    return 'STEADY - convergence trend is near baseline'
  }, [assuranceConvergenceRollup, convergencePostureSnapshots])
  const alignmentConfidenceDerived = useMemo(() => {
    const trust = String(signalTrustBadge || '')
    const alignmentLabel = String((recencyAlignmentHint || recencyAlignmentDerived)?.label || 'na')
    const trustHealthyOrMixed = trust.startsWith('HIGH') || trust.startsWith('MED')
    const coherent = (alignmentLabel === 'aligned' && trustHealthyOrMixed) || (alignmentLabel === 'lagging' && trust.startsWith('LOW'))
    return coherent
      ? { label: 'coherent', text: 'trust and recency alignment are coherent' }
      : { label: 'mixed', text: 'trust and recency alignment are mixed' }
  }, [signalTrustBadge, recencyAlignmentHint, recencyAlignmentDerived])
  const alignmentConfidenceMarkerText = useMemo(() => {
    const src = alignmentConfidenceMarker || alignmentConfidenceDerived
    if (!src) return 'MIXED - trust and recency alignment are mixed'
    return `${String(src.label || 'mixed').toUpperCase()} - ${String(src.text || '')}`
  }, [alignmentConfidenceMarker, alignmentConfidenceDerived])
  const recoverySignalSnapshot = useMemo(() => ({
    contract: contractDriftSummary.status,
    provider: providerStability.status,
    trend: stabilityTrend.status
  }), [contractDriftSummary.status, providerStability.status, stabilityTrend.status])
  const signalConfidenceBadges = useMemo(() => {
    const contractLevel = contractDriftSummary.status === 'PASS' ? 'HIGH' : 'LOW'
    const providerLevel = providerStability.status === 'PASS' ? 'HIGH' : 'LOW'
    const trendLevel = stabilityTrend.status === 'PASS'
      ? (stabilityTrend.label === 'degrading' ? 'MED' : 'HIGH')
      : 'LOW'
    return [
      { key: 'contract', label: 'Contract', level: contractLevel },
      { key: 'provider', label: 'Provider', level: providerLevel },
      { key: 'trend', label: 'Trend', level: trendLevel }
    ]
  }, [
    contractDriftSummary.status,
    providerStability.status,
    stabilityTrend.status,
    stabilityTrend.label
  ])
  const guidedRecoverySuggestion = useMemo(() => {
    if (contractDriftSummary.status === 'WARN') {
      return {
        key: 'contract-drift',
        text: 'Contract drift warnings detected. Re-run preflight, then soft recover if warnings remain.',
        primaryLabel: 'Run preflight',
        secondaryLabel: 'Soft recover'
      }
    }
    if (providerStability.status === 'WARN') {
      const hasFallbackSwitch = Boolean(suggestedFallbackProvider || providerFallbackOrder[0])
      return {
        key: 'provider-stability',
        text: hasFallbackSwitch
          ? 'Provider stability is WARN. Try fallback switch, then rerun preflight.'
          : 'Provider stability is WARN. Rerun preflight and review provider health.',
        primaryLabel: hasFallbackSwitch ? 'Switch fallback' : 'Run preflight',
        secondaryLabel: hasFallbackSwitch ? 'Run preflight' : 'Soft recover'
      }
    }
    return null
  }, [
    contractDriftSummary.status,
    providerStability.status,
    suggestedFallbackProvider,
    providerFallbackOrder
  ])

  // Refs
  const chatEndRef = useRef(null)
  const textareaRef = useRef(null)
  const recoverySignalRef = useRef(recoverySignalSnapshot)
  const recoveryFeedbackTimerRef = useRef(null)

  useEffect(() => {
    recoverySignalRef.current = recoverySignalSnapshot
  }, [recoverySignalSnapshot])
  useEffect(() => () => {
    if (recoveryFeedbackTimerRef.current) {
      clearTimeout(recoveryFeedbackTimerRef.current)
    }
  }, [])

  // Provider-aware health polling
  useEffect(() => {
    let active = true

    const checkHealth = async () => {
      try {
        if (!active) return
        setHealthUi({ kind: 'warn', text: `⏳ Checking ${providerLabel}...`, modelHint: null })

        const backendRes = await fetch(`${backendBase}/health`)
        if (!backendRes.ok) throw new Error(`backend_http_${backendRes.status}`)
        const backendJson = await backendRes.json().catch(() => ({}))
        if (!backendJson?.ok) {
          if (!active) return
          setHealthUi({ kind: 'err', text: 'Backend: Offline', modelHint: null })
          return
        }

        const providerRes = await fetch(`${backendBase}/health/provider/${providerId}`)
        const providerJson = await providerRes.json().catch(() => ({}))
        if (!providerRes.ok || providerJson?.ok === false) {
          if (!active) return
          setHealthUi({
            kind: 'warn',
            text: `⚠️ Unreachable (${providerLabel})`,
            modelHint: null
          })
          return
        }

        if (!active) return
        setHealthUi({
          kind: 'ok',
          text: `✅ Connected (${providerLabel})`,
          modelHint: Array.isArray(providerJson?.models) ? (providerJson.models[0] || null) : null
        })
      } catch {
        if (!active) return
        setHealthUi({ kind: 'err', text: 'Backend: Offline', modelHint: null })
      }
    }

    checkHealth()
    const timer = setInterval(checkHealth, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [providerId, providerLabel, backendBase])

  // Persist global provider/model choices
  useEffect(() => {
    localStorage.setItem('rez-ai-provider-v1', providerId)
  }, [providerId])

  useEffect(() => {
    localStorage.setItem('rez-ai-model-v1', selectedModel || '')
  }, [selectedModel])

  useEffect(() => {
    localStorage.setItem('rez-ai-plan-mode-v1', planMode || 'free')
  }, [planMode])

  useEffect(() => {
    localStorage.setItem(FALLBACK_ORDER_KEY, JSON.stringify(normalizeFallbackOrder(providerFallbackOrder)))
  }, [providerFallbackOrder])
  useEffect(() => {
    localStorage.setItem(OPS_SNAPSHOT_KEY, JSON.stringify(opsSnapshot))
  }, [opsSnapshot])
  useEffect(() => {
    if (!preflightChecks) return
    localStorage.setItem(PREFLIGHT_RESULT_KEY, JSON.stringify(preflightChecks))
  }, [preflightChecks])
  useEffect(() => {
    localStorage.setItem(MAINT_REMINDER_DISMISS_KEY, dismissedReminderKey || '')
  }, [dismissedReminderKey])
  useEffect(() => {
    localStorage.setItem(MAINT_REMINDER_COOLDOWN_KEY, JSON.stringify(reminderCooldown))
  }, [reminderCooldown])
  useEffect(() => {
    if (!recoveryFeedback || recoveryFeedback.result === 'checking') return
    localStorage.setItem(RECOVERY_FEEDBACK_KEY, JSON.stringify(recoveryFeedback))
  }, [recoveryFeedback])
  useEffect(() => {
    if (!recoveryFeedback || recoveryFeedback.result === 'checking') return
    const level = recoveryFeedback.result === 'improved'
      ? 'rising'
      : recoveryFeedback.result === 'no-change'
        ? 'stable'
        : 'uncertain'
    const text = level === 'rising'
      ? 'recovery confidence rising'
      : level === 'stable'
        ? 'recovery confidence stable'
        : 'recovery confidence uncertain'
    setRecoveryConfidenceHint({
      level,
      text,
      at: new Date().toISOString()
    })
  }, [recoveryFeedback])
  useEffect(() => {
    if (!recoveryConfidenceHint) return
    localStorage.setItem(RECOVERY_CONFIDENCE_HINT_KEY, JSON.stringify(recoveryConfidenceHint))
  }, [recoveryConfidenceHint])
  useEffect(() => {
    if (!recencyAlignmentDerived) return
    setRecencyAlignmentHint({
      label: recencyAlignmentDerived.label,
      text: recencyAlignmentDerived.text,
      at: new Date().toISOString()
    })
  }, [recencyAlignmentDerived])
  useEffect(() => {
    if (!recencyAlignmentHint) return
    localStorage.setItem(RECENCY_ALIGNMENT_HINT_KEY, JSON.stringify(recencyAlignmentHint))
  }, [recencyAlignmentHint])
  useEffect(() => {
    if (!alignmentConfidenceDerived) return
    setAlignmentConfidenceMarker({
      label: alignmentConfidenceDerived.label,
      text: alignmentConfidenceDerived.text,
      at: new Date().toISOString()
    })
  }, [alignmentConfidenceDerived])
  useEffect(() => {
    if (!alignmentConfidenceMarker) return
    localStorage.setItem(ALIGNMENT_CONFIDENCE_MARKER_KEY, JSON.stringify(alignmentConfidenceMarker))
  }, [alignmentConfidenceMarker])
  useEffect(() => {
    if (!recheckOutcomeDerived) return
    setRecheckOutcomeMarker({
      label: recheckOutcomeDerived.label,
      text: recheckOutcomeDerived.text,
      at: new Date().toISOString()
    })
  }, [recheckOutcomeDerived])
  useEffect(() => {
    if (!recheckOutcomeMarker) return
    localStorage.setItem(RECHECK_OUTCOME_MARKER_KEY, JSON.stringify(recheckOutcomeMarker))
  }, [recheckOutcomeMarker])
  useEffect(() => {
    if (!recheckConfidenceStabilityDerived) return
    setRecheckConfidenceStabilityMarker({
      label: recheckConfidenceStabilityDerived.label,
      text: recheckConfidenceStabilityDerived.text,
      at: new Date().toISOString()
    })
  }, [recheckConfidenceStabilityDerived])
  useEffect(() => {
    if (!recheckConfidenceStabilityMarker) return
    localStorage.setItem(RECHECK_CONFIDENCE_STABILITY_MARKER_KEY, JSON.stringify(recheckConfidenceStabilityMarker))
  }, [recheckConfidenceStabilityMarker])
  useEffect(() => {
    if (!recheckAlignmentDerived) return
    setRecheckAlignmentMarker({
      label: recheckAlignmentDerived.label,
      text: recheckAlignmentDerived.text,
      at: new Date().toISOString()
    })
  }, [recheckAlignmentDerived])
  useEffect(() => {
    if (!recheckAlignmentMarker) return
    localStorage.setItem(RECHECK_ALIGNMENT_MARKER_KEY, JSON.stringify(recheckAlignmentMarker))
  }, [recheckAlignmentMarker])
  useEffect(() => {
    if (!recheckPostureConfidenceDerived) return
    setRecheckPostureConfidenceMarker({
      label: recheckPostureConfidenceDerived.label,
      text: recheckPostureConfidenceDerived.text,
      at: new Date().toISOString()
    })
  }, [recheckPostureConfidenceDerived])
  useEffect(() => {
    if (!recheckPostureConfidenceMarker) return
    localStorage.setItem(RECHECK_POSTURE_CONFIDENCE_MARKER_KEY, JSON.stringify(recheckPostureConfidenceMarker))
  }, [recheckPostureConfidenceMarker])
  useEffect(() => {
    localStorage.setItem(ADVISORY_DETAILS_STATS_KEY, showDetailsStats ? '1' : '0')
  }, [showDetailsStats])
  useEffect(() => {
    localStorage.setItem(ADVISORY_DETAILS_PREFLIGHT_KEY, showDetailsPreflight ? '1' : '0')
  }, [showDetailsPreflight])
  useEffect(() => {
    localStorage.setItem(ADVANCED_COMPOSER_TOOLS_KEY, showAdvancedComposerTools ? '1' : '0')
  }, [showAdvancedComposerTools])
  useEffect(() => {
    const summaryExpandKey = `summaryExpanded:${activeChatId || 'default'}`
    try {
      setSummaryExpanded(localStorage.getItem(summaryExpandKey) === '1')
    } catch {
      setSummaryExpanded(false)
    }
  }, [activeChatId])
  useEffect(() => {
    const summaryExpandKey = `summaryExpanded:${activeChatId || 'default'}`
    try {
      localStorage.setItem(summaryExpandKey, summaryExpanded ? '1' : '0')
    } catch {
      // ignore localStorage failures for summary expanded state
    }
  }, [activeChatId, summaryExpanded])
  useEffect(() => {
    if (!maintenanceReminder && dismissedReminderKey) {
      setDismissedReminderKey('')
      setReminderCooldown({ signature: '', until: 0 })
    }
  }, [maintenanceReminder, dismissedReminderKey])
  useEffect(() => {
    const level = String(volatilityPressureTag || '').startsWith('ELEVATED') ? 'ELEVATED' : 'LOW'
    setPressureSnapshots((prev) => {
      const last = prev[prev.length - 1]
      if (last?.level === level) return prev
      const next = [...prev, { level, at: new Date().toISOString() }]
      return next.slice(-6)
    })
  }, [volatilityPressureTag])
  useEffect(() => {
    const match = String(consistencyStatusStrip || '').match(/consistency:([a-z]+)/i)
    const level = String(match?.[1] || 'stable').toLowerCase()
    setConsistencySnapshots((prev) => {
      const last = prev[prev.length - 1]
      if (last?.level === level) return prev
      const next = [...prev, { level, at: new Date().toISOString() }]
      return next.slice(-6)
    })
  }, [consistencyStatusStrip])
  useEffect(() => {
    const match = String(followThroughConfidenceRollup || '').match(/^([A-Z]+)/)
    const level = String(match?.[1] || 'MIXED').toLowerCase()
    setConfidencePostureSnapshots((prev) => {
      const last = prev[prev.length - 1]
      if (last?.level === level) return prev
      const next = [...prev, { level, at: new Date().toISOString() }]
      return next.slice(-6)
    })
  }, [followThroughConfidenceRollup])
  useEffect(() => {
    const match = String(calibrationCoherenceRollup || '').match(/^([A-Z]+)/)
    const level = String(match?.[1] || 'mixed').toLowerCase()
    setCoherencePostureSnapshots((prev) => {
      const last = prev[prev.length - 1]
      if (last?.level === level) return prev
      const next = [...prev, { level, at: new Date().toISOString() }]
      return next.slice(-6)
    })
  }, [calibrationCoherenceRollup])
  useEffect(() => {
    const match = String(coherenceAssuranceRollup || '').match(/^([A-Z]+)/)
    const level = String(match?.[1] || 'mixed').toLowerCase()
    setAssurancePostureSnapshots((prev) => {
      const last = prev[prev.length - 1]
      if (last?.level === level) return prev
      const next = [...prev, { level, at: new Date().toISOString() }]
      return next.slice(-6)
    })
  }, [coherenceAssuranceRollup])
  useEffect(() => {
    const match = String(assuranceConvergenceRollup || '').match(/^([A-Z]+)/)
    const level = String(match?.[1] || 'mixed').toLowerCase()
    setConvergencePostureSnapshots((prev) => {
      const last = prev[prev.length - 1]
      if (last?.level === level) return prev
      const next = [...prev, { level, at: new Date().toISOString() }]
      return next.slice(-6)
    })
  }, [assuranceConvergenceRollup])

  // Load available models whenever provider changes
  useEffect(() => {
    let active = true
    const loadModels = async () => {
      setModelsLoading(true)
      setModelsError(null)
      try {
        if (providerId === 'ollama' || providerId === 'lmstudio') {
          const res = await fetch(`${backendBase}/health/provider/${providerId}`)
          if (!res.ok) throw new Error(`${providerId} models HTTP ${res.status}`)
          const data = await res.json().catch(() => ({}))
          const models = Array.isArray(data?.models)
            ? data.models.map((m) => String(m || '').trim()).filter(Boolean)
            : []
          const fallback = providerId === 'ollama'
            ? ollamaModelLabel
            : (healthUi.modelHint || fallbackModelLabel)
          const nextModels = models.length ? models : [fallback]
          if (!active) return
          setAvailableModels(nextModels)
          setSelectedModel((prev) => (prev && nextModels.includes(prev) ? prev : nextModels[0]))
          return
        }

        if (!active) return
        setAvailableModels(['remote-openai'])
        setSelectedModel((prev) => prev || 'remote-openai')
      } catch (e) {
        if (!active) return
        const fallback = providerId === 'ollama'
          ? ollamaModelLabel
          : (healthUi.modelHint || fallbackModelLabel)
        setAvailableModels([fallback])
        setSelectedModel((prev) => prev || fallback)
        setModelsError(e?.message || 'Could not fetch models')
      } finally {
        if (active) setModelsLoading(false)
      }
    }

    loadModels()
    return () => { active = false }
  }, [providerId, backendBase, healthUi.modelHint])

  const updateActiveMessages = useCallback((updater) => {
    setChats((prevChats) =>
      prevChats.map((chat) => {
        if (chat.id !== activeChatId) return chat
        const nextMessages =
          typeof updater === 'function' ? updater(chat.messages || []) : updater
        return { ...chat, messages: nextMessages }
      })
    )
  }, [activeChatId])

  const appendToActiveChat = useCallback((msg) => {
    setChats(prev =>
      prev.map(c =>
        c.id === activeChatId
          ? { ...c, messages: [...c.messages, msg] }
          : c
      )
    )
  }, [activeChatId])

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  // Auto-resize textarea
  const handleInput = (e) => {
    const target = e.target
    target.style.height = 'auto'
    target.style.height = Math.min(target.scrollHeight, 200) + 'px'
    setInputValue(target.value)
  }

  // Copy to clipboard + feedback (innovation)
  const copyToClipboard = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1200)
    } catch (err) {
      console.error('Copy failed:', err)
      setError('Copy failed. Check browser permissions.')
    }
  }

  const copyCodeBlock = async (code, codeKey) => {
    try {
      await navigator.clipboard.writeText(String(code || ''))
      setCopiedCodeKey(codeKey)
      setTimeout(() => setCopiedCodeKey(null), 1200)
    } catch (err) {
      console.error('Copy code failed:', err)
      setError('Copy failed. Check browser permissions.')
    }
  }

  const summarizeRecentMessages = (chatMessages) => {
    const recent = (chatMessages || []).slice(-6)
    if (!recent.length) return 'Based on our chat so far.'
    const compact = recent
      .map((m) => {
        const role = m.role === 'user' ? 'You' : 'REZ-AI'
        const text = String(m.content || '').replace(/\s+/g, ' ').trim()
        return `${role}: ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}`
      })
      .join(' | ')
    return `Recent context: ${compact}`
  }

  const getPresetWorkflowHint = (presetId) => {
    if (presetId === 'dev') {
      return 'Style: developer execution operator; file-level scope, deterministic steps, and test-first validation.'
    }
    if (presetId === 'khronika') {
      return 'Style: Next.js + Supabase operator support, respect RLS/migrations, docs-first, prefer Georgian UI strings.'
    }
    return 'Style: project operator guidance, step-by-step outputs, concise and safe.'
  }

  const makePlanPrompt = (preset, lastText, chatMessages) => {
    const context = summarizeRecentMessages(chatMessages)
    const focus = lastText ? `Main request: ${lastText}` : 'Main request: infer from recent chat.'
    return [
      'Create a short developer/project implementation plan with 5-7 steps.',
      getPresetWorkflowHint(preset?.id),
      focus,
      context,
      'Output format: Step list + risks + quick validation checklist + first execution step.'
    ].join('\n')
  }

  const makeFeaturePlanPrompt = (preset, lastText, chatMessages) => {
    const context = summarizeRecentMessages(chatMessages)
    const focus = lastText ? `Feature target: ${lastText}` : 'Feature target: infer from recent chat.'
    return [
      'Plan this feature as a project operator.',
      getPresetWorkflowHint(preset?.id),
      focus,
      context,
      'Output format: scope + affected files/components + implementation steps + edge cases + verification checklist.'
    ].join('\n')
  }

  const makeBugBreakdownPrompt = (preset, lastText, chatMessages) => {
    const context = summarizeRecentMessages(chatMessages)
    const focus = lastText ? `Bug focus: ${lastText}` : 'Bug focus: infer from recent chat.'
    return [
      'Break down this bug for safe implementation.',
      getPresetWorkflowHint(preset?.id),
      focus,
      context,
      'Output format: reproduction hypothesis + likely root cause + minimal fix strategy + regression checks + next step.'
    ].join('\n')
  }

  const makeNextStepPrompt = (preset, lastText, chatMessages) => {
    const context = summarizeRecentMessages(chatMessages)
    const focus = lastText ? `Task focus: ${lastText}` : 'Task focus: infer from recent chat.'
    return [
      'Give exactly ONE next small action (10-20 minutes max).',
      getPresetWorkflowHint(preset?.id),
      focus,
      context,
      'Include: objective, target file(s), and done criteria.'
    ].join('\n')
  }

  const makeSummarizePrompt = (preset, chatMessages) => {
    const context = summarizeRecentMessages(chatMessages)
    return [
      'Summarize progress so far in concise bullets.',
      getPresetWorkflowHint(preset?.id),
      context,
      'Include: done, in-progress, blockers, and recommended next move.'
    ].join('\n')
  }

  const makeExtractTasksPrompt = (preset, chatMessages) => {
    const context = summarizeRecentMessages(chatMessages)
    return [
      'Extract actionable tasks from this chat.',
      getPresetWorkflowHint(preset?.id),
      context,
      'Return a checklist grouped by priority (High/Medium/Low) with short owners/notes.'
    ].join('\n')
  }

  const makeCursorPrompt = (preset, chatMessages) => {
    const context = summarizeRecentMessages(chatMessages)
    return [
      'Write a ready-to-paste Cursor prompt to implement the next change safely.',
      getPresetWorkflowHint(preset?.id),
      context,
      'Include: goal, exact files, constraints, and expected output format.'
    ].join('\n')
  }

  const fillWorkflowInput = useCallback((generatedPrompt) => {
    setInputValue(generatedPrompt)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    })
  }, [])

  useEffect(() => {
    setInsertPresetId(activeChat?.presetId || DEFAULT_PRESET_ID)
  }, [activeChat?.presetId, DEFAULT_PRESET_ID])

  const insertPresetToComposer = useCallback(() => {
    const preset = getPresetById(insertPresetId || DEFAULT_PRESET_ID)
    const header = `[Preset: ${preset.name}]`
    const payload = `${header}\n${preset.systemPromptTemplate}`
    setInputValue((prev) => {
      const current = String(prev || '')
      return current.trim() ? `${current}\n\n---\n${payload}` : payload
    })
    setNotice('Preset inserted')
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    })
  }, [insertPresetId, DEFAULT_PRESET_ID])

  const makeMemoryFromChatPrompt = useCallback((chatMessages) => {
    const context = summarizeRecentMessages(chatMessages)
    return [
      'Create structured memory notes from this conversation in markdown with sections:',
      '- Goals',
      '- Decisions',
      '- Current State',
      '- Next Steps',
      '- Open Questions',
      'Use concise bullets. Output only markdown.',
      context
    ].join('\n')
  }, [])

  const exportNotesMarkdown = useCallback(() => {
    if (!activeChat) return
    const title = String(activeChat.title || 'REZ-AI').trim()
    const notes = String(activeChat.notes || '').trim()
    const content = [`# ${title}`, '', notes || '_No notes yet._', ''].join('\n')
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rez-ai-notes-${activeChat.id}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [activeChat])

  const copyNotes = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(String(activeChat?.notes || ''))
      setPromptSavedToast('Notes copied')
    } catch (err) {
      console.error('Copy notes failed:', err)
      setError('Copy failed. Check browser permissions.')
    }
  }, [activeChat?.notes])

  const copyRebuildCommand = async () => {
    try {
      await navigator.clipboard.writeText('npm run kb:build')
      setNotice('Copied: npm run kb:build. Next: run it in terminal, then send with Use KB ON.')
    } catch (err) {
      console.error('Copy rebuild command failed:', err)
      setError('Copy failed. Check browser permissions.')
    }
  }

  const saveNotesToKb = useCallback(async () => {
    const notes = String(activeChat?.notes || '').trim()
    if (!notes) {
      setNotice('No notes to save')
      return
    }

    const ok = window.confirm('Append these notes to data/kb/notes.txt? (Rebuild required afterward)')
    if (!ok) return

    try {
      const res = await fetch(`${backendBase}/api/kb/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: notes,
          source: 'ui'
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error?.message || data?.message || `HTTP ${res.status}`)
      }
      setRebuildHelperChatId(activeChat?.id || null)
      const fileHint = data?.meta?.path ? ` (${data.meta.path})` : ''
      setNotice(`Saved to Memory${fileHint}. Next: run npm run kb:build, then send with Use KB ON.`)
    } catch (err) {
      console.error('KB append failed:', err)
      setError(`KB save failed: ${err.message || 'Unknown error'}`)
    }
  }, [activeChat, backendBase])

  const saveLastAnswerToMemory = useCallback(async () => {
    const assistantMessages = (activeChat?.messages || []).filter(
      (m) => m?.role === 'assistant' && m?.id !== 'welcome' && !m?.isError
    )
    const lastAnswer = assistantMessages[assistantMessages.length - 1]
    const answerText = String(lastAnswer?.content || '').trim()
    if (!answerText) {
      setError('No answer to save.')
      return
    }

    const sourceLines = (Array.isArray(lastKBCitations) ? lastKBCitations : [])
      .slice(0, 4)
      .map((c) => {
        const source = String(c?.source || '(kb)')
        const chunkIndex = Number.isFinite(c?.chunkIndex) ? ` #${c.chunkIndex}` : ''
        return `- ${source}${chunkIndex}`
      })
    const compiledText = sourceLines.length
      ? `${answerText}\n\nSources:\n${sourceLines.join('\n')}`
      : answerText

    try {
      const res = await fetch(`${backendBase}/api/kb/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: compiledText,
          source: 'ui'
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error?.message || data?.message || `HTTP ${res.status}`)
      }
      const fileHint = data?.meta?.path ? ` (${data.meta.path})` : ''
      setNotice(`Saved last answer to Memory${fileHint}.`)
    } catch (err) {
      console.error('Save last answer failed:', err)
      setError(`Memory save failed: ${err.message || 'Unknown error'}`)
    }
  }, [activeChat?.messages, backendBase, lastKBCitations])

  // Clear chat
  const clearChat = () => {
    setChats(prev =>
      prev.map(c =>
        c.id === activeChatId
          ? { ...c, messages: makeWelcome() }
          : c
      )
    )
  }

  const buildNewChat = (id, title, presetId) => {
    const preset = getPresetById(presetId || DEFAULT_PRESET_ID)
    return {
      id,
      title,
      messages: makeWelcome(),
      presetId: preset.id,
      systemPrompt: preset.systemPromptTemplate,
      provider: providerId || 'lmstudio',
      model: selectedModel || '',
      notes: ''
    }
  }

  const createNewChat = () => {
    const id = `chat-${Date.now()}`
    const n = chats.length + 1
    const presetId = activeChat?.presetId || DEFAULT_PRESET_ID
    const newChat = buildNewChat(id, `Chat ${n}`, presetId)
    setChats(prev => [newChat, ...prev])
    setActiveChatId(id)
  }

  const normalizePrompt = (s) => String(s || '').trim().replace(/\s+/g, ' ')
  const hasMinorPromptEdit = (currentPrompt, template) => {
    const current = normalizePrompt(currentPrompt)
    const base = normalizePrompt(template)
    if (!current || !base) return false
    if (current === base) return true
    const lengthDelta = Math.abs(current.length - base.length)
    if (lengthDelta <= 24 && (current.startsWith(base) || base.startsWith(current))) return true
    const overlap = base.slice(0, Math.min(80, base.length))
    return lengthDelta <= 40 && overlap && current.includes(overlap)
  }

  const handlePresetChange = (nextPresetId) => {
    if (!activeChat) return
    const previousPreset = getPresetById(activeChat.presetId || DEFAULT_PRESET_ID)
    const nextPreset = getPresetById(nextPresetId)
    const currentPrompt = activeChat.systemPrompt || ''
    const canAutoReplace = hasMinorPromptEdit(currentPrompt, previousPreset.systemPromptTemplate)

    let replacePrompt = canAutoReplace
    if (!canAutoReplace) {
      replacePrompt = window.confirm('This chat has a custom prompt. Replace with preset prompt?')
    }

    setChats(prev => prev.map(c => {
      if (c.id !== activeChatId) return c
      return {
        ...c,
        presetId: nextPreset.id,
        systemPrompt: replacePrompt ? nextPreset.systemPromptTemplate : c.systemPrompt
      }
    }))

    setPromptSavedToast(
      replacePrompt
        ? `Preset switched to ${nextPreset.name}`
        : `Preset set to ${nextPreset.name} (custom prompt kept)`
    )
  }

  const startRenameChat = (chat) => {
    setEditingChatId(chat.id)
    setEditingChatTitle(chat.title || '')
  }

  const saveRenameChat = (chatId) => {
    const nextTitle = (editingChatTitle || '').trim() || 'Untitled Chat'
    setChats(prev => prev.map(c => (c.id === chatId ? { ...c, title: nextTitle } : c)))
    setEditingChatId(null)
    setEditingChatTitle('')
  }

  const cancelRenameChat = () => {
    setEditingChatId(null)
    setEditingChatTitle('')
  }

  const deleteChat = (chatId) => {
    const chat = chats.find(c => c.id === chatId)
    if (!chat) return
    if (!window.confirm(`Delete "${chat.title}"?`)) return

    const remaining = chats.filter(c => c.id !== chatId)
    if (remaining.length === 0) {
      const id = `chat-${Date.now()}`
      const newChat = buildNewChat(id, 'Chat 1', DEFAULT_PRESET_ID)
      setChats([newChat])
      setActiveChatId(id)
      return
    }

    setChats(remaining)
    if (activeChatId === chatId) {
      setActiveChatId(remaining[0].id)
    }
  }

  const exportActiveChatMarkdown = () => {
    if (!activeChat) return
    const safeTitle = (activeChat.title || 'REZ-AI Chat').trim()
    const safePrompt = String(activeChat.systemPrompt || '').trim()
    const lines = []
    lines.push(`# ${safeTitle}`)
    lines.push('')
    lines.push('<details>')
    lines.push('<summary>System Prompt</summary>')
    lines.push('')
    lines.push('```text')
    lines.push(safePrompt || DEFAULT_SYSTEM_PROMPT)
    lines.push('```')
    lines.push('</details>')
    lines.push('')

    ;(activeChat.messages || []).forEach((msg) => {
      const ts = msg?.timestamp ? new Date(msg.timestamp) : new Date()
      const roleLabel = msg.role === 'user' ? 'You' : 'REZ-AI'
      lines.push(`## ${roleLabel} — ${formatTime(ts)}`)
      lines.push('')
      lines.push(String(msg.content || ''))
      lines.push('')
    })

    const blob = new Blob([lines.join('\n')], {
      type: 'text/markdown;charset=utf-8'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rez-ai-chat-${activeChat.id}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Toggle status demo
  const toggleStatus = () => {
    const statusMsg = {
      id: Date.now().toString(),
      role: 'assistant',
      content: `Status check: ${new Date().toLocaleTimeString()}\nEndpoint: ${backendUrl}\nKB Integration: ${useKB ? 'Enabled' : 'Disabled'}\nDebug: ${debug ? 'ON' : 'OFF'}`,
      timestamp: new Date()
    }
    updateActiveMessages(prev => [...prev, statusMsg])
  }

  const saveSystemPrompt = () => {
    setPromptSavedToast('Saved system prompt for this chat')
  }

  const resetSystemPrompt = () => {
    const presetTemplate = getPresetById(activeChat?.presetId || DEFAULT_PRESET_ID).systemPromptTemplate
    setChats(prev => prev.map(c => c.id === activeChatId
      ? { ...c, systemPrompt: presetTemplate }
      : c
    ))
    setPromptSavedToast('Reset to preset default for this chat')
  }

  const splitMessageIntoChunks = (value, maxLen) => {
    const src = String(value || '')
    const chunks = []
    for (let i = 0; i < src.length; i += maxLen) {
      chunks.push(src.slice(i, i + maxLen))
    }
    return chunks.length ? chunks : ['']
  }

  const recordOpsSnapshot = useCallback(({ ok, provider, latencyMs }) => {
    setOpsSnapshot((prev) => {
      const providerKey = String(provider || providerId || 'unknown').trim() || 'unknown'
      const event = {
        ok: Boolean(ok),
        provider: providerKey,
        latencyMs: Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : null
      }
      const prevEvents = Array.isArray(prev?.events) ? prev.events : []
      return { events: [...prevEvents, event].slice(-OPS_WINDOW_SIZE) }
    })
  }, [providerId])
  const resetOpsSnapshot = useCallback(() => {
    setOpsSnapshot({ events: [] })
    setNotice('Ops reset')
  }, [])
  const runPreflightChecklist = useCallback(() => {
    const checks = []
    const pushCheck = (label, pass, detail) => {
      checks.push({ label, pass: Boolean(pass), detail: String(detail || '') })
    }
    const healthText = String(healthUi.text || '')
    const backendReachable = healthUi.kind === 'ok' || healthUi.kind === 'warn'
    const providerReachable = healthUi.kind === 'ok'
    pushCheck('Backend health reachable', backendReachable, healthText)
    pushCheck('Selected provider reachable', providerReachable, healthText)
    pushCheck(
      'Provider selection valid',
      Boolean(providerId) && visibleProviders.some((p) => p.id === providerId),
      `selected: ${providerId}`
    )
    const hasOkBoolean = typeof lastContractSnapshot?.ok === 'boolean'
    const hasProviderField = Boolean(lastContractSnapshot?.hasMetaProviderField)
    const hasModelField = Boolean(lastContractSnapshot?.hasMetaModelField)
    const contractPass = hasOkBoolean && (!lastContractSnapshot?.ok || (hasProviderField && hasModelField))
    pushCheck(
      'Contract sanity (last chat response)',
      contractPass,
      hasOkBoolean
        ? `ok=${String(lastContractSnapshot.ok)}, meta.provider=${hasProviderField}, meta.model=${hasModelField}`
        : 'no recent chat response snapshot'
    )
    pushCheck(
      'Response contract signal',
      Number.isFinite(lastLatencyMs),
      Number.isFinite(lastLatencyMs) ? `latency: ${lastLatencyMs}ms` : 'no successful response yet'
    )
    pushCheck(
      'Ops window activity',
      (opsMetrics.requestsTotal || 0) > 0,
      `window events: ${opsMetrics.requestsTotal || 0}`
    )
    const passCount = checks.filter((c) => c.pass).length
    const warnCount = checks.length - passCount
    setPreflightChecks({
      ranAt: new Date().toISOString(),
      checks,
      passCount,
      warnCount
    })
    setNotice(`Preflight: ${passCount} pass, ${warnCount} warn`)
  }, [healthUi.kind, healthUi.text, providerId, visibleProviders, lastContractSnapshot, lastLatencyMs, opsMetrics.requestsTotal])
  const setFallbackPrimary = useCallback((nextPrimary) => {
    const primary = LOCAL_PROVIDER_IDS.includes(nextPrimary) ? nextPrimary : DEFAULT_FALLBACK_ORDER[0]
    const secondary = LOCAL_PROVIDER_IDS.find((id) => id !== primary) || DEFAULT_FALLBACK_ORDER[1]
    setProviderFallbackOrder([primary, secondary])
  }, [])
  const setFallbackSecondary = useCallback((nextSecondary) => {
    const secondary = LOCAL_PROVIDER_IDS.includes(nextSecondary) ? nextSecondary : DEFAULT_FALLBACK_ORDER[1]
    const primary = LOCAL_PROVIDER_IDS.find((id) => id !== secondary) || DEFAULT_FALLBACK_ORDER[0]
    setProviderFallbackOrder([primary, secondary])
  }, [])
  const dismissMaintenanceReminder = useCallback(() => {
    if (!maintenanceReminder) return
    setDismissedReminderKey(maintenanceReminderSignature)
    setReminderCooldown({
      signature: maintenanceReminderSignature,
      until: Date.now() + MAINT_REMINDER_COOLDOWN_MS
    })
  }, [maintenanceReminder, maintenanceReminderSignature])
  const applyCompatibilityHint = useCallback((hintId) => {
    if (hintId === 'provider-unreachable' && suggestedFallbackProvider) {
      setProviderId(suggestedFallbackProvider)
      setNotice(`Switched to fallback: ${suggestedFallbackLabel || suggestedFallbackProvider}`)
      return
    }
    if (hintId === 'models-list-error') {
      const target = providerFallbackOrder[0] || 'lmstudio'
      setProviderId(target)
      setNotice(`Switched to fallback primary: ${target}`)
    }
  }, [suggestedFallbackProvider, suggestedFallbackLabel, providerFallbackOrder])
  const clearSessionWarnings = useCallback(() => {
    setError(null)
    setModelsError(null)
    setNotice('Warnings cleared')
  }, [])
  const softRecoverSession = useCallback(() => {
    setError(null)
    setModelsError(null)
    setChunkProgress(null)
    setLastContractSnapshot(null)
    setPreflightChecks(null)
    localStorage.removeItem(PREFLIGHT_RESULT_KEY)
    if (isProviderUnreachable) {
      const target = providerFallbackOrder[0] || 'lmstudio'
      setProviderId(target)
    }
    setNotice('Session recovered (soft)')
  }, [isProviderUnreachable, providerFallbackOrder])
  const beginRecoveryFeedback = useCallback((actionLabel) => {
    const before = { ...recoverySignalRef.current }
    setRecoveryFeedback({
      actionLabel: String(actionLabel || 'action'),
      before,
      after: null,
      result: 'checking',
      at: new Date().toISOString()
    })
    if (recoveryFeedbackTimerRef.current) {
      clearTimeout(recoveryFeedbackTimerRef.current)
    }
    recoveryFeedbackTimerRef.current = setTimeout(() => {
      const after = { ...recoverySignalRef.current }
      const toScore = (snapshot) => (
        (snapshot.contract === 'PASS' ? 1 : 0) +
        (snapshot.provider === 'PASS' ? 1 : 0) +
        (snapshot.trend === 'PASS' ? 1 : 0)
      )
      const beforeScore = toScore(before)
      const afterScore = toScore(after)
      const result = afterScore > beforeScore
        ? 'improved'
        : afterScore < beforeScore
          ? 'regressed'
          : 'no-change'
      setRecoveryFeedback({
        actionLabel: String(actionLabel || 'action'),
        before,
        after,
        result,
        at: new Date().toISOString()
      })
    }, 1500)
  }, [])
  const runGuidedRecoveryPrimary = useCallback(() => {
    if (!guidedRecoverySuggestion) return
    if (guidedRecoverySuggestion.key === 'contract-drift') {
      beginRecoveryFeedback(guidedRecoverySuggestion.primaryLabel)
      runPreflightChecklist()
      return
    }
    if (guidedRecoverySuggestion.key === 'provider-stability') {
      beginRecoveryFeedback(guidedRecoverySuggestion.primaryLabel)
      if (suggestedFallbackProvider) {
        setProviderId(suggestedFallbackProvider)
        setNotice(`Switched to fallback: ${suggestedFallbackLabel || suggestedFallbackProvider}`)
        return
      }
      const fallbackPrimary = providerFallbackOrder[0]
      if (fallbackPrimary) {
        setProviderId(fallbackPrimary)
        setNotice(`Switched to fallback primary: ${fallbackPrimary}`)
        return
      }
      runPreflightChecklist()
    }
  }, [
    beginRecoveryFeedback,
    guidedRecoverySuggestion,
    runPreflightChecklist,
    suggestedFallbackProvider,
    suggestedFallbackLabel,
    providerFallbackOrder
  ])
  const runGuidedRecoverySecondary = useCallback(() => {
    if (!guidedRecoverySuggestion) return
    if (guidedRecoverySuggestion.key === 'contract-drift') {
      beginRecoveryFeedback(guidedRecoverySuggestion.secondaryLabel)
      softRecoverSession()
      return
    }
    if (guidedRecoverySuggestion.key === 'provider-stability') {
      beginRecoveryFeedback(guidedRecoverySuggestion.secondaryLabel)
      if (guidedRecoverySuggestion.secondaryLabel === 'Run preflight') {
        runPreflightChecklist()
        return
      }
      softRecoverSession()
    }
  }, [beginRecoveryFeedback, guidedRecoverySuggestion, runPreflightChecklist, softRecoverSession])

  // NOTE: Keep this memo ABOVE handleSend/useCallbacks that reference it.
  // Reordering below usages can trigger TDZ runtime errors.
  const contextMessagesForSend = useMemo(
    () => assembleContextMessages(messages, conversationSummary),
    [messages, conversationSummary]
  )
  const hardenedSystemPromptForSend = useMemo(() => {
    const basePrompt = String(activeChat?.systemPrompt || '').trim() || DEFAULT_SYSTEM_PROMPT
    const presetId = String(activePreset?.id || 'general').toLowerCase()
    const appendOnce = (source, block) => {
      const src = String(source || '').trim()
      const blk = String(block || '').trim()
      if (!blk) return src
      if (src.includes(blk)) return src
      return src ? `${src}\n\n${blk}` : blk
    }
    const globalRules = [
      'Role: You are a local REZ-AI assistant grounded in the current project context.',
      'Prefer short, actionable steps over generic explanations.',
      'If the user asks to verify UI behavior, provide exact "where to click" and "what to look for" checks.',
      'Do not ask vague questions; ask at most ONE precise question only when truly blocked.'
    ]
    const presetRules = presetId === 'dev'
      ? [
        'Developer preset (strict): never invent file paths, filenames, components, endpoints, ports, or URLs.',
        'Developer preset (grounding): prioritize only confirmed repo paths/symbols from user-provided context and known references.',
        'Developer preset (grounding): prefer exact copy-paste edits over generic implementation suggestions.',
        'Developer preset (scope): prefer small, scoped outcomes that fit the requested change; avoid broad rewrites unless explicitly requested.',
        'Developer preset (verification-first): Manual verify must be practical and tied to touched surfaces/files (not generic).',
        'Developer preset (verification-first): for UI tasks, include exact "where to click" and "what to look for" checks in Manual verify.',
        'Developer preset (strict): allowed known references in this repo are `apps/ui/src/App.jsx`, `/api/chat`, and localStorage key `conversationSummary:<chatId>`.',
        'Developer preset (strict): if path/endpoint is unknown, write exactly: "UNKNOWN PATH/ENDPOINT — need repo context" and ask at most ONE precise question.',
        'Developer preset (strict self-check): if draft includes `SummaryComponent`, `/api/summary`, `localhost:3001/api/summary`, or `src/components`, remove and replace with UNKNOWN.',
        'Developer preset: enforce mandatory response structure block.'
      ]
      : presetId === 'general'
        ? [
          'General preset: keep answers concise using 3-6 bullets maximum.'
        ]
        : []

    const hardeningBlock = `[RESPONSE HARDENING]\n- ${[...globalRules, ...presetRules].join('\n- ')}`
    const withHardening = appendOnce(basePrompt, hardeningBlock)
    return presetId === 'dev'
      ? appendOnce(withHardening, DEV_RESPONSE_STRUCTURE_RULE)
      : withHardening
  }, [activeChat?.systemPrompt, activePreset?.id, DEFAULT_SYSTEM_PROMPT])

  // Send message (supports auto-chunking for long input)
  const handleSend = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || isLoading) return
    if (text.length > MAX_MESSAGE_CHARS) {
      setError(`Message is too long. Max ${MAX_MESSAGE_CHARS} characters.`)
      return
    }

    setLastUserText(text)
    setInputValue('')
    setIsLoading(true)
    setError(null)
    setChunkProgress(null)

    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    try {
      const chunks = text.length > MAX_MESSAGE_CHARS
        ? splitMessageIntoChunks(text, MAX_MESSAGE_CHARS)
        : [text]

      for (let i = 0; i < chunks.length; i++) {
        const part = i + 1
        const total = chunks.length
        const chunk = chunks[i]
        const chunkLabel = total > 1 ? `(Part ${part}/${total})\n` : ''
        const chunkTextForModel = chunk.slice(0, MAX_MESSAGE_CHARS)
        const chunkForValidation = chunkTextForModel.trim()
        if (!chunkForValidation) {
          continue
        }
        const contextMessages = contextMessagesForSend
        const contextPrefix = contextMessages.length
          ? `${contextMessages.map((m) => `${String(m.role || 'user').toUpperCase()}: ${String(m.content || '')}`).join('\n')}\n\n`
          : ''
        const assembledMessageForModel = `${contextPrefix}${chunkTextForModel}`.slice(0, MAX_MESSAGE_CHARS)

        if (total > 1) {
          setChunkProgress({ current: part, total })
        }

        const userMsg = {
          id: `${Date.now()}-u-${part}`,
          role: 'user',
          content: `${chunkLabel}${chunk}`,
          timestamp: new Date()
        }
        appendToActiveChat(userMsg)

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        try {
          const response = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: assembledMessageForModel,
              systemPrompt: hardenedSystemPromptForSend,
              useKB,
              provider: providerId,
              model: currentModelLabel,
              planMode
            }),
            signal: controller.signal
          })
          const data = await response.json().catch(() => ({}))
          setLastContractSnapshot({
            ok: data?.ok,
            hasMetaObject: Boolean(data?.meta && typeof data.meta === 'object' && !Array.isArray(data.meta)),
            hasMetaProviderField: Boolean(data?.meta && Object.prototype.hasOwnProperty.call(data.meta, 'provider')),
            hasMetaModelField: Boolean(data?.meta && Object.prototype.hasOwnProperty.call(data.meta, 'model')),
            hasReplyString: typeof data?.reply === 'string',
            hasErrorObject: Boolean(data?.error && typeof data.error === 'object' && !Array.isArray(data.error))
          })

          if (!response.ok) {
            if (response.status === 429) {
              const code = data?.error?.code
              if (code === 'RATE_LIMITED') throw new Error('Too many requests, slow down.')
              throw new Error('Assistant is busy. Please wait...')
            }
            if (data?.error?.code === 'PAYLOAD_TOO_LARGE') throw new Error('Message too long.')
            if (data?.error?.code === 'MESSAGE_TOO_LONG') {
              const limit = data?.meta?.limits?.maxMessageChars || MAX_MESSAGE_CHARS
              throw new Error(`Message too long (max ${limit} chars).`)
            }
            if (data?.error?.code === 'INVALID_MESSAGE') throw new Error('Empty/invalid message.')
            if (['ollama_failed', 'lm_http_error', 'lm_request_failed', 'lm_bad_json'].includes(data?.error?.code)) {
              throw new Error(`Provider unreachable: ${providerId}`)
            }
            if (data?.error?.code === 'provider_not_implemented') {
              throw new Error('Selected provider is not implemented yet. Please use LM Studio for now.')
            }
            throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}: ${response.statusText}`)
          }

          if (data?.ok === false) {
            if (data?.error?.code === 'RATE_LIMITED') throw new Error('Too many requests, slow down.')
            if (data?.error?.code === 'PAYLOAD_TOO_LARGE') throw new Error('Message too long.')
            if (data?.error?.code === 'MESSAGE_TOO_LONG') {
              const limit = data?.meta?.limits?.maxMessageChars || MAX_MESSAGE_CHARS
              throw new Error(`Message too long (max ${limit} chars).`)
            }
            if (data?.error?.code === 'INVALID_MESSAGE') throw new Error('Empty/invalid message.')
            if (['ollama_failed', 'lm_http_error', 'lm_request_failed', 'lm_bad_json'].includes(data?.error?.code)) {
              throw new Error(`Provider unreachable: ${providerId}`)
            }
            if (data?.error?.code === 'provider_not_implemented') {
              throw new Error('Selected provider is not implemented yet. Please use LM Studio for now.')
            }
            throw new Error(data?.error?.message || data?.message || 'Assistant request failed')
          }

          if (debug) console.log('CHAT_RESPONSE:', data)

          const assistantText = typeof data?.reply === 'string' ? data.reply : ''
          const approxTokensIn = Math.ceil(assembledMessageForModel.length / 4)
          const approxTokensOut = Math.ceil((assistantText || '').length / 4)
          const meta = data?.meta || {}
          const usage = meta?.usage || {}
          const promptTokensRaw = Number.isFinite(usage?.prompt_tokens) ? usage.prompt_tokens : null
          const completionTokensRaw = Number.isFinite(usage?.completion_tokens) ? usage.completion_tokens : null
          setLastStats({
            tokensIn: promptTokensRaw ?? approxTokensIn,
            tokensOut: completionTokensRaw ?? approxTokensOut
          })
          setLastUsageMode(promptTokensRaw != null && completionTokensRaw != null ? 'real' : 'approx')
          setLastLatencyMs(Number.isFinite(meta?.latencyMs) ? meta.latencyMs : null)
          setLastModelName(typeof meta?.model === 'string' ? meta.model : null)
          setLastProviderName(typeof meta?.provider === 'string' ? meta.provider : providerId)
          setLastKbEnabled(Boolean(meta?.kb?.enabled))
          const kbHits = Number.isFinite(meta?.kb?.hits) ? meta.kb.hits : 0
          const kbMode = typeof meta?.kb?.mode === 'string' ? meta.kb.mode : 'lexical'
          const kbCitations = Array.isArray(meta?.kb?.citations) ? meta.kb.citations : []
          const kbSourceCount = Number.isFinite(meta?.kb?.sourceCount) ? meta.kb.sourceCount : kbCitations.length
          const kbInfluenced = typeof meta?.kb?.influenced === 'boolean' ? meta.kb.influenced : kbHits > 0
          setLastKBHits(kbHits)
          setLastKBMode(kbMode)
          setLastKBInfluenced(Boolean(kbInfluenced))
          setLastKBSourceCount(Number.isFinite(kbSourceCount) ? kbSourceCount : 0)
          setLastKBCitations(kbCitations)
          setLastKBTopK(Number.isFinite(meta?.kb?.topK) ? meta.kb.topK : 4)
          recordOpsSnapshot({
            ok: true,
            provider: typeof meta?.provider === 'string' ? meta.provider : providerId,
            latencyMs: Number.isFinite(meta?.latencyMs) ? meta.latencyMs : null
          })

          const assistantMsg = {
            id: `${Date.now()}-a-${part}`,
            role: 'assistant',
            content: assistantText || '[Empty response]',
            timestamp: new Date()
          }
          appendToActiveChat(assistantMsg)
        } finally {
          clearTimeout(timeoutId)
        }
      }
    } catch (err) {
      console.error('Chat error:', err)
      recordOpsSnapshot({ ok: false, provider: providerId, latencyMs: null })
      const isTimeout = err.name === 'AbortError'
      const timeoutSec = Math.floor(REQUEST_TIMEOUT_MS / 1000)
      const msg = isTimeout
        ? `Timeout: provider/backend too slow (${timeoutSec}s). Try again.`
        : `Connection failed: ${err.message || 'Unknown error'}`
      setError(msg)

      // Add error message with retry hint (innovation)
      const errorMsg = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: isTimeout
          ? `⚠️ Request timed out.\nEndpoint: ${backendUrl}\n\nError: ${msg}\n\nTip: The model is responding slowly. Retry or switch provider/model.`
          : `⚠️ Backend unreachable.\nEndpoint: ${backendUrl}\n\nError: ${msg}\n\nTip: Check backend terminal logs & LM Studio server.`,
        timestamp: new Date(),
        isError: true,
        retryText: text
      }
      appendToActiveChat(errorMsg)
    } finally {
      setChunkProgress(null)
      setIsLoading(false)
    }
  }, [inputValue, isLoading, backendUrl, debug, appendToActiveChat, hardenedSystemPromptForSend, useKB, providerId, currentModelLabel, planMode, recordOpsSnapshot, contextMessagesForSend])

  // Enter to send, Shift+Enter newline, Ctrl+Enter send (innovation)
  const handleKeyDown = (e) => {
    if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault()
      handleSend()
    }
  }

  // Retry from error message (innovation)
  const retrySend = (text) => {
    setInputValue(text)
    setTimeout(() => handleSend(), 0)
  }

  const showSoftWarning = inputValue.length >= SOFT_WARNING_THRESHOLD
  const canSend = Boolean(inputValue.trim()) && !isLoading
  const modelStatsDetailCount = 28 + (visibleCitations.length > 0 ? 1 : 0)
  const preflightLastRunDetailLineCount = Array.isArray(preflightChecks?.checks) && preflightChecks.checks.length > 0
    ? 1 + preflightChecks.checks.length
    : 0
  const preflightDetailCount = 33
    + preflightLastRunDetailLineCount
    + contractDriftChecks.length
    + (shouldShowMaintenanceReminder ? 1 : 0)
    + (guidedRecoverySuggestion ? 1 : 0)
    + (recoveryFeedback ? 1 : 0)
    + (compatibilityHints.length > 0 ? 1 : 0)
  const preflightCoreActionCue = (() => {
    const readinessWatch = String(readinessSignalRollup || '').startsWith('WATCH')
    const freshnessStale = String(signalFreshnessIndicator || '').startsWith('STALE')
    const volatilityHigh = String(warningVolatilityPosture || '').startsWith('HIGH')
    const driftWarn = String(contractDriftSummary?.status || '').toUpperCase() === 'WARN'
    const handshakeMixed = String(reliabilityHandshakeSummary || '').startsWith('MIXED')
    if (freshnessStale || volatilityHigh || driftWarn) {
      return 'Run preflight now and re-check Details.'
    }
    if (readinessWatch || handshakeMixed) {
      return 'Monitor closely; run Soft recover if warnings persist.'
    }
    return 'Monitor; run preflight after the next change.'
  })()
  const preflightCoreActionConfidenceTier = (() => {
    const readinessWatch = String(readinessSignalRollup || '').startsWith('WATCH')
    const freshnessStale = String(signalFreshnessIndicator || '').startsWith('STALE')
    const volatilityHigh = String(warningVolatilityPosture || '').startsWith('HIGH')
    const driftWarn = String(contractDriftSummary?.status || '').toUpperCase() === 'WARN'
    const handshakeMixed = String(reliabilityHandshakeSummary || '').startsWith('MIXED')
    if (freshnessStale || volatilityHigh || driftWarn) {
      return 'HIGH'
    }
    if (readinessWatch || handshakeMixed) {
      return 'MED'
    }
    return 'LOW'
  })()
  const preflightCoreActionConfidenceReason = (() => {
    const driftStatus = String(contractDriftSummary?.status || 'PASS').toUpperCase()
    const freshnessStale = String(signalFreshnessIndicator || '').startsWith('STALE')
    const pressureElevated = String(volatilityPressureTag || '').startsWith('ELEVATED')
    const volatilityMed = String(warningVolatilityPosture || '').startsWith('MED')
      || String(warningVolatilityPosture || '').startsWith('MEDIUM')
    const recencyLagging = String(recencyAlignmentHintText || '').startsWith('LAGGING')
    if (preflightCoreActionConfidenceTier === 'HIGH') {
      return `drift ${driftStatus} or ${freshnessStale ? 'stale' : 'fresh'}/${pressureElevated ? 'pressure elevated' : 'pressure low'}`
    }
    if (preflightCoreActionConfidenceTier === 'MED') {
      return `mixed signals (${recencyLagging ? 'lagging recency' : 'recency aligned'} or ${volatilityMed ? 'MED volatility' : 'watch posture'})`
    }
    return 'aligned + fresh + low pressure'
  })()
  const promptQualityCue = (() => {
    const promptText = String(inputValue || '').trim()
    const hasPrompt = promptText.length > 0
    const hasSystemPrompt = String(activeChat?.systemPrompt || '').trim().length > 0
    const presetId = String(activePreset?.id || 'general').toLowerCase()
    const confidenceTier = String(preflightCoreActionConfidenceTier || 'MED')
    const hasTaskSignal = /(^|\n)\s*(task|fix|implement|update|refactor|bug|issue)\b/i.test(promptText)
    const hasContextSignal = /(^|\n)\s*(file|path|repo|code context|component|endpoint|screen|ui area)\b/i.test(promptText)
    const hasConstraintSignal = /(^|\n)\s*(constraint|must|do not|should|without|limit|no )\b/i.test(promptText)
    const hasOutcomeSignal = /(^|\n)\s*(acceptance criteria|expected outcome|verify|done when|success)\b/i.test(promptText)
    const devMissing = []
    if (!hasTaskSignal) devMissing.push('task')
    if (!hasContextSignal) devMissing.push('repo context/file')
    if (!hasConstraintSignal) devMissing.push('constraints')
    if (!hasOutcomeSignal) devMissing.push('expected outcome')
    const presetShape = presetId === 'general'
      ? 'shape: goal + context + output format'
      : presetId === 'dev'
        ? 'shape: task + constraints + acceptance criteria + code context'
        : 'shape: feature + UI area + expected behavior + edge cases'
    const devCalibrationNudge = presetId === 'dev'
      ? (devMissing.length
          ? `dev check: add ${devMissing.slice(0, 2).join(' + ')}`
          : 'dev check: framing looks complete')
      : ''
    const confidenceNudge = confidenceTier === 'HIGH'
      ? 'be concrete + scoped'
      : confidenceTier === 'MED'
        ? 'clarify constraints + acceptance criteria'
        : 'keep request specific'
    if (!hasPrompt) {
      return `${presetShape}; ${devCalibrationNudge ? `${devCalibrationNudge}; ` : ''}${confidenceNudge}.`
    }
    if (!hasSystemPrompt) {
      return `add a short system prompt; ${presetShape}; ${devCalibrationNudge ? `${devCalibrationNudge}; ` : ''}${confidenceNudge}.`
    }
    return `${presetShape}; ${devCalibrationNudge ? `${devCalibrationNudge}; ` : ''}${confidenceNudge}.`
  })()
  const promptScaffoldBlock = (() => {
    const presetId = String(activePreset?.id || 'general').toLowerCase()
    const pressureGuidance = preflightCoreActionConfidenceTier === 'HIGH'
      ? 'Keep it concrete + scoped.'
      : preflightCoreActionConfidenceTier === 'MED'
        ? 'Clarify constraints + acceptance criteria.'
        : 'Keep request specific.'
    const shapeBlock = presetId === 'general'
      ? 'Goal:\nContext:\nOutput format:'
      : presetId === 'dev'
        ? 'Task:\nConstraints:\nAcceptance criteria:\nCode context (file/path):'
        : 'Feature:\nUI area:\nExpected behavior:\nEdge cases:'
    return `${shapeBlock}\n${pressureGuidance}`
  })()
  const hasScaffoldHeaderInInput = /(^|\n)(Goal:|Task:|Feature:)\s*$/m.test(String(inputValue || ''))
  const insertPromptScaffold = () => {
    setInputValue((prev) => {
      const current = String(prev || '')
      if (!current.trim()) return promptScaffoldBlock
      return `${promptScaffoldBlock}\n\n${current}`
    })
  }
  const clearPromptScaffold = () => {
    setInputValue((prev) => {
      const current = String(prev || '')
      if (!current) return current
      if (current.startsWith(`${promptScaffoldBlock}\n\n`)) {
        return current.slice(promptScaffoldBlock.length + 2)
      }
      if (current.startsWith(promptScaffoldBlock)) {
        return current.slice(promptScaffoldBlock.length).replace(/^\n+/, '')
      }
      const blockWithGap = `${promptScaffoldBlock}\n\n`
      if (current.includes(blockWithGap)) {
        return current.replace(blockWithGap, '')
      }
      if (current.includes(promptScaffoldBlock)) {
        return current.replace(promptScaffoldBlock, '').replace(/^\n+/, '')
      }
      return current
    })
  }
  const insertWorkflowRequestHelper = () => {
    setInputValue((prev) => {
      const current = String(prev || '')
      const compact = (value, max = 78) => {
        const normalized = String(value || '').replace(/\s+/g, ' ').trim()
        if (!normalized) return '—'
        return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
      }
      const stripExistingWorkflowHeader = (value) => {
        const src = String(value || '')
        const match = src.match(/^WORKFLOW REQUEST:[\s\S]*?(?:\n{2,}|$)/i)
        if (!match) return src
        return src.slice(match[0].length).replace(/^\n+/, '')
      }
      const baseText = stripExistingWorkflowHeader(current)
      const presetId = String(activePreset?.id || 'general').toLowerCase()
      const taskLine = baseText.trim()
        ? compact(baseText.trim().split(/\r?\n/)[0], 92)
        : (presetId === 'dev' ? 'Implement a scoped code change safely with verify steps.' : 'Prepare the next project workflow step clearly.')
      const expectedOutcome = presetId === 'dev'
        ? 'Patch-ready edits + concise verify bullets + clear done criteria.'
        : presetId === 'general'
          ? 'Concise actionable project result with clear next step.'
          : 'Clear feature outcome with edge-case note.'
      const constraintHint = preflightCoreActionConfidenceTier === 'HIGH'
        ? 'Keep scope tight; avoid broad rewrites'
        : preflightCoreActionConfidenceTier === 'MED'
          ? 'Clarify constraints + acceptance criteria'
          : 'Keep request specific and bounded'
      const helperBlock = [
        'WORKFLOW REQUEST:',
        `Task: ${taskLine}`,
        `Context: ${compact(composerContextSnapshot, 64)}`,
        `Constraints: ${constraintHint}`,
        `Expected outcome: ${expectedOutcome}`
      ].join('\n')
      const nextValue = baseText.trim() ? `${helperBlock}\n\n${baseText}` : helperBlock
      setTimeout(() => {
        if (textareaRef.current) {
          const len = nextValue.length
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(len, len)
        }
      }, 0)
      return nextValue
    })
  }
  const insertAnalysisRequestHelper = () => {
    setInputValue((prev) => {
      const current = String(prev || '')
      const compact = (value, max = 84) => {
        const normalized = String(value || '').replace(/\s+/g, ' ').trim()
        if (!normalized) return '—'
        return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
      }
      const stripExistingAnalysisHeader = (value) => {
        const src = String(value || '')
        const match = src.match(/^ANALYSIS REQUEST:[\s\S]*?(?:\n{2,}|$)/i)
        if (!match) return src
        return src.slice(match[0].length).replace(/^\n+/, '')
      }
      const baseText = stripExistingAnalysisHeader(current)
      const firstLine = baseText.trim()
        ? compact(baseText.trim().split(/\r?\n/)[0], 94)
        : 'Review current repo/project state and report key findings.'
      const analysisType = composerContextHintMode === 'FOLLOW-UP'
        ? 'Follow-up analysis'
        : composerContextHintMode === 'MULTI-ASK'
          ? 'Multi-topic audit summary'
          : 'Baseline project status check'
      const outputStyle = String(activePreset?.id || '').toLowerCase() === 'dev'
        ? 'Findings first + risk notes + 3-5 manual verify checks.'
        : 'Compact findings + clear next action.'
      const helperBlock = [
        'ANALYSIS REQUEST:',
        `Type: ${analysisType}`,
        `Focus: ${firstLine}`,
        `Context: ${compact(composerContextSnapshot, 64)}`,
        `Output: ${outputStyle}`
      ].join('\n')
      const nextValue = baseText.trim() ? `${helperBlock}\n\n${baseText}` : helperBlock
      setTimeout(() => {
        if (textareaRef.current) {
          const len = nextValue.length
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(len, len)
        }
      }, 0)
      return nextValue
    })
  }
  const composerContextHint = (() => {
    const text = String(inputValue || '')
    const trimmed = text.trim()
    const hasPriorAssistantMessage = Array.isArray(messages) && messages.some((m) => m?.role === 'assistant')
    const hasPreflightWarnings = Number(preflightChecks?.warnCount || 0) > 0
      || String(contractDriftSummary?.status || '').toUpperCase() === 'WARN'
    const hasRecoveryFeedback = Boolean(recoveryFeedback)
    const followUpRefTag = hasPreflightWarnings
      ? 'Ref: last preflight'
      : hasRecoveryFeedback
        ? 'Ref: last recovery'
        : hasPriorAssistantMessage
          ? 'Ref: last reply'
          : ''
    if (!trimmed) {
      return 'NEW CHAT - "Add goal + constraints."'
    }
    const questionMarkCount = (trimmed.match(/\?/g) || []).length
    const lineCount = trimmed.split(/\r?\n/).length
    const hasBulletLike = trimmed.includes('- ') || trimmed.includes('•')
    if (questionMarkCount >= 2 || lineCount >= 3 || hasBulletLike) {
      return 'MULTI-ASK - "Split into 1–2 tasks."'
    }
    const followUpKeywordRegex = /\b(ok|continue|next|გავაგრძელოთ)\b/i
    const isShortFollowUp = trimmed.length < 40
    if (hasPriorAssistantMessage && (isShortFollowUp || followUpKeywordRegex.test(trimmed))) {
      return `FOLLOW-UP - "Reference last result/error."${followUpRefTag ? ` (${followUpRefTag})` : ''}`
    }
    return `FOLLOW-UP - "Add 1 concrete detail."${followUpRefTag ? ` (${followUpRefTag})` : ''}`
  })()
  const composerContextHintMode = String(composerContextHint || '').startsWith('FOLLOW-UP')
    ? 'FOLLOW-UP'
    : String(composerContextHint || '').startsWith('MULTI-ASK')
      ? 'MULTI-ASK'
      : 'NEW CHAT'
  const composerFollowUpRefTag = (() => {
    const hasPriorAssistantMessage = Array.isArray(messages) && messages.some((m) => m?.role === 'assistant')
    if (Number(preflightChecks?.warnCount || 0) > 0 || String(contractDriftSummary?.status || '').toUpperCase() === 'WARN') {
      return 'last preflight'
    }
    if (recoveryFeedback) {
      return 'last recovery'
    }
    if (hasPriorAssistantMessage) {
      return 'last reply'
    }
    return ''
  })()
  const insertContextRefLine = () => {
    setInputValue((prev) => {
      const current = String(prev || '')
      if (/^REF:/i.test(current.trimStart())) {
        return current
      }
      const refLine = composerFollowUpRefTag === 'last preflight'
        ? `REF: Last preflight (pass ${Number(preflightChecks?.passCount || 0)}, warn ${Number(preflightChecks?.warnCount || 0)}). Focus on WARN items.`
        : composerFollowUpRefTag === 'last recovery'
          ? `REF: Last recovery outcome: ${String(recoveryFeedback?.result || '').toLowerCase() === 'improved'
            ? 'IMPROVED'
            : String(recoveryFeedback?.result || '').toLowerCase() === 'no-change'
              ? 'NO-CHANGE'
              : 'REGRESSED'}.`
          : 'REF: Continue from last assistant reply; mention the specific error/result.'
      const nextValue = current.trim() ? `${refLine}\n\n${current}` : refLine
      setTimeout(() => {
        if (textareaRef.current) {
          const len = nextValue.length
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(len, len)
        }
      }, 0)
      return nextValue
    })
  }
  const insertContextPack = () => {
    setInputValue((prev) => {
      const current = String(prev || '')
      if (/^CONTEXT PACK:/i.test(current.trimStart())) {
        return current
      }
      const presetName = String(activePreset?.name || 'General')
      const passCount = Number(preflightChecks?.passCount || 0)
      const warnCount = Number(preflightChecks?.warnCount || 0)
      const hasPreflightSummary = passCount > 0 || warnCount > 0
      const recoveryResult = String(recoveryFeedback?.result || '').toLowerCase()
      const hasRecoverySummary = recoveryResult && recoveryResult !== 'checking'
      const recoveryLabel = recoveryResult === 'improved'
        ? 'IMPROVED'
        : recoveryResult === 'no-change'
          ? 'NO-CHANGE'
          : 'REGRESSED'
      const lastAssistantReply = Array.isArray(messages)
        ? [...messages].reverse().find((m) => m?.role === 'assistant' && String(m?.content || '').trim())
        : null
      const rawReply = String(lastAssistantReply?.content || '').replace(/\s+/g, ' ').trim()
      const excerpt = rawReply
        ? (rawReply.length > 120 ? `${rawReply.slice(0, 119)}…` : rawReply)
        : ''

      const lines = [
        'CONTEXT PACK:',
        `Preset: ${presetName}`,
        `Snapshot: ${composerContextSnapshot}`,
      ]
      if (hasPreflightSummary) {
        lines.push(`Preflight: pass ${passCount} warn ${warnCount}`)
      }
      if (hasRecoverySummary) {
        lines.push(`Recovery: ${recoveryLabel}`)
      }
      if (excerpt) {
        lines.push(`Last reply: "${excerpt}"`)
      }
      const contextBlock = lines.slice(0, 6).join('\n')
      const nextValue = current.trim() ? `${contextBlock}\n\n${current}` : contextBlock

      setTimeout(() => {
        if (textareaRef.current) {
          const len = nextValue.length
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(len, len)
        }
      }, 0)
      return nextValue
    })
  }
  const composerContextSnapshot = (() => {
    const presetName = String(activePreset?.name || 'General')
    const compact = (value, max = 88) => {
      const normalized = String(value || '').replace(/\s+/g, ' ').trim()
      if (!normalized) return ''
      return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
    }
    if (Number(preflightChecks?.passCount || 0) > 0 || Number(preflightChecks?.warnCount || 0) > 0) {
      return compact(`(${presetName}) last preflight pass ${Number(preflightChecks?.passCount || 0)} warn ${Number(preflightChecks?.warnCount || 0)}`)
    }
    if (recoveryFeedback && String(recoveryFeedback?.result || '').toLowerCase() !== 'checking') {
      const outcome = String(recoveryFeedback?.result || '').toLowerCase() === 'improved'
        ? 'IMPROVED'
        : String(recoveryFeedback?.result || '').toLowerCase() === 'no-change'
          ? 'NO-CHANGE'
          : 'REGRESSED'
      return compact(`(${presetName}) last recovery ${outcome}`)
    }
    const lastAssistantReply = Array.isArray(messages)
      ? [...messages].reverse().find((m) => m?.role === 'assistant' && String(m?.content || '').trim())
      : null
    if (lastAssistantReply) {
      const topic = compact(String(lastAssistantReply.content || '').split('\n')[0], 42)
      return compact(`(${presetName}) last reply: ${topic}`, 88)
    }
    return compact(`(${presetName}) no recent context yet`)
  })()
  const conversationSummaryPreview = (() => {
    const normalized = String(conversationSummary || '').replace(/\s+/g, ' ').trim()
    if (!normalized) return ''
    return normalized.length > 80 ? `${normalized.slice(0, 79)}…` : normalized
  })()
  const canShowAdvancedComposerToggle = String(activePreset?.id || '').toLowerCase() === 'dev' || isProMode
  const shouldShowAdvancedComposerTools = canShowAdvancedComposerToggle && showAdvancedComposerTools
  const isDeveloperPreset = String(activePreset?.id || '').toLowerCase() === 'dev'
  // Keep debug preview derived from the same assembled context used by send logic.
  // This avoids drift between what developers see and what /api/chat receives.
  const contextDebugPreviewText = useMemo(() => {
    const hasSummary = String(conversationSummary || '').trim().length > 0
    const lines = ['[summary]']
    if (hasSummary) {
      lines.push(`Conversation summary: ${compactContextText(conversationSummary, SUMMARY_MAX_LENGTH)}`)
    } else {
      lines.push('—')
    }
    lines.push('', '[recent messages]')
    const recent = hasSummary
      ? contextMessagesForSend.filter((m) => String(m.role || '').toLowerCase() !== 'system')
      : contextMessagesForSend
    if (!recent.length) {
      lines.push('—')
    } else {
      recent.forEach((m) => {
        lines.push(`${String(m.role || 'user').toUpperCase()}: ${String(m.content || '')}`)
      })
    }
    return lines.join('\n')
  }, [conversationSummary, contextMessagesForSend])
  const composerHintStyle = { lineHeight: 1.45, marginTop: 4 }

  return (
    <div className="app">
      {error && <Toast message={error} onClose={() => setError(null)} tone="error" icon="⚠️" />}
      {notice && <Toast message={notice} onClose={() => setNotice(null)} tone="success" icon="✅" />}

      {/* Mobile Sidebar Toggle */}
      <button
        className="sidebar-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle sidebar"
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* Left Sidebar */}
      <aside
        className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}
        style={sidebarOpen ? { width: 376, minWidth: 352 } : undefined}
      >
        <div className="sidebar-header">
          <div className="logo">REZ-AI</div>
          <div className="version">v0.1.0</div>
        </div>

        <div className="sidebar-section">
          <h3 className="section-title">CHATS</h3>
          <div className="chat-list">
            {chats.map(c => (
              <div key={c.id} className={`chat-item-row ${c.id === activeChatId ? 'active' : ''}`}>
                {editingChatId === c.id ? (
                  <div className="chat-rename-wrap">
                    <input
                      className="chat-rename-input"
                      value={editingChatTitle}
                      onChange={(e) => setEditingChatTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRenameChat(c.id)
                        if (e.key === 'Escape') cancelRenameChat()
                      }}
                      autoFocus
                    />
                    <div className="chat-actions">
                      <button className="chat-action-btn" onClick={() => saveRenameChat(c.id)}>Save</button>
                      <button className="chat-action-btn" onClick={cancelRenameChat}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      className={`chat-item ${c.id === activeChatId ? 'active' : ''}`}
                      onClick={() => setActiveChatId(c.id)}
                    >
                      <span className="chat-icon">💬</span>
                      <span className="chat-name">{c.title}</span>
                    </button>
                    <div className="chat-actions">
                      <button
                        className="chat-action-btn"
                        onClick={() => startRenameChat(c)}
                        title="Rename chat"
                      >
                        Edit
                      </button>
                      <button
                        className="chat-action-btn danger"
                        onClick={() => deleteChat(c.id)}
                        title="Delete chat"
                      >
                        Del
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          <button className="btn-secondary btn-full" onClick={createNewChat}>
            <span>+</span> New
          </button>
        </div>

        <div className="sidebar-section" style={{ marginBottom: 10 }}>
          <h3 className="section-title">KNOWLEDGE BASE</h3>
          <div className="kb-status">
            <div className="kb-row">
              <span className="kb-label">KB Status</span>
              <span className={`pill ${useKB ? 'pill-warn' : 'pill-muted'}`}>{kbPanelStatusLabel}</span>
            </div>
            <div className="kb-row">
              <span className="kb-label">Last response KB hits</span>
              <span className="kb-label">{lastKBHits}</span>
            </div>
            <div className="kb-row">
              <span className="kb-label">KB influenced answer</span>
              <span className="kb-label">{kbInfluenceLabel}</span>
            </div>
            <div className="kb-row">
              <span className="kb-label">Last retrieval mode</span>
              <span className="kb-label">{kbModeLabel}</span>
            </div>
            <div className="kb-row">
              <span className="kb-label">Last source refs</span>
              <span className="kb-label">{lastKBSourceCount}</span>
            </div>

            <label className="toggle-row">
              <span>Use KB for next request</span>
              <div className={`toggle ${useKB ? 'active' : ''}`} onClick={() => setUseKB(!useKB)}>
                <div className="toggle-thumb" />
              </div>
            </label>
            <div className="kb-help-list">
              <div>• Append path: <code>/api/kb/append</code> → <code>data/kb/notes.txt</code></div>
              <div>• Rebuild path: run <code>npm run kb:build</code> manually</div>
              <div>• Retrieval: Use KB ON uses hybrid when vectors are valid; lexical fallback is automatic otherwise</div>
              <div>• {kbPanelFlowHint}</div>
            </div>

            {/* Debug toggle (innovation) */}
            <label className="toggle-row" style={{ marginTop: 12 }}>
              <span>Debug (console)</span>
              <div className={`toggle ${debug ? 'active' : ''}`} onClick={() => setDebug(!debug)}>
                <div className="toggle-thumb" />
              </div>
            </label>
          </div>
        </div>

        <div className="sidebar-section" style={{ marginBottom: 12 }}>
          <h3 className="section-title">SYSTEM PROMPT</h3>

          <div className="preset-card">
            <label className="preset-label">Operator preset</label>
            <div className="preset-list">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`preset-option ${preset.id === (activeChat?.presetId || DEFAULT_PRESET_ID) ? 'active' : ''}`}
                  onClick={() => handlePresetChange(preset.id)}
                >
                  <span className="preset-name">{preset.name}</span>
                  <span className="preset-subtitle">{preset.description}</span>
                </button>
              ))}
            </div>
            <p className="preset-description">{activePreset.description}</p>
            <p className="preset-hint">Use a preset plus workflow tools to draft plans, next steps, and checklists quickly.</p>
          </div>

          <textarea
            className="prompt-textarea"
            style={{ minHeight: 128 }}
            value={activeChat?.systemPrompt || ''}
            onChange={(e) => {
              const val = e.target.value
              setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, systemPrompt: val } : c))
            }}
            placeholder="Set system prompt / operator style..."
            rows={5}
          />

          <div className="prompt-actions">
            <button className="btn-secondary" onClick={saveSystemPrompt}>
              Save
            </button>
            <button className="btn-secondary" onClick={resetSystemPrompt}>
              Reset
            </button>
          </div>

          {promptSavedToast && <div className="prompt-saved">{promptSavedToast}</div>}
        </div>

        <div className="sidebar-section" style={{ marginBottom: 12 }}>
          <h3 className="section-title">MEMORY</h3>
          <textarea
            className="memory-textarea"
            value={activeChat?.notes || ''}
            onChange={(e) => {
              const val = e.target.value
              setChats(prev => prev.map(c => (c.id === activeChatId ? { ...c, notes: val } : c)))
            }}
            placeholder="Notes for this chat (local memory)..."
            rows={6}
          />
          <div className="memory-hint">Saved locally for this chat.</div>
          <div className="memory-actions">
            <button className="btn-secondary" onClick={saveNotesToKb}>
              Save to Memory
            </button>
            <button className="btn-secondary" onClick={saveLastAnswerToMemory}>
              Save Last Answer
            </button>
            <button
              className="btn-secondary"
              onClick={() => fillWorkflowInput(makeMemoryFromChatPrompt(messages))}
            >
              Generate from chat
            </button>
            <button className="btn-secondary" onClick={exportNotesMarkdown}>
              Export notes (.md)
            </button>
            <button className="btn-secondary" onClick={copyNotes}>
              Copy notes
            </button>
            {rebuildHelperChatId === activeChatId && (
              <button className="btn-secondary" onClick={copyRebuildCommand}>
                Copy rebuild command
              </button>
            )}
          </div>
        </div>

        <div className="sidebar-section">
          <h3 className="section-title">PROVIDER</h3>
          <div className="model-select-card" style={{ marginBottom: 10 }}>
            <label className="model-select-label">Remote OpenAI</label>
            <div className="model-select-hint">Disabled — not implemented.</div>
          </div>
          <div className="provider-card">
            {visibleProviders.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`provider-option ${providerId === p.id ? 'active' : ''}`}
                onClick={() => setProviderId(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="model-select-card" style={{ marginTop: 10 }}>
            <label className="model-select-label" htmlFor="fallback-primary-select">Fallback primary</label>
            <select
              id="fallback-primary-select"
              className="model-select"
              value={providerFallbackOrder[0]}
              onChange={(e) => setFallbackPrimary(e.target.value)}
            >
              {LOCAL_PROVIDER_IDS.map((id) => {
                const p = PROVIDERS.find((x) => x.id === id)
                const label = p ? p.label : id
                return <option key={id} value={id}>{label}</option>
              })}
            </select>
            <label className="model-select-label" htmlFor="fallback-secondary-select" style={{ marginTop: 8 }}>Fallback secondary</label>
            <select
              id="fallback-secondary-select"
              className="model-select"
              value={providerFallbackOrder[1]}
              onChange={(e) => setFallbackSecondary(e.target.value)}
            >
              {LOCAL_PROVIDER_IDS.map((id) => {
                const p = PROVIDERS.find((x) => x.id === id)
                const label = p ? p.label : id
                return <option key={id} value={id}>{label}</option>
              })}
            </select>
            <div className="model-select-hint">Local hint only. Suggests fallback when current provider is unreachable.</div>
            {isProviderUnreachable && suggestedFallbackProvider && (
              <div className="model-select-hint" style={{ marginTop: 8 }}>
                Suggested fallback: {suggestedFallbackLabel}
                <button
                  className="btn-ghost"
                  style={{ marginLeft: 8 }}
                  onClick={() => setProviderId(suggestedFallbackProvider)}
                >
                  Switch
                </button>
              </div>
            )}
          </div>
          <div className="model-select-card">
            <label className="model-select-label" htmlFor="model-select">MODEL</label>
            <select
              id="model-select"
              className="model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={modelsLoading}
            >
              {(availableModels.length ? availableModels : [currentModelLabel]).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <div className="model-select-hint">Auto-saved (local)</div>
            {modelsError && <div className="model-select-error">{modelsError}</div>}
          </div>
        </div>

        <div className="sidebar-section">
          <h3 className="section-title">MODEL STATS</h3>
          <div className="model-stats">
            <div className="model-row">
              <span>Model</span>
              <strong>{currentModelLabel}</strong>
            </div>
            <div className="model-row">
              <span>Provider</span>
              <strong>{lastProviderName || providerId}</strong>
            </div>
            <div className="model-row">
              <span>Latency</span>
              <strong>{Number.isFinite(lastLatencyMs) ? `${lastLatencyMs}ms` : '—'}</strong>
            </div>
            <div className="model-row">
              <span>Prompt tokens</span>
              <strong>{lastStats.tokensIn} {lastUsageMode === 'approx' ? '(approx)' : ''}</strong>
            </div>
            <div className="model-row">
              <span>Completion tokens</span>
              <strong>{lastStats.tokensOut} {lastUsageMode === 'approx' ? '(approx)' : ''}</strong>
            </div>
            <div className="model-row">
              <span>KB enabled</span>
              <strong>{lastKbEnabled ? 'ON' : 'OFF'}</strong>
            </div>
            <div className="model-row">
              <span>KB hits (last response)</span>
              <strong>{lastKBHits}</strong>
            </div>
            <div className="model-row">
              <span>KB influenced</span>
              <strong>{kbInfluenceLabel}</strong>
            </div>
            <div className="model-row">
              <span>KB mode (last response)</span>
              <strong>{kbModeLabel}</strong>
            </div>
            <div className="model-row">
              <span>KB source refs</span>
              <strong>{lastKBSourceCount}</strong>
            </div>
            <div className="model-row">
              <span>Ops requests</span>
              <strong>{opsMetrics.requestsTotal} ({opsMetrics.requestsOk}/{opsMetrics.requestsFail})</strong>
            </div>
            <div className="model-row">
              <span>Ops avg latency</span>
              <strong>{Number.isFinite(opsMetrics.avgLatency) ? `${opsMetrics.avgLatency}ms` : '—'}</strong>
            </div>
            <div className="model-row">
              <span>Ops providers</span>
              <strong>{opsProviderMix}</strong>
            </div>
            <div className="model-row">
              <span>Provider stability</span>
              <strong>{providerStability.status} - {providerStability.detail}</strong>
            </div>
            <div className="model-row">
              <span>Stability trend</span>
              <strong>{stabilityTrend.status} - {stabilityTrend.label}</strong>
            </div>
            <div className="model-row">
              <span>Signal confidence</span>
              <strong style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {signalConfidenceBadges.map((badge) => {
                  const color = badge.level === 'HIGH' ? '#22c55e' : badge.level === 'MED' ? '#f59e0b' : '#ef4444'
                  return (
                    <span
                      key={badge.key}
                      style={{
                        border: `1px solid ${color}`,
                        borderRadius: 999,
                        padding: '1px 6px',
                        fontSize: 10,
                        lineHeight: 1.4
                      }}
                    >
                      {badge.label}:{badge.level}
                    </span>
                  )
                })}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Trust</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {signalTrustBadge}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Freshness</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {signalFreshnessIndicator}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Readiness</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {readinessSignalRollup}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Handshake</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {reliabilityHandshakeSummary}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Recency alignment</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {recencyAlignmentHintText}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Volatility</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {warningVolatilityPosture}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Contract drift</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {contractDriftSummary.status} ({contractDriftSummary.passCount}/{contractDriftChecks.length})
              </strong>
            </div>
            <div className="model-row">
              <span>Details</span>
              <strong>
                <button className="btn-ghost" onClick={() => setShowDetailsStats((prev) => !prev)}>
                  {showDetailsStats ? 'Hide details' : `Show details (${modelStatsDetailCount})`}
                </button>
              </strong>
            </div>
            {showDetailsStats && (
              <>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Session:</span>
              <strong style={{ textAlign: 'right', fontSize: 10, letterSpacing: 0.2 }}>run preflight when stale/warn</strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Signal snapshot</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {signalSnapshotStrip}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Consistency strip</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {consistencyStatusStrip}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Handshake continuity</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {handshakeContinuitySignal}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Recheck outcome</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {recheckOutcomeMarkerText}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Drift direction</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {driftDirectionQualifier}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Recovery:</span>
              <strong style={{ textAlign: 'right', fontSize: 10, letterSpacing: 0.2 }}>soft recover if warnings persist</strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Confidence rollup</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {followThroughConfidenceRollup}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Recheck stability</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {recheckConfidenceStabilityMarkerText}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Divergence tag</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {consistencyDivergenceTag}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Coherence rollup</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {calibrationCoherenceRollup}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Recheck alignment</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {recheckAlignmentMarkerText}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Coherence trend</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {coherenceTrendTag}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Assurance rollup</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {coherenceAssuranceRollup}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Posture confidence</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {recheckPostureConfidenceMarkerText}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Assurance drift</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {assuranceDriftTrendTag}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Convergence rollup</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {assuranceConvergenceRollup}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Convergence trend</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {convergenceDriftTrendTag}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Session timeline</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {sessionPostureTimelineText}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Recovery pair</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {recoveryPosturePair}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Recovery confidence</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {recoveryConfidenceHintText}
                {recoveryConfidenceHintText !== '—' ? ` (${recoveryConfidenceRecencyText})` : ''}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Alignment confidence</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {alignmentConfidenceMarkerText}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Noise:</span>
              <strong style={{ textAlign: 'right', fontSize: 10, letterSpacing: 0.2 }}>monitor pressure before changes</strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Volatility pressure</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {volatilityPressureTag}
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Pressure drift</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {driftPressureComparator}
              </strong>
            </div>
            <div className="model-row">
              <span>Ops window</span>
              <strong>
                {OPS_WINDOW_SIZE} req
                <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={resetOpsSnapshot}>
                  Reset Ops
                </button>
              </strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Diagnostics:</span>
              <strong style={{ textAlign: 'right', fontSize: 10, letterSpacing: 0.2 }}>check drift/compatibility first</strong>
            </div>
            <div className="model-row" style={{ alignItems: 'flex-start' }}>
              <span>Contract drift</span>
              <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                {contractDriftSummary.status} ({contractDriftSummary.passCount}/{contractDriftChecks.length})
                {contractDriftChecks.map((c, idx) => (
                  <div key={`${c.key}-${idx}`}>
                    {c.pass ? 'PASS' : 'WARN'} - {c.detail}
                  </div>
                ))}
              </strong>
            </div>
            {visibleCitations.length > 0 && (
              <div className="model-row" style={{ alignItems: 'flex-start' }}>
                <span>Sources</span>
                <strong style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.4 }}>
                  {visibleCitations.map((c, idx) => {
                    const chunkIndex = Number.isFinite(c?.chunkIndex) ? `#${c.chunkIndex}` : ''
                    return (
                      <div key={`${c.source}-${c.chunkIndex ?? idx}`}>
                        {c.source}{chunkIndex ? ` (${chunkIndex})` : ''}
                      </div>
                    )
                  })}
                </strong>
              </div>
            )}
              </>
            )}
          </div>
        </div>

        <div className="sidebar-section">
          <input
            type="text"
            placeholder="Search messages..."
            className="search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <h3 className="section-title">OPERATOR TOOLS</h3>
          <div className="model-select-card" style={{ marginBottom: 10 }}>
            <label className="model-select-label" htmlFor="preflight-run-btn">Operator preflight</label>
            <button id="preflight-run-btn" className="btn-secondary" onClick={runPreflightChecklist}>
              Run preflight
            </button>
            <div className="model-select-hint" style={{ marginTop: 8 }}>
              Last run summary: {preflightChecks
                ? `${formatTime(preflightChecks.ranAt)} - pass ${preflightChecks.passCount}, warn ${preflightChecks.warnCount}`
                : 'not run yet'}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Freshness: {signalFreshnessIndicator}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Readiness: {readinessSignalRollup}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Handshake: {reliabilityHandshakeSummary}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Trust: {signalTrustBadge}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Signal confidence:
              <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', marginLeft: 6, verticalAlign: 'middle' }}>
                {signalConfidenceBadges.map((badge) => {
                  const color = badge.level === 'HIGH' ? '#22c55e' : badge.level === 'MED' ? '#f59e0b' : '#ef4444'
                  return (
                    <span
                      key={`preflight-${badge.key}`}
                      style={{
                        border: `1px solid ${color}`,
                        borderRadius: 999,
                        padding: '1px 6px',
                        fontSize: 10,
                        lineHeight: 1.4
                      }}
                    >
                      {badge.label}:{badge.level}
                    </span>
                  )
                })}
              </span>
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Volatility: {warningVolatilityPosture}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Recency alignment: {recencyAlignmentHintText}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Contract drift: {contractDriftSummary.status} ({contractDriftSummary.passCount}/{contractDriftChecks.length})
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Next action ({preflightCoreActionConfidenceTier}): {preflightCoreActionCue}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Reason: {preflightCoreActionConfidenceReason}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              <button className="btn-ghost" onClick={() => setShowDetailsPreflight((prev) => !prev)}>
                {showDetailsPreflight ? 'Hide details' : `Show details (${preflightDetailCount})`}
              </button>
            </div>
            {showDetailsPreflight && (
              <>
            <div className="model-select-hint" style={{ marginTop: 8, fontSize: 10, letterSpacing: 0.4 }}>
              Session: run preflight when stale/warn
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Snapshot: {signalSnapshotStrip}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Consistency: {consistencyStatusStrip}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Continuity: {handshakeContinuitySignal}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Recheck outcome: {recheckOutcomeMarkerText}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Drift direction: {driftDirectionQualifier}
            </div>
            {Array.isArray(preflightChecks?.checks) && preflightChecks.checks.length > 0 && (
              <div className="model-select-hint" style={{ marginTop: 4 }}>
                Last run details:
                {preflightChecks.checks.map((c, idx) => (
                  <div key={`${c.label}-${idx}`} style={{ marginTop: 4 }}>
                    {c.pass ? 'PASS' : 'WARN'} - {c.label}: {c.detail}
                  </div>
                ))}
              </div>
            )}
            {shouldShowMaintenanceReminder && (
              <div className="model-select-hint" style={{ marginTop: 8 }}>
                Reminder: {maintenanceReminder.text}
                {maintenanceReminder.actionLabel === 'Run preflight' && (
                  <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={runPreflightChecklist}>
                    Run preflight
                  </button>
                )}
                <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={dismissMaintenanceReminder}>
                  Dismiss
                </button>
              </div>
            )}
            <div style={{ marginTop: 6 }}>
              <button className="btn-ghost" onClick={clearSessionWarnings}>Clear warnings</button>
              <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={softRecoverSession}>Soft recover</button>
            </div>
            <div className="model-select-hint" style={{ marginTop: 8, fontSize: 10, letterSpacing: 0.4 }}>
              Recovery: soft recover if warnings persist
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Confidence rollup: {followThroughConfidenceRollup}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Recheck stability: {recheckConfidenceStabilityMarkerText}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Divergence tag: {consistencyDivergenceTag}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Coherence rollup: {calibrationCoherenceRollup}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Recheck alignment: {recheckAlignmentMarkerText}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Coherence trend: {coherenceTrendTag}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Assurance rollup: {coherenceAssuranceRollup}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Posture confidence: {recheckPostureConfidenceMarkerText}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Assurance drift: {assuranceDriftTrendTag}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Convergence rollup: {assuranceConvergenceRollup}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Convergence trend: {convergenceDriftTrendTag}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Timeline: {sessionPostureTimelineText}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Recovery pair: {recoveryPosturePair}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Recovery confidence: {recoveryConfidenceHintText}
              {recoveryConfidenceHintText !== '—' ? ` (${recoveryConfidenceRecencyText})` : ''}
            </div>
            {guidedRecoverySuggestion && (
              <div className="model-select-hint" style={{ marginTop: 8 }}>
                Guided recovery: {guidedRecoverySuggestion.text}
                <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={runGuidedRecoveryPrimary}>
                  {guidedRecoverySuggestion.primaryLabel}
                </button>
                <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={runGuidedRecoverySecondary}>
                  {guidedRecoverySuggestion.secondaryLabel}
                </button>
              </div>
            )}
            {recoveryFeedback && (
              <div className="model-select-hint" style={{ marginTop: 6 }}>
                Recovery feedback ({recoveryFeedback.actionLabel}): {recoveryFeedback.result === 'checking'
                  ? 'checking...'
                  : `${recoveryFeedback.result.toUpperCase()} - C:${recoveryFeedback.before?.contract || '-'}->${recoveryFeedback.after?.contract || '-'}, P:${recoveryFeedback.before?.provider || '-'}->${recoveryFeedback.after?.provider || '-'}, T:${recoveryFeedback.before?.trend || '-'}->${recoveryFeedback.after?.trend || '-'}`}
              </div>
            )}
            <div className="model-select-hint" style={{ marginTop: 8, fontSize: 10, letterSpacing: 0.4 }}>
              Noise: monitor pressure before changes
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Volatility pressure: {volatilityPressureTag}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Pressure drift: {driftPressureComparator}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Warning noise: {warningNoiseClassifier.level.toUpperCase()} - {warningNoiseClassifier.text}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Warning noise trend: {warningNoiseTrend.label.toUpperCase()} - {warningNoiseTrend.text}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Warning qualifier: {warningStabilityQualifier.kind.toUpperCase()} - {warningStabilityQualifier.text}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Warning marker: {warningStateMarker.kind.toUpperCase()} - {warningStateMarker.text}
            </div>
            <div className="model-select-hint" style={{ marginTop: 8, fontSize: 10, letterSpacing: 0.4 }}>
              Diagnostics: check drift/compatibility first
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Alignment confidence: {alignmentConfidenceMarkerText}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Contract drift details:
              {contractDriftChecks.map((c, idx) => (
                <div key={`${c.key}-${idx}`} style={{ marginTop: 4 }}>
                  {c.pass ? 'PASS' : 'WARN'} - {c.detail}
                </div>
              ))}
            </div>
            {compatibilityHints.length > 0 && (
              <div className="model-select-hint" style={{ marginTop: 8 }}>
                Compatibility hints:
                {compatibilityHints.map((hint) => (
                  <div key={hint.id} style={{ marginTop: 4 }}>
                    WARN - {hint.text}
                    <button
                      className="btn-ghost"
                      style={{ marginLeft: 8 }}
                      onClick={() => applyCompatibilityHint(hint.id)}
                    >
                      {hint.actionLabel}
                    </button>
                  </div>
                ))}
              </div>
            )}
              </>
            )}
          </div>
          <div className="model-select-card" style={{ marginBottom: 10 }}>
            <label className="model-select-label" htmlFor="plan-mode-select">Workflow mode</label>
            <select
              id="plan-mode-select"
              className="model-select"
              value={planMode}
              onChange={(e) => setPlanMode(e.target.value)}
            >
              {PLAN_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>{mode.label}</option>
              ))}
            </select>
            <div className="model-select-hint">
              {planEntitlementHint}
            </div>
            <div className="model-select-hint" style={{ marginTop: 4 }}>
              Informational only: workflow mode is a local UX helper, not backend entitlement logic.
            </div>
          </div>
          <div className="model-select-card" style={{ marginBottom: 10 }}>
            <label className="model-select-label" htmlFor="insert-preset-select">Preset</label>
            <select
              id="insert-preset-select"
              className="model-select"
              value={insertPresetId}
              onChange={(e) => setInsertPresetId(e.target.value)}
            >
              {PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
            </select>
            <button className="btn-secondary" onClick={insertPresetToComposer}>
              Insert workflow preset
            </button>
          </div>
          <div className="workflow-playbook">
            Recommended dev/project flow: <strong>Feature plan</strong> or <strong>Bug breakdown</strong> → <strong>Pick next step</strong> → <strong>Extract checklist</strong> → <strong>Create Cursor prompt</strong>.
          </div>
          <div className="workflow-buttons">
            <button
              className="btn-secondary btn-workflow"
              onClick={() => fillWorkflowInput(makeFeaturePlanPrompt(activePreset, lastUserText, messages))}
            >
              Feature plan
            </button>
            <button
              className="btn-secondary btn-workflow"
              onClick={() => fillWorkflowInput(makeBugBreakdownPrompt(activePreset, lastUserText, messages))}
            >
              Bug breakdown
            </button>
            <button
              className="btn-secondary btn-workflow"
              onClick={() => fillWorkflowInput(makePlanPrompt(activePreset, lastUserText, messages))}
            >
              Plan task
            </button>
            <button
              className="btn-secondary btn-workflow"
              onClick={() => fillWorkflowInput(makeNextStepPrompt(activePreset, lastUserText, messages))}
            >
              Pick next step
            </button>
            <button
              className="btn-secondary btn-workflow"
              onClick={() => fillWorkflowInput(makeSummarizePrompt(activePreset, messages))}
            >
              Summarize work
            </button>
            <button
              className="btn-secondary btn-workflow"
              onClick={() => fillWorkflowInput(makeExtractTasksPrompt(activePreset, messages))}
              disabled={!isProMode}
              title={!isProMode ? planGateTooltip : 'Extract tasks'}
            >
              Extract checklist
            </button>
            <button
              className="btn-secondary btn-workflow"
              onClick={() => fillWorkflowInput(makeCursorPrompt(activePreset, messages))}
              disabled={!isProMode}
              title={!isProMode ? planGateTooltip : 'Cursor prompt'}
            >
              Create Cursor prompt
            </button>
          </div>
          <div className="workflow-hint">Buttons draft developer/project operator prompts in the composer. Review/edit, then send (no auto-run).</div>
          <div className="action-buttons">
            <button className="btn-secondary btn-full" onClick={toggleStatus}>
              Insert status snapshot (demo)
            </button>
            <button className="btn-secondary btn-full" onClick={clearChat}>
              Clear Chat
            </button>
            <button
              className="btn-secondary btn-full"
              onClick={() => { setInputValue(lastUserText); }}
              disabled={!lastUserText || isLoading}
            >
              Retry last prompt
            </button>
            <button className="btn-secondary btn-full" onClick={exportActiveChatMarkdown}>
              Export Chat (.md)
            </button>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="endpoint-info">
            <div className="endpoint-dot" />
            <span>localhost:3001</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main">
        {/* Top Header */}
        <header className="header">
          <div className="header-left">
            <h1 className="header-title">REZ-AI Local Operator</h1>
            <p className="header-subtitle">Practical task execution • KB-assisted context • local/private workflow</p>
          </div>

          <div className="header-right">
            <div className={`status-pill ${healthUi.kind}`} title={backendUrl}>
              <span className="status-dot" />
              {healthUi.text}
            </div>
            <button className="btn-ghost" disabled>Settings (disabled)</button>
            <button className="btn-ghost" disabled>Export (disabled)</button>
          </div>
        </header>

        <div className="stats-bar">
          <span>Provider: {lastProviderName || providerId}</span>
          <span>Model: {currentModelLabel}</span>
          <span>≈ Tokens in: {lastStats.tokensIn}</span>
          <span>≈ Tokens out: {lastStats.tokensOut}</span>
          <span>⏱ {Number.isFinite(lastLatencyMs) ? `${lastLatencyMs}ms` : '—'}</span>
          <span>{isLoading ? '⏳ Pending…' : '✅ Idle'}</span>
        </div>

        {/* Chat Area */}
        <div className="chat-container">
          <div className="messages">
            {messages
              .filter(m => m.content.toLowerCase().includes(search.toLowerCase()))
              .map((msg) => (
              <div key={msg.id} className={`message-wrapper ${msg.role} ${msg.isError ? 'error' : ''}`}>
                <div className="message-bubble">
                  <div className="message-header">
                    <span className="sender-label">{msg.role === 'user' ? 'You' : 'REZ-AI'}</span>
                    <span className="timestamp">{formatTime(msg.timestamp)}</span>
                  </div>

                  <div className="message-content">
                    <div className="md">
                      {renderMarkdownLite({
                        text: msg.content,
                        messageId: msg.id,
                        onCopyCode: copyCodeBlock,
                        copiedCodeKey
                      })}
                    </div>
                  </div>

                  {msg.role === 'assistant' && (
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                      {msg.retryText && (
                        <button className="btn-secondary" onClick={() => retrySend(msg.retryText)}>
                          Retry
                        </button>
                      )}
                      <button
                        className="copy-btn"
                        onClick={() => copyToClipboard(msg.id, msg.content)}
                        title="Copy to clipboard"
                        style={{ position: 'static', opacity: 1 }}
                      >
                        {copiedId === msg.id ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="message-wrapper assistant loading">
                <div className="message-bubble">
                  <div className="message-header">
                    <span className="sender-label">REZ-AI</span>
                    <span className="timestamp">{formatTime(new Date())}</span>
                  </div>
                  <div className="loading-content">
                    <span>Thinking</span>
                    <ThinkingDots />
                  </div>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="composer" style={{ paddingTop: 10 }}>
          <div className="composer-inner">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Describe task, goal, and constraints... (Enter to send, Shift+Enter for newline, Ctrl+Enter also sends)"
              rows={1}
              disabled={isLoading}
              maxLength={MAX_MESSAGE_CHARS}
            />
            <button
              className={`send-btn ${canSend ? 'active' : ''}`}
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div className="composer-hint" style={composerHintStyle}>
            {chunkProgress
              ? `Sending part ${chunkProgress.current}/${chunkProgress.total}...`
              : `Best signal: goal + context + constraints • Enter sends • Shift+Enter newline • Esc closes toast • ${inputValue.length}/${MAX_MESSAGE_CHARS} chars`}
          </div>
          {!chunkProgress && (
            <div className="composer-hint" style={composerHintStyle}>
              {shouldShowAdvancedComposerTools
                ? `Operator signal (${String(activePreset?.name || 'General Operator')}): ${promptQualityCue}`
                : `Operator signal (${String(activePreset?.name || 'General Operator')}): ${promptQualityCue} • Context hint: ${composerContextHint} • Context snapshot: ${composerContextSnapshot} • Summary: ${conversationSummary
                  ? (summaryExpanded ? conversationSummary : conversationSummaryPreview)
                  : '—'}`}
              {canShowAdvancedComposerToggle && (
                <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={() => setShowAdvancedComposerTools((prev) => !prev)}>
                  {shouldShowAdvancedComposerTools ? 'Hide tools' : 'Show tools'}
                </button>
              )}
              {conversationSummary && !shouldShowAdvancedComposerTools && (
                <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={() => setSummaryExpanded((prev) => !prev)}>
                  {summaryExpanded ? 'Hide' : 'Show'}
                </button>
              )}
              {shouldShowAdvancedComposerTools && (
                <>
                  <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={insertPromptScaffold}>
                    Insert operator scaffold
                  </button>
                  <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={insertWorkflowRequestHelper}>
                    Draft workflow request
                  </button>
                  <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={insertAnalysisRequestHelper}>
                    Draft analysis request
                  </button>
                  {hasScaffoldHeaderInInput && (
                    <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={clearPromptScaffold}>
                      Clear scaffold block
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {!chunkProgress && shouldShowAdvancedComposerTools && (
            <div className="composer-hint" style={composerHintStyle}>
              Context hint: {composerContextHint}
              {composerContextHintMode === 'FOLLOW-UP' && (
                <>
                  <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={insertContextRefLine}>
                    Add ref line
                  </button>
                  <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={insertContextPack}>
                    Add context pack
                  </button>
                </>
              )}
            </div>
          )}
          {!chunkProgress && shouldShowAdvancedComposerTools && (
            <div className="composer-hint" style={composerHintStyle}>
              Context snapshot: {composerContextSnapshot}
            </div>
          )}
          {!chunkProgress && shouldShowAdvancedComposerTools && (
            <div className="composer-hint" style={composerHintStyle}>
              Summary: {conversationSummary ? (summaryExpanded ? conversationSummary : conversationSummaryPreview) : '—'}
              {conversationSummary && (
                <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={() => setSummaryExpanded((prev) => !prev)}>
                  {summaryExpanded ? 'Hide' : 'Show'}
                </button>
              )}
            </div>
          )}
          {!chunkProgress && shouldShowAdvancedComposerTools && isDeveloperPreset && (
            <div className="composer-hint" style={composerHintStyle}>
              Context used:
              <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={() => setShowContextDebugPreview((prev) => !prev)}>
                {showContextDebugPreview ? 'Hide context' : 'Show context'}
              </button>
              {showContextDebugPreview && (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    lineHeight: 1.35,
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
                  }}
                >
                  {contextDebugPreviewText}
                </div>
              )}
            </div>
          )}
          {showSoftWarning && !chunkProgress && (
            <div className="composer-hint" style={{ ...composerHintStyle, color: '#f59e0b' }}>
              Large message, response may be slower.
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default App