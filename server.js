const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();
const { loadBackendConfig } = require("./configs/backend-config");

const app = express();
let config;
try {
  config = loadBackendConfig(process.env);
} catch (err) {
  console.error(`[config] Invalid backend configuration: ${err.message}`);
  process.exit(1);
}
const {
  REQUEST_BODY_LIMIT,
  MAX_MESSAGE_CHARS,
  PORT,
  CORS_ALLOWLIST,
  LMSTUDIO_BASE_URL,
  OLLAMA_BASE_URL,
  FEATURE_FLAGS,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} = config;
const USAGE_LOG_FILE = path.join(process.cwd(), "data", "cache", "usage.jsonl");
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const appendUsageEvent = (event) => {
  try {
    fs.mkdirSync(path.dirname(USAGE_LOG_FILE), { recursive: true });
    fs.appendFileSync(USAGE_LOG_FILE, `${JSON.stringify(event)}\n`, { encoding: "utf8" });
  } catch (err) {
    console.error("[usage] failed to append usage event:", err?.message || err);
  }
};

const getBearerToken = (authorizationHeader) => {
  const auth = String(authorizationHeader || "").trim();
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m || !m[1]) return "__INVALID_BEARER__";
  return m[1];
};

const resolveAuthUserContext = async (authorizationHeader) => {
  const token = getBearerToken(authorizationHeader);
  if (!token) return { userId: null, userEmail: null, authErrorCode: null, authMessage: null };
  if (token === "__INVALID_BEARER__") {
    return { userId: null, userEmail: null, authErrorCode: "AUTH_INVALID", authMessage: "Invalid Authorization header." };
  }
  if (!supabase) {
    return { userId: null, userEmail: null, authErrorCode: "AUTH_INVALID", authMessage: "Auth is not configured." };
  }
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) {
      return { userId: null, userEmail: null, authErrorCode: "AUTH_INVALID", authMessage: error?.message || "Invalid token." };
    }
    return { userId: data.user.id, userEmail: data.user.email || null, authErrorCode: null, authMessage: null };
  } catch (err) {
    return { userId: null, userEmail: null, authErrorCode: "AUTH_INVALID", authMessage: err?.message || "Invalid token." };
  }
};

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || CORS_ALLOWLIST.length === 0 || CORS_ALLOWLIST.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS_ORIGIN_DENIED"));
    },
  })
);
app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
let activeAssistantProcess = null;
const rateLimitByIp = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const normalizePlanMode = (value) => (String(value || "").trim().toLowerCase() === "pro" ? "pro" : "free");
const SAFE_KB_MODES = new Set(["lexical", "semantic", "hybrid"]);
const SAFE_KB_DECISION_HINTS = new Set([
  "kb_disabled",
  "empty_prompt",
  "project_signal",
  "generic_prompt",
  "low_signal_short_prompt",
  "non_project_prompt",
  "unavailable",
]);
const MAX_PUBLIC_KB_CITATIONS = 4;
const normalizeKbMode = (modeLike) => {
  const mode = String(modeLike || "").trim().toLowerCase();
  return SAFE_KB_MODES.has(mode) ? mode : "lexical";
};
const normalizeNonNegativeInt = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
};
const normalizeKbDecisionHint = (hintLike, kbEnabled) => {
  const hint = String(hintLike || "").trim().toLowerCase();
  if (SAFE_KB_DECISION_HINTS.has(hint)) return hint;
  return kbEnabled ? "unavailable" : "kb_disabled";
};
const sanitizeKbCitation = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const source = String(raw.source || "").trim();
  if (!source) return null;
  const out = { source };
  const id = String(raw.id || "").trim();
  if (id) out.id = id;
  const chunkIndex = Number(raw.chunkIndex);
  if (Number.isFinite(chunkIndex) && chunkIndex >= 0) out.chunkIndex = Math.floor(chunkIndex);
  return out;
};
const sanitizeKbCitations = (list, limit = MAX_PUBLIC_KB_CITATIONS) => {
  if (!Array.isArray(list) || limit <= 0) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const safe = sanitizeKbCitation(item);
    if (!safe) continue;
    const key = `${safe.source}::${safe.chunkIndex ?? "na"}::${safe.id ?? "na"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(safe);
    if (out.length >= limit) break;
  }
  return out;
};
const DEFAULT_RUNTIME_SCOPE = Object.freeze({
  mode: "local",
  workspaceId: null,
  projectId: null,
  source: "default_local",
});
const DEFAULT_RUNTIME_TASK = Object.freeze({
  kind: "chat_execution",
  state: "created",
});
const RUNTIME_TASK_STATES = Object.freeze({
  CREATED: "created",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
});
const RUNTIME_TASK_TRANSITIONS = Object.freeze({
  [RUNTIME_TASK_STATES.CREATED]: Object.freeze(new Set([RUNTIME_TASK_STATES.RUNNING, RUNTIME_TASK_STATES.FAILED])),
  [RUNTIME_TASK_STATES.RUNNING]: Object.freeze(new Set([RUNTIME_TASK_STATES.SUCCEEDED, RUNTIME_TASK_STATES.FAILED])),
  [RUNTIME_TASK_STATES.SUCCEEDED]: Object.freeze(new Set()),
  [RUNTIME_TASK_STATES.FAILED]: Object.freeze(new Set()),
});
const SINGLE_STEP_EXECUTION_POLICY = Object.freeze({
  mode: "single_step",
  maxSteps: 1,
  allowChainedExecution: false,
  stepType: "provider_chat_single_step",
});
const DEFAULT_RUNTIME_CONTINUATION_GATE = Object.freeze({
  allowContinuation: false,
  maxSteps: 1,
  reason: "default_deny",
  source: "phase55_default_safe",
});
const GUARDED_RUNTIME_LOOP_POLICY = Object.freeze({
  mode: "guarded_loop",
  hardMaxSteps: 2,
  defaultMaxSteps: 2,
});

const makeInternalTaskId = () => {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const resolveRuntimeScope = (req) => {
  void req;
  // First-slice runtime scope is internal-only and always local-safe.
  return {
    mode: DEFAULT_RUNTIME_SCOPE.mode,
    workspaceId: DEFAULT_RUNTIME_SCOPE.workspaceId,
    projectId: DEFAULT_RUNTIME_SCOPE.projectId,
    source: DEFAULT_RUNTIME_SCOPE.source,
  };
};

const createInternalRuntimeTask = ({ scopeMode, kind } = {}) => ({
  taskId: makeInternalTaskId(),
  kind: typeof kind === "string" && kind.trim() ? kind.trim() : DEFAULT_RUNTIME_TASK.kind,
  state: DEFAULT_RUNTIME_TASK.state,
  scopeMode: typeof scopeMode === "string" && scopeMode.trim() ? scopeMode.trim().toLowerCase() : DEFAULT_RUNTIME_SCOPE.mode,
  createdAt: new Date().toISOString(),
});

const normalizeRuntimeTaskState = (stateLike) => {
  const state = String(stateLike || "").trim().toLowerCase();
  if (state === RUNTIME_TASK_STATES.RUNNING) return RUNTIME_TASK_STATES.RUNNING;
  if (state === RUNTIME_TASK_STATES.SUCCEEDED) return RUNTIME_TASK_STATES.SUCCEEDED;
  if (state === RUNTIME_TASK_STATES.FAILED) return RUNTIME_TASK_STATES.FAILED;
  return RUNTIME_TASK_STATES.CREATED;
};

const resolveGuardedLoopMaxSteps = () => {
  const defaultSteps = GUARDED_RUNTIME_LOOP_POLICY.defaultMaxSteps;
  return Math.min(defaultSteps, GUARDED_RUNTIME_LOOP_POLICY.hardMaxSteps);
};

const transitionRuntimeTaskState = (taskLike, nextStateLike) => {
  if (!taskLike || typeof taskLike !== "object") return RUNTIME_TASK_STATES.CREATED;
  const currentState = normalizeRuntimeTaskState(taskLike.state);
  const nextState = normalizeRuntimeTaskState(nextStateLike);
  if (currentState === nextState) {
    taskLike.state = currentState;
    return currentState;
  }
  const allowed = RUNTIME_TASK_TRANSITIONS[currentState] || RUNTIME_TASK_TRANSITIONS[RUNTIME_TASK_STATES.CREATED];
  if (allowed.has(nextState)) {
    taskLike.state = nextState;
    return nextState;
  }
  taskLike.state = currentState;
  return currentState;
};

const createRuntimeExecutionBoundary = (runtimeTaskLike) => {
  const taskState = normalizeRuntimeTaskState(runtimeTaskLike?.state);
  return {
    mode: SINGLE_STEP_EXECUTION_POLICY.mode,
    maxSteps: SINGLE_STEP_EXECUTION_POLICY.maxSteps,
    stepCount: 1,
    allowChainedExecution: SINGLE_STEP_EXECUTION_POLICY.allowChainedExecution,
    steps: [{ index: 1, type: SINGLE_STEP_EXECUTION_POLICY.stepType, terminal: true }],
    taskState,
  };
};

const isRuntimeExecutionBoundaryValid = (boundaryLike) => {
  const b = boundaryLike || {};
  if (b.mode !== SINGLE_STEP_EXECUTION_POLICY.mode) return false;
  if (!Number.isFinite(b.maxSteps) || b.maxSteps !== 1) return false;
  if (!Number.isFinite(b.stepCount) || b.stepCount !== 1) return false;
  if (b.allowChainedExecution !== false) return false;
  if (!Array.isArray(b.steps) || b.steps.length !== 1) return false;
  const step = b.steps[0];
  if (!step || step.index !== 1 || step.type !== SINGLE_STEP_EXECUTION_POLICY.stepType || step.terminal !== true) return false;
  if (normalizeRuntimeTaskState(b.taskState) !== RUNTIME_TASK_STATES.RUNNING) return false;
  return true;
};

const serializeRuntimeScope = (scopeLike) => {
  try {
    return JSON.stringify(scopeLike || DEFAULT_RUNTIME_SCOPE);
  } catch {
    return JSON.stringify(DEFAULT_RUNTIME_SCOPE);
  }
};

const serializeRuntimeTask = (taskLike) => {
  try {
    return JSON.stringify(taskLike || createInternalRuntimeTask({}));
  } catch {
    return JSON.stringify(createInternalRuntimeTask({}));
  }
};

const resolveInternalContinuationGate = ({ req, runtimeScope, runtimeTask } = {}) => {
  void req;
  const envAllow = String(process.env.REZ_INTERNAL_ALLOW_CONTINUATION || "").trim() === "1";
  const taskState = normalizeRuntimeTaskState(runtimeTask?.state);
  const scopeMode = String(runtimeScope?.mode || "").trim().toLowerCase();
  const preconditionsMet = taskState === RUNTIME_TASK_STATES.RUNNING && scopeMode === "local";
  if (envAllow && preconditionsMet) {
    return {
      allowContinuation: true,
      maxSteps: resolveGuardedLoopMaxSteps(),
      reason: "explicit_internal_allow",
      source: "env_rez_internal_allow_continuation",
    };
  }
  return {
    ...DEFAULT_RUNTIME_CONTINUATION_GATE,
    maxSteps: DEFAULT_RUNTIME_CONTINUATION_GATE.maxSteps,
    reason: envAllow ? "preconditions_not_met" : DEFAULT_RUNTIME_CONTINUATION_GATE.reason,
    source: envAllow
      ? "env_rez_internal_allow_continuation"
      : DEFAULT_RUNTIME_CONTINUATION_GATE.source,
  };
};

const serializeRuntimeContinuationGate = (gateLike) => {
  try {
    return JSON.stringify(gateLike || DEFAULT_RUNTIME_CONTINUATION_GATE);
  } catch {
    return JSON.stringify(DEFAULT_RUNTIME_CONTINUATION_GATE);
  }
};

const makeErrorPayload = (code, message, meta = null) => ({
  ok: false,
  error: { code, message },
  ...(meta ? { meta } : {}),
});

const rateLimitMiddleware = (req, res, next) => {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const current = rateLimitByIp.get(ip) || [];
  const recent = current.filter((ts) => ts > windowStart);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json(makeErrorPayload("RATE_LIMITED", "Too many requests. Try again later."));
  }
  recent.push(now);
  rateLimitByIp.set(ip, recent);

  // Opportunistic cleanup for stale IP buckets.
  if (rateLimitByIp.size > 1000) {
    for (const [key, entries] of rateLimitByIp.entries()) {
      const keep = entries.filter((ts) => ts > windowStart);
      if (!keep.length) rateLimitByIp.delete(key);
      else rateLimitByIp.set(key, keep);
    }
  }
  return next();
};

app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.message === "CORS_ORIGIN_DENIED") {
    return res.status(403).json(makeErrorPayload("CORS_ORIGIN_DENIED", "Origin is not allowed."));
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json(makeErrorPayload("PAYLOAD_TOO_LARGE", "Request payload is too large."));
  }
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json(makeErrorPayload("INVALID_JSON", "Malformed JSON body."));
  }
  return next(err);
});

app.get("/", (req, res) => res.type("text").send("REZ-AI backend OK"));
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/api/features", async (req, res) => {
  const authContext = await resolveAuthUserContext(req.headers.authorization);
  const payload = {
    ok: true,
    flags: FEATURE_FLAGS?.flags || {},
  };
  if (authContext.userId) {
    payload.meta = {
      userId: authContext.userId,
      auth: true,
    };
  }
  return res.json(payload);
});
app.get("/api/auth/me", async (req, res) => {
  const authContext = await resolveAuthUserContext(req.headers.authorization);
  if (!getBearerToken(req.headers.authorization)) {
    return res.json({ ok: true, user: null });
  }
  if (authContext.userId) {
    return res.json({
      ok: true,
      user: {
        id: authContext.userId,
        email: authContext.userEmail,
      },
    });
  }
  return res.status(401).json(makeErrorPayload("AUTH_INVALID", authContext.authMessage || "Invalid token."));
});
const HEALTH_TIMEOUT_MS = 2000;

const fetchJsonWithTimeout = async (url, timeoutMs = HEALTH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, detail: "bad_response", status: response.status, data: null };
    }
    if (!response.ok) {
      return { ok: false, detail: "fetch_failed", status: response.status, data };
    }
    return { ok: true, detail: null, status: response.status, data };
  } catch (e) {
    return {
      ok: false,
      detail: e?.name === "AbortError" ? "timeout" : "fetch_failed",
      status: null,
      data: null,
    };
  } finally {
    clearTimeout(timer);
  }
};

const checkLmStudioHealth = async () => {
  const rawBase = LMSTUDIO_BASE_URL;
  const base = rawBase.replace(/\/$/, "");
  const modelsUrl = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
  const result = await fetchJsonWithTimeout(modelsUrl);
  const list = result.ok && Array.isArray(result.data?.data) ? result.data.data : [];
  const models = list.map((m) => m?.id || m?.model).filter(Boolean);
  return {
    ok: result.ok,
    url: modelsUrl,
    detail: result.ok ? undefined : result.detail || "fetch_failed",
    models,
  };
};

const checkOllamaHealth = async () => {
  const rawBase = OLLAMA_BASE_URL;
  const base = rawBase.replace(/\/$/, "");
  const tagsUrl = `${base}/api/tags`;
  const result = await fetchJsonWithTimeout(tagsUrl);
  const list = result.ok && Array.isArray(result.data?.models) ? result.data.models : [];
  const models = list.map((m) => m?.name).filter(Boolean);
  return {
    ok: result.ok,
    url: tagsUrl,
    detail: result.ok ? undefined : result.detail || "fetch_failed",
    models,
  };
};

app.get("/health/lm", async (req, res) => {
  const status = await checkLmStudioHealth();
  if (status.ok) {
    return res.json({
      ok: true,
      lm: true,
      base: status.url,
      modelHint: status.models?.[0] || null,
      modelsCount: status.models?.length || 0,
    });
  }
  return res.status(503).json({
    ok: false,
    lm: false,
    base: status.url,
    error: "lm_unreachable",
    message: status.detail || "LM unreachable",
  });
});

app.get("/health/providers", async (req, res) => {
  const [lmstudio, ollama] = await Promise.all([checkLmStudioHealth(), checkOllamaHealth()]);
  return res.json({
    ok: true,
    providers: {
      lmstudio,
      ollama,
    },
  });
});

app.get("/health/provider/:name", async (req, res) => {
  const name = String(req.params.name || "").toLowerCase();
  if (name !== "lmstudio" && name !== "ollama") {
    return res.status(400).json({
      ok: false,
      provider: name,
      url: "",
      detail: "bad_response",
      models: [],
    });
  }
  const status = name === "lmstudio" ? await checkLmStudioHealth() : await checkOllamaHealth();
  return res.json({
    ok: status.ok,
    provider: name,
    url: status.url,
    detail: status.detail,
    models: status.models || [],
  });
});

app.post("/api/kb/append", (req, res) => {
  const { text, notes, source } = req.body || {};
  const textRaw = typeof text === "string" ? text : (typeof notes === "string" ? notes : "");
  const sanitizedText = textRaw.replace(/\0/g, "").trim();

  if (!sanitizedText) {
    return res.status(400).json(makeErrorPayload("INVALID_INPUT", "text must be a non-empty string"));
  }
  if (sanitizedText.length > 20000) {
    return res.status(400).json(makeErrorPayload("REQUEST_TOO_LARGE", "text length must be <= 20000"));
  }

  const safeSource = String(source || "ui").replace(/\0/g, "").trim() || "ui";
  const iso = new Date().toISOString();
  const kbDir = path.join(process.cwd(), "data", "kb");
  const kbFile = path.join(kbDir, "notes.txt");
  const line = `[${iso}] (${safeSource}) ${sanitizedText}\n`;

  try {
    fs.mkdirSync(kbDir, { recursive: true });
    if (fs.existsSync(kbFile)) {
      try {
        const stats = fs.statSync(kbFile);
        if (stats.size > 0) {
          const fd = fs.openSync(kbFile, "r");
          const buf = Buffer.alloc(1);
          fs.readSync(fd, buf, 0, 1, stats.size - 1);
          fs.closeSync(fd);
          if (buf.toString("utf8") !== "\n") {
            fs.appendFileSync(kbFile, "\n", { encoding: "utf8" });
          }
        }
      } catch {
        // best-effort formatting; append still proceeds
      }
    }
    fs.appendFileSync(kbFile, line, { encoding: "utf8" });
    return res.json({
      ok: true,
      meta: {
        appended: true,
        bytes: Buffer.byteLength(line, "utf8"),
        path: path.relative(process.cwd(), kbFile).replace(/\\/g, "/"),
      },
    });
  } catch (e) {
    return res.status(500).json(makeErrorPayload("KB_WRITE_FAILED", e?.message || "Failed to write KB memory"));
  }
});

app.post("/api/chat", rateLimitMiddleware, async (req, res) => {
  const requestStartMs = Date.now();
  const { message, systemPrompt, useKB, provider, model, planMode } = req.body || {};
  const requestProvider = provider ? String(provider).trim().toLowerCase() : "lmstudio";
  const requestModel = model ? String(model).trim() : null;
  const requestPlanMode = normalizePlanMode(planMode);
  const runtimeScope = resolveRuntimeScope(req);
  const runtimeTask = createInternalRuntimeTask({ scopeMode: runtimeScope?.mode });
  const requestChars = typeof message === "string" ? message.length : 0;
  const authContext = await resolveAuthUserContext(req.headers.authorization);
  const buildMeta = (baseMeta) => ({
    provider: baseMeta?.provider || requestProvider,
    model: baseMeta?.model || requestModel,
    planMode: normalizePlanMode(baseMeta?.planMode || requestPlanMode),
    latencyMs: Number.isFinite(baseMeta?.latencyMs) ? baseMeta.latencyMs : (Date.now() - requestStartMs),
    usage: {
      prompt_tokens: Number.isFinite(baseMeta?.usage?.prompt_tokens) ? baseMeta.usage.prompt_tokens : null,
      completion_tokens: Number.isFinite(baseMeta?.usage?.completion_tokens) ? baseMeta.usage.completion_tokens : null,
      total_tokens: Number.isFinite(baseMeta?.usage?.total_tokens) ? baseMeta.usage.total_tokens : null,
    },
    kb: {
      enabled: Boolean(baseMeta?.kb?.enabled),
      topK: Number.isFinite(baseMeta?.kb?.topK) ? baseMeta.kb.topK : 4,
      hits: Number.isFinite(baseMeta?.kb?.hits) ? baseMeta.kb.hits : 0,
      mode: normalizeKbMode(baseMeta?.kb?.mode),
      chunksUsed: normalizeNonNegativeInt(baseMeta?.kb?.chunksUsed, 0),
      semanticHits: normalizeNonNegativeInt(baseMeta?.kb?.semanticHits, 0),
      lexicalHits: normalizeNonNegativeInt(baseMeta?.kb?.lexicalHits, 0),
      mergedHits: normalizeNonNegativeInt(baseMeta?.kb?.mergedHits, 0),
      sourceCount: normalizeNonNegativeInt(
        baseMeta?.kb?.sourceCount,
        Array.isArray(baseMeta?.kb?.citations) ? baseMeta.kb.citations.length : 0
      ),
      influenced: typeof baseMeta?.kb?.influenced === "boolean"
        ? baseMeta.kb.influenced
        : normalizeNonNegativeInt(baseMeta?.kb?.hits, 0) > 0,
      decisionHint: normalizeKbDecisionHint(baseMeta?.kb?.decisionHint, Boolean(baseMeta?.kb?.enabled)),
      citations: sanitizeKbCitations(baseMeta?.kb?.citations),
    },
  });

  const messageText = typeof message === "string" ? message.trim() : "";
  const logUsageEvent = ({ ok, errorCode = null, provider: eventProvider = null, model: eventModel = null, replyChars = 0 }) => {
    appendUsageEvent({
      timestamp: new Date().toISOString(),
      provider: eventProvider || requestProvider,
      model: eventModel || requestModel || null,
      latencyMs: Date.now() - requestStartMs,
      requestChars,
      replyChars,
      planMode: requestPlanMode,
      userId: authContext.userId || null,
      authErrorCode: authContext.authErrorCode || null,
      ok: Boolean(ok),
      error: { code: errorCode || null },
    });
  };

  if (!messageText) {
    transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.FAILED);
    logUsageEvent({ ok: false, errorCode: "INVALID_MESSAGE" });
    return res.status(400).json({
      ...makeErrorPayload("INVALID_MESSAGE", "message must be a non-empty string"),
      meta: { ...buildMeta({}), limits: { maxMessageChars: MAX_MESSAGE_CHARS } },
    });
  }
  if (messageText.length > MAX_MESSAGE_CHARS) {
    transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.FAILED);
    logUsageEvent({ ok: false, errorCode: "MESSAGE_TOO_LONG" });
    return res.status(400).json({
      ...makeErrorPayload("MESSAGE_TOO_LONG", `message exceeds max length (${MAX_MESSAGE_CHARS} chars)`),
      meta: { ...buildMeta({}), limits: { maxMessageChars: MAX_MESSAGE_CHARS } },
    });
  }
  if (activeAssistantProcess) {
    transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.FAILED);
    logUsageEvent({ ok: false, errorCode: "assistant_busy" });
    return res.status(429).json({
      ...makeErrorPayload("assistant_busy", "Assistant is busy. Please wait..."),
      meta: buildMeta({}),
    });
  }

  const scriptPath = "apps/assistant/rez-ai.js";
  transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.RUNNING);
  const runtimeExecutionBoundary = createRuntimeExecutionBoundary(runtimeTask);
  if (!isRuntimeExecutionBoundaryValid(runtimeExecutionBoundary)) {
    transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.FAILED);
    logUsageEvent({ ok: false, errorCode: "assistant_failed" });
    return res.status(500).json({
      ...makeErrorPayload("assistant_failed", "Assistant execution boundary is invalid"),
      meta: buildMeta({}),
    });
  }
  const runtimeContinuationGate = resolveInternalContinuationGate({
    req,
    runtimeScope,
    runtimeTask,
  });
  const child = spawn(process.execPath, [scriptPath, messageText], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REZ_JSON_ONLY: "1",
      REZ_SYSTEM_PROMPT: systemPrompt || "",
      REZ_USE_KB: useKB ? "1" : "0",
      REZ_PROVIDER: provider ? String(provider).trim().toLowerCase() : (process.env.REZ_PROVIDER || ""),
      REZ_MODEL: model ? String(model).trim() : (process.env.REZ_MODEL || ""),
      REZ_RUNTIME_SCOPE: serializeRuntimeScope(runtimeScope),
      REZ_RUNTIME_TASK: serializeRuntimeTask(runtimeTask),
      REZ_RUNTIME_CONTINUATION_GATE: serializeRuntimeContinuationGate(runtimeContinuationGate),
    }
  });
  activeAssistantProcess = child;

  const OUTPUT_LIMIT = 256 * 1024;
  const TIMEOUT_MS = 25_000;

  let output = "";
  let err = "";
  let outputTruncated = false;
  let errTruncated = false;
  let childExited = false;
  let responded = false;
  let killFallbackTimer = null;

  const appendWithLimit = (current, chunk, limit) => {
    const remaining = limit - current.length;
    if (remaining <= 0) return { next: current, truncated: true };
    if (chunk.length <= remaining) return { next: current + chunk, truncated: false };
    return { next: current + chunk.slice(0, remaining), truncated: true };
  };

  const safeReply = (status, payload) => {
    if (responded || res.headersSent) return;
    responded = true;
    res.status(status).json(payload);
  };

  const cleanup = ({ clearKillFallback = true } = {}) => {
    activeAssistantProcess = null;
    clearTimeout(timeoutTimer);
    if (clearKillFallback && killFallbackTimer) clearTimeout(killFallbackTimer);
  };

  const terminateChild = (reason) => {
    if (childExited || child.killed) return;
    console.error(`[api/chat] terminating child (${reason})`);
    child.kill("SIGTERM");
    killFallbackTimer = setTimeout(() => {
      if (!childExited && !child.killed) {
        console.error("[api/chat] forcing child kill (SIGKILL)");
        child.kill("SIGKILL");
      }
    }, 1000);
  };

  const timeoutTimer = setTimeout(() => {
    terminateChild("timeout");
    cleanup({ clearKillFallback: false });
    transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.FAILED);
    logUsageEvent({ ok: false, errorCode: "assistant_timeout" });
    safeReply(504, {
      ...makeErrorPayload("assistant_timeout", "Assistant timed out"),
      meta: buildMeta({}),
    });
  }, TIMEOUT_MS);

  child.stdout.on("data", (d) => {
    if (outputTruncated) return;
    const chunk = d.toString("utf8");
    const result = appendWithLimit(output, chunk, OUTPUT_LIMIT);
    output = result.next;
    if (result.truncated) {
      outputTruncated = true;
      output += "...[truncated]";
    }
  });

  child.stderr.on("data", (d) => {
    if (errTruncated) return;
    const chunk = d.toString("utf8");
    const result = appendWithLimit(err, chunk, OUTPUT_LIMIT);
    err = result.next;
    if (result.truncated) {
      errTruncated = true;
      err += "...[truncated]";
    }
    console.error("[api/chat] child stderr:", chunk.trim());
  });

  child.on("error", (spawnErr) => {
    cleanup();
    transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.FAILED);
    console.error("[api/chat] spawn failed:", spawnErr);
    logUsageEvent({ ok: false, errorCode: "assistant_spawn_failed" });
    safeReply(500, {
      ...makeErrorPayload("assistant_spawn_failed", "failed to start assistant process"),
      meta: buildMeta({}),
    });
  });

  child.on("close", (code) => {
    cleanup();
    childExited = true;
    if (responded) return;
    let parsed;
    try {
      parsed = JSON.parse(output.trim());
    } catch {
      transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.FAILED);
      console.error("[api/chat] bad assistant json:", output.slice(0, 400));
      logUsageEvent({ ok: false, errorCode: "BAD_ASSISTANT_OUTPUT" });
      return safeReply(500, {
        ...makeErrorPayload("BAD_ASSISTANT_OUTPUT", "Assistant returned invalid JSON output"),
        meta: buildMeta({}),
      });
    }

    if (parsed?.ok === true) {
      transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.SUCCEEDED);
      const replyText = parsed.reply ?? "";
      logUsageEvent({
        ok: true,
        provider: parsed?.meta?.provider,
        model: parsed?.meta?.model,
        replyChars: typeof replyText === "string" ? replyText.length : String(replyText).length,
      });
      return safeReply(200, {
        ok: true,
        reply: replyText,
        meta: buildMeta(parsed.meta || {}),
      });
    }

    if (parsed?.ok === false) {
      transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.FAILED);
      console.error("[api/chat] assistant error payload:", parsed.error);
      logUsageEvent({
        ok: false,
        errorCode: parsed?.error?.code || "assistant_failed",
        provider: parsed?.meta?.provider,
        model: parsed?.meta?.model,
      });
      return safeReply(500, {
        ...makeErrorPayload(
          parsed?.error?.code || "assistant_failed",
          parsed?.error?.message || "assistant failed",
        ),
        meta: buildMeta(parsed.meta || {}),
      });
    }

    if (code !== 0) {
      transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.FAILED);
      console.error("[api/chat] child exited with code", code, err.trim());
      logUsageEvent({ ok: false, errorCode: "assistant_failed" });
      return safeReply(500, {
        ...makeErrorPayload("assistant_failed", `assistant exited with code ${code}`),
        meta: buildMeta({}),
      });
    }
    transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.FAILED);
    logUsageEvent({ ok: false, errorCode: "BAD_ASSISTANT_OUTPUT" });
    safeReply(500, {
      ...makeErrorPayload("BAD_ASSISTANT_OUTPUT", "Assistant returned unexpected payload"),
      meta: buildMeta({}),
    });
  });

  const onClientAbort = () => {
    if (!childExited && !responded) {
      transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.FAILED);
      terminateChild("client_aborted");
      cleanup({ clearKillFallback: false });
    }
  };

  req.on("aborted", onClientAbort);
  res.on("close", () => {
    if (!childExited && !responded) onClientAbort();
  });
});

app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
