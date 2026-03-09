#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { getProvider } = require("./providers");

const LMSTUDIO_BASE = process.env.REZ_PROVIDER_LMSTUDIO_BASE_URL
    || process.env.REZ_LMSTUDIO_BASE
    || process.env.LMSTUDIO_BASE
    || "http://127.0.0.1:1234/v1";
const OLLAMA_BASE = process.env.REZ_PROVIDER_OLLAMA_BASE_URL
    || process.env.REZ_OLLAMA_BASE
    || process.env.OLLAMA_BASE
    || "http://127.0.0.1:11434";
const LMSTUDIO_MODEL = process.env.LMSTUDIO_MODEL || "qwen2.5-coder-14b-instruct";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:latest";
const DEFAULT_PROVIDER = "lmstudio";
const HYBRID_SEMANTIC_WEIGHT = 0.7;
const HYBRID_LEXICAL_WEIGHT = 0.3;
const HYBRID_CANDIDATE_K = 5;
const SEMANTIC_MIN_SCORE = 0.08;
const SEMANTIC_STRONG_SCORE = 0.2;
const DEFAULT_RUNTIME_SCOPE = Object.freeze({
    mode: "local",
    workspaceId: null,
    projectId: null,
    source: "default_local",
});
const DEFAULT_RUNTIME_TASK = Object.freeze({
    taskId: null,
    kind: "chat_execution",
    state: "created",
    scopeMode: "local",
    createdAt: null,
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
const GUARDED_LOOP_EXECUTION_POLICY = Object.freeze({
    mode: "guarded_loop",
    hardMaxSteps: 2,
    defaultMaxSteps: 2,
    allowChainedExecution: true,
    stepType: "provider_chat_guarded_step",
    continuationPrompt: "Internal continuation: refine the previous answer and provide a final response.",
});
const GUARDED_RUNTIME_STABILITY_POLICY = Object.freeze({
    defaultStepTimeoutMs: 12000,
    defaultExecutionTimeoutMs: 20000,
});
const GUARDED_STEP_OUTCOMES = Object.freeze({
    CONTINUE: "continue",
    STOP: "stop",
    FAIL: "fail",
    NEEDS_REVIEW: "needs_review",
});
const DEFAULT_RUNTIME_CONTINUATION_GATE = Object.freeze({
    allowContinuation: false,
    maxSteps: 1,
    reason: "default_deny",
    source: "phase55_default_safe",
});
const KNOWN_EXECUTION_ERROR_CODES = new Set([
    "invalid_input",
    "execution_invalid_shape",
    "execution_preparation_failed",
    "execution_unsupported",
    "execution_transition_failed",
    "execution_needs_review",
    "execution_timeout",
    "execution_cancelled",
    "provider_failed",
    "provider_not_implemented",
    "assistant_failed",
]);
const TOKEN_STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
    "i", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to",
    "was", "what", "when", "where", "which", "who", "why", "with",
    // Keep a small Georgian stop-word subset to reduce noisy matching.
    "და", "რომ", "თუ", "რა", "ეს", "არის", "იყო", "თვის", "ზე", "ში"
]);

function normalizeRuntimeScope(raw) {
    const mode = String(raw?.mode || "").trim().toLowerCase();
    const workspaceId = raw?.workspaceId == null ? null : String(raw.workspaceId || "").trim() || null;
    const projectId = raw?.projectId == null ? null : String(raw.projectId || "").trim() || null;
    const source = String(raw?.source || "").trim() || DEFAULT_RUNTIME_SCOPE.source;

    if (mode !== "local") {
        return { ...DEFAULT_RUNTIME_SCOPE };
    }
    return {
        mode: "local",
        workspaceId,
        projectId,
        source,
    };
}

function resolveRuntimeScopeFromEnv(rawScopeEnv) {
    if (!rawScopeEnv) return { ...DEFAULT_RUNTIME_SCOPE };
    try {
        const parsed = JSON.parse(rawScopeEnv);
        return normalizeRuntimeScope(parsed);
    } catch {
        return { ...DEFAULT_RUNTIME_SCOPE };
    }
}

function makeInternalTaskId() {
    return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRuntimeTaskState(stateLike) {
    const state = String(stateLike || "").trim().toLowerCase();
    if (state === RUNTIME_TASK_STATES.RUNNING) return RUNTIME_TASK_STATES.RUNNING;
    if (state === RUNTIME_TASK_STATES.SUCCEEDED) return RUNTIME_TASK_STATES.SUCCEEDED;
    if (state === RUNTIME_TASK_STATES.FAILED) return RUNTIME_TASK_STATES.FAILED;
    return RUNTIME_TASK_STATES.CREATED;
}

function normalizeRuntimeTask(rawTask, runtimeScopeLike) {
    const runtimeScope = normalizeRuntimeScope(runtimeScopeLike || {});
    const taskIdRaw = String(rawTask?.taskId || "").trim();
    const kindRaw = String(rawTask?.kind || "").trim();
    const createdAtRaw = String(rawTask?.createdAt || "").trim();

    return {
        taskId: taskIdRaw || makeInternalTaskId(),
        kind: kindRaw || DEFAULT_RUNTIME_TASK.kind,
        state: normalizeRuntimeTaskState(rawTask?.state),
        scopeMode: runtimeScope.mode || DEFAULT_RUNTIME_TASK.scopeMode,
        createdAt: createdAtRaw || new Date().toISOString(),
    };
}

function transitionRuntimeTaskState(taskLike, nextStateLike) {
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
}

function resolveRuntimeTaskFromEnv(rawTaskEnv, runtimeScopeLike) {
    if (!rawTaskEnv) return normalizeRuntimeTask(null, runtimeScopeLike);
    try {
        const parsed = JSON.parse(rawTaskEnv);
        return normalizeRuntimeTask(parsed, runtimeScopeLike);
    } catch {
        return normalizeRuntimeTask(null, runtimeScopeLike);
    }
}

function makeExecutionError(code, message, cause = null) {
    const err = new Error(message || "Execution failed");
    err.code = code || "assistant_failed";
    if (cause) err.cause = cause;
    return err;
}

function normalizeExecutionFailure(errorLike) {
    const code = String(errorLike?.code || "").trim();
    if (code && KNOWN_EXECUTION_ERROR_CODES.has(code)) return errorLike;
    return makeExecutionError(
        "assistant_failed",
        errorLike?.message || "Bounded execution failed",
        errorLike || null
    );
}

function resolvePositiveInt(rawValue, fallback) {
    const parsed = Number.parseInt(String(rawValue ?? ""), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function resolveGuardedRuntimeStabilityConfig() {
    const stepTimeoutMs = resolvePositiveInt(
        process.env.REZ_RUNTIME_GUARDED_STEP_TIMEOUT_MS,
        GUARDED_RUNTIME_STABILITY_POLICY.defaultStepTimeoutMs
    );
    const executionTimeoutMsRaw = resolvePositiveInt(
        process.env.REZ_RUNTIME_GUARDED_EXECUTION_TIMEOUT_MS,
        GUARDED_RUNTIME_STABILITY_POLICY.defaultExecutionTimeoutMs
    );
    const executionTimeoutMs = Math.max(executionTimeoutMsRaw, stepTimeoutMs);
    const cancelRequested = String(process.env.REZ_RUNTIME_CANCEL_SIGNAL || "").trim() === "1";
    const forceNeedsReview = String(process.env.REZ_RUNTIME_FORCE_NEEDS_REVIEW || "").trim() === "1";
    const printBreadcrumbs = String(process.env.REZ_RUNTIME_PRINT_BREADCRUMBS || "").trim() === "1";
    return {
        stepTimeoutMs,
        executionTimeoutMs,
        cancelRequested,
        forceNeedsReview,
        printBreadcrumbs,
    };
}

function createRuntimeBreadcrumbRecorder({ printEnabled = false } = {}) {
    const events = [];
    return {
        add(type, detail = {}) {
            const event = {
                at: new Date().toISOString(),
                type: String(type || "unknown").trim() || "unknown",
                detail: detail && typeof detail === "object" ? detail : {},
            };
            events.push(event);
            if (!printEnabled) return;
            try {
                console.error("[runtime][breadcrumb]", JSON.stringify(event));
            } catch {
                // Breadcrumb logging is strictly best-effort.
            }
        },
        list() {
            return events.slice();
        },
    };
}

function normalizeGuardedLoopMaxSteps(maxStepsLike) {
    const parsed = Number.parseInt(String(maxStepsLike ?? ""), 10);
    if (!Number.isFinite(parsed) || parsed < 2) return GUARDED_LOOP_EXECUTION_POLICY.defaultMaxSteps;
    return Math.min(parsed, GUARDED_LOOP_EXECUTION_POLICY.hardMaxSteps);
}

function createRuntimeExecutionBoundary({ runtimeTask, runtimeHooks, userText }) {
    const task = normalizeRuntimeTask(runtimeTask, runtimeHooks?.scope || null);
    const normalizedUserText = typeof userText === "string" ? userText.trim() : "";
    if (task.state !== RUNTIME_TASK_STATES.RUNNING) {
        throw makeExecutionError(
            "execution_preparation_failed",
            "Execution requires runtime task state `running` before single-step handoff"
        );
    }
    if (!normalizedUserText) {
        throw makeExecutionError(
            "execution_invalid_shape",
            "Execution requires a non-empty single-step user input"
        );
    }

    const scopeMode = String(runtimeHooks?.scope?.mode || "local").trim().toLowerCase();
    const requestedMode = String(runtimeHooks?.requestedMode || scopeMode || "local").trim().toLowerCase();
    const unsupportedScope = requestedMode !== "local";
    const continuationGate = resolveRuntimeContinuationGateFromEnv(
        process.env.REZ_RUNTIME_CONTINUATION_GATE,
        {
            runtimeHooks,
            runtimeTask: task,
        }
    );
    const allowGuardedLoop = continuationGate.allowContinuation === true && !unsupportedScope;
    const maxSteps = allowGuardedLoop
        ? normalizeGuardedLoopMaxSteps(continuationGate.maxSteps)
        : SINGLE_STEP_EXECUTION_POLICY.maxSteps;
    const mode = allowGuardedLoop
        ? GUARDED_LOOP_EXECUTION_POLICY.mode
        : SINGLE_STEP_EXECUTION_POLICY.mode;
    const allowChainedExecution = allowGuardedLoop
        ? GUARDED_LOOP_EXECUTION_POLICY.allowChainedExecution
        : SINGLE_STEP_EXECUTION_POLICY.allowChainedExecution;
    const stepType = allowGuardedLoop
        ? GUARDED_LOOP_EXECUTION_POLICY.stepType
        : SINGLE_STEP_EXECUTION_POLICY.stepType;

    return {
        mode,
        maxSteps,
        stepCount: maxSteps,
        allowChainedExecution,
        steps: Array.from({ length: maxSteps }, (_, idx) => ({
            index: idx + 1,
            type: stepType,
            terminal: idx === maxSteps - 1,
        })),
        deniedReason: unsupportedScope ? "unsupported_scope_mode" : null,
        continuationGate,
    };
}

function resolveRuntimeContinuationGateFromEnv(rawGateEnv, { runtimeHooks, runtimeTask } = {}) {
    if (!rawGateEnv) return { ...DEFAULT_RUNTIME_CONTINUATION_GATE };
    let parsed = null;
    try {
        parsed = JSON.parse(rawGateEnv);
    } catch {
        return { ...DEFAULT_RUNTIME_CONTINUATION_GATE, reason: "invalid_gate_payload" };
    }
    const requestedAllow = parsed?.allowContinuation === true;
    const source = String(parsed?.source || "").trim() || DEFAULT_RUNTIME_CONTINUATION_GATE.source;
    const reason = String(parsed?.reason || "").trim() || DEFAULT_RUNTIME_CONTINUATION_GATE.reason;
    const maxStepsRaw = Number.parseInt(String(parsed?.maxSteps ?? ""), 10);
    const maxSteps = Number.isFinite(maxStepsRaw) ? maxStepsRaw : DEFAULT_RUNTIME_CONTINUATION_GATE.maxSteps;
    const taskState = normalizeRuntimeTaskState(runtimeTask?.state);
    const isLocalMode = runtimeHooks?.isLocalMode === true;
    const allowContinuation = requestedAllow
        && source === "env_rez_internal_allow_continuation"
        && reason === "explicit_internal_allow"
        && isLocalMode
        && taskState === RUNTIME_TASK_STATES.RUNNING;
    if (allowContinuation) {
        return {
            allowContinuation: true,
            maxSteps: normalizeGuardedLoopMaxSteps(maxSteps),
            reason,
            source,
        };
    }
    if (requestedAllow) {
        return {
            ...DEFAULT_RUNTIME_CONTINUATION_GATE,
            maxSteps: DEFAULT_RUNTIME_CONTINUATION_GATE.maxSteps,
            reason: "preconditions_not_met",
            source,
        };
    }
    return {
        ...DEFAULT_RUNTIME_CONTINUATION_GATE,
        maxSteps: DEFAULT_RUNTIME_CONTINUATION_GATE.maxSteps,
        source,
    };
}

function assertRuntimeExecutionBoundary(boundary) {
    if (!boundary || typeof boundary !== "object") {
        throw makeExecutionError("execution_invalid_shape", "Execution boundary payload is required");
    }
    const gate = boundary.continuationGate || {};
    if (typeof gate.allowContinuation !== "boolean") {
        throw makeExecutionError("execution_invalid_shape", "Execution continuation gate must define boolean allowContinuation");
    }

    if (boundary.mode === SINGLE_STEP_EXECUTION_POLICY.mode) {
        if (!Number.isFinite(boundary.maxSteps) || boundary.maxSteps !== 1) {
            throw makeExecutionError("execution_invalid_shape", "Execution boundary maxSteps must be 1");
        }
        if (!Number.isFinite(boundary.stepCount) || boundary.stepCount !== 1) {
            throw makeExecutionError("execution_invalid_shape", "Execution boundary stepCount must be 1");
        }
        if (boundary.allowChainedExecution !== false) {
            throw makeExecutionError("execution_invalid_shape", "Execution boundary must deny chained execution");
        }
        if (!Array.isArray(boundary.steps) || boundary.steps.length !== 1) {
            throw makeExecutionError("execution_invalid_shape", "Execution boundary must contain exactly one step");
        }
        const step = boundary.steps[0];
        if (!step || step.type !== SINGLE_STEP_EXECUTION_POLICY.stepType || step.index !== 1 || step.terminal !== true) {
            throw makeExecutionError("execution_invalid_shape", "Execution boundary step definition is invalid");
        }
        if (gate.allowContinuation === true && (boundary.maxSteps !== 1 || boundary.allowChainedExecution !== false)) {
            throw makeExecutionError("execution_invalid_shape", "Single-step mode cannot allow chained execution");
        }
        return;
    }

    if (boundary.mode === GUARDED_LOOP_EXECUTION_POLICY.mode) {
        if (gate.allowContinuation !== true) {
            throw makeExecutionError("execution_invalid_shape", "Guarded loop mode requires continuation gate allowContinuation=true");
        }
        const expectedMaxSteps = normalizeGuardedLoopMaxSteps(boundary.maxSteps);
        if (!Number.isFinite(boundary.maxSteps) || boundary.maxSteps !== expectedMaxSteps) {
            throw makeExecutionError("execution_invalid_shape", "Guarded loop maxSteps must satisfy bounded hard cap");
        }
        if (!Number.isFinite(boundary.stepCount) || boundary.stepCount !== boundary.maxSteps) {
            throw makeExecutionError("execution_invalid_shape", "Guarded loop stepCount must equal maxSteps");
        }
        if (boundary.allowChainedExecution !== true) {
            throw makeExecutionError("execution_invalid_shape", "Guarded loop boundary must allow chained execution");
        }
        if (!Array.isArray(boundary.steps) || boundary.steps.length !== boundary.maxSteps) {
            throw makeExecutionError("execution_invalid_shape", "Guarded loop must define one step entry per bounded step");
        }
        for (let i = 0; i < boundary.steps.length; i++) {
            const step = boundary.steps[i];
            const expectedIndex = i + 1;
            const expectedTerminal = expectedIndex === boundary.maxSteps;
            if (!step || step.type !== GUARDED_LOOP_EXECUTION_POLICY.stepType || step.index !== expectedIndex || step.terminal !== expectedTerminal) {
                throw makeExecutionError("execution_invalid_shape", "Guarded loop step definition is invalid");
            }
        }
        return;
    }

    throw makeExecutionError("execution_invalid_shape", "Execution boundary mode is invalid");
}

function assertGuardedExecutionNotCancelled(stabilityConfig) {
    if (stabilityConfig?.cancelRequested !== true) return;
    throw makeExecutionError("execution_cancelled", "Guarded execution cancelled by internal signal");
}

function assertGuardedExecutionBudget(startedAtMs, stabilityConfig) {
    const elapsedMs = Date.now() - startedAtMs;
    const budgetMs = Number(stabilityConfig?.executionTimeoutMs) || GUARDED_RUNTIME_STABILITY_POLICY.defaultExecutionTimeoutMs;
    if (elapsedMs <= budgetMs) return;
    throw makeExecutionError(
        "execution_timeout",
        `Guarded execution exceeded timeout budget (${budgetMs}ms)`
    );
}

async function runProviderStepWithTimeout({ provider, model, messages, temperature, max_tokens, baseUrl, timeoutMs }) {
    let timer = null;
    try {
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(makeExecutionError("execution_timeout", `Guarded step timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });
        const providerPromise = provider.chat({
            model,
            messages,
            temperature,
            max_tokens,
            baseUrl,
        });
        return await Promise.race([providerPromise, timeoutPromise]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function resolveGuardedStepOutcome({ stepIndex, maxSteps, replyText, forceNeedsReview = false }) {
    if (forceNeedsReview) {
        return {
            outcome: GUARDED_STEP_OUTCOMES.NEEDS_REVIEW,
            reason: "forced_internal_needs_review",
        };
    }
    const normalizedReply = typeof replyText === "string" ? replyText.trim() : "";
    if (!normalizedReply) {
        return {
            outcome: GUARDED_STEP_OUTCOMES.FAIL,
            reason: "empty_reply",
        };
    }
    if (stepIndex >= maxSteps) {
        return {
            outcome: GUARDED_STEP_OUTCOMES.STOP,
            reason: "max_steps_reached",
        };
    }
    return {
        outcome: GUARDED_STEP_OUTCOMES.CONTINUE,
        reason: "bounded_continue",
    };
}

function getRequestedRuntimeMode(scopeLike) {
    const requestedModeRaw = String(scopeLike?.mode || "").trim().toLowerCase();
    return requestedModeRaw || null;
}

function buildRuntimeScopeHooks(scopeLike) {
    const requestedMode = getRequestedRuntimeMode(scopeLike);
    const scope = normalizeRuntimeScope(scopeLike);
    const isRequestedLocal = !requestedMode || requestedMode === "local";
    const boundary = isRequestedLocal
        ? {
            type: "local_active",
            allowNormalBehavior: true,
            fallbackToLocalSafe: false,
            requestedMode: requestedMode || "local",
        }
        : {
            type: "non_local_not_implemented_fallback_local",
            allowNormalBehavior: false,
            fallbackToLocalSafe: true,
            requestedMode,
        };
    const hooks = {
        scope,
        requestedMode: requestedMode || "local",
        boundary,
        isLocalMode: scope.mode === "local",
        // Future hook points: workspace/project engines can guard behavior here.
        allowKB: scope.mode === "local",
        allowWorkflowRuntime: false,
        allowPermissionsRuntime: false,
        allowAuditPersistence: false,
    };
    return hooks;
}

function parseArgs(argv) {
    const args = argv.slice(2);
    const flags = { print: false, json: false, k: 4, provider: null };
    const rest = [];

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--print") flags.print = true;
        else if (a === "--json") flags.json = true;
        else if (a === "--k") {
            const n = Number(args[++i] || "4");
            flags.k = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 4;
        } else if (a === "--provider") {
            flags.provider = (args[++i] || "").trim().toLowerCase() || null;
        } else rest.push(a);
    }

    return { flags, question: rest.join(" ").trim() };
}

function readUtf8(p) {
    return fs.readFileSync(p, "utf8");
}

function readSystemPrompt() {
    const p = path.join(process.cwd(), "prompts", "system.md");
    return fs.existsSync(p) ? readUtf8(p) : "You are REZ-AI.";
}

function loadKB() {
    const p = path.join(process.cwd(), "data", "cache", "kb.json");
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(readUtf8(p));
    } catch {
        return null;
    }
}

function loadKBVectors() {
    const p = path.join(process.cwd(), "data", "cache", "kb_vectors.json");
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(readUtf8(p));
    } catch {
        return null;
    }
}

function getEntries(kb) {
    if (!kb) return [];
    if (Array.isArray(kb.items)) return kb.items;
    if (Array.isArray(kb.entries)) return kb.entries;
    if (Array.isArray(kb.data)) return kb.data;
    if (Array.isArray(kb.chunks)) return kb.chunks;
    return [];
}

function entryText(e) {
    if (typeof e === "string") return e;
    return (e?.chunk ?? e?.text ?? e?.content ?? "").toString();
}
function entrySource(e) {
    if (!e || typeof e !== "object") return "";
    return (e.source ?? e.path ?? e.file ?? e.source_path ?? "").toString();
}

function tokenize(s) {
    const seen = new Set();
    return (s || "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter((tok) => {
            if (!tok) return false;
            if (tok.length < 2) return false;
            if (TOKEN_STOP_WORDS.has(tok)) return false;
            if (seen.has(tok)) return false;
            seen.add(tok);
            return true;
        })
        .slice(0, 60);
}

function scoreText(qTokens, text) {
    const t = (text || "").toLowerCase();
    let score = 0;
    for (const tok of qTokens) {
        if (t.includes(tok)) score += 1;
    }
    return score;
}

function normalizeLexicalScore(rawLexicalScore) {
    const v = Number(rawLexicalScore) || 0;
    if (v <= 0) return 0;
    // Smooth lexical scale into 0..1 so hybrid ranking stays balanced.
    return 1 - Math.exp(-v / 3);
}

function makeDeterministicVector(text, dim) {
    const safeDim = Number.isFinite(dim) && dim > 0 ? Math.floor(dim) : 0;
    if (!safeDim) return [];
    const vec = new Array(safeDim).fill(0);
    const src = String(text || "");
    if (!src) return vec;

    for (let i = 0; i < src.length; i++) {
        const code = src.charCodeAt(i);
        const idx = (code + i) % safeDim;
        vec[idx] += 1;
    }
    const norm = Math.sqrt(vec.reduce((acc, v) => acc + (v * v), 0)) || 1;
    for (let i = 0; i < vec.length; i++) {
        vec[i] = Number((vec[i] / norm).toFixed(6));
    }
    return vec;
}

function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return -1;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        const va = Number(a[i]) || 0;
        const vb = Number(b[i]) || 0;
        dot += va * vb;
        normA += va * va;
        normB += vb * vb;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (!denom) return -1;
    return dot / denom;
}

function semanticTopK(items, queryVector, k = 4) {
    if (!Array.isArray(items) || !items.length || !Array.isArray(queryVector) || !queryVector.length) return [];
    return items
        .map((entry) => ({
            entry,
            score: cosineSimilarity(entry?.vector, queryVector),
        }))
        .filter((x) => Number.isFinite(x.score) && x.score >= SEMANTIC_MIN_SCORE)
        .sort((a, b) => compareHitsStable(b, a, "score"))
        .slice(0, k);
}

function hitId(hit) {
    const entry = hit?.entry || {};
    if (entry?.id) return String(entry.id);
    const source = entrySource(entry) || "";
    const chunk =
        entry?.chunkIndex
        ?? entry?.index
        ?? entry?.offset
        ?? (typeof entryText(entry) === "string" ? entryText(entry).slice(0, 48) : "");
    return `${source}|${String(chunk)}`;
}

function compareHitsStable(a, b, scoreField = "score") {
    const aScore = Number(a?.[scoreField]) || 0;
    const bScore = Number(b?.[scoreField]) || 0;
    if (aScore !== bScore) return aScore - bScore;

    const aLex = Number(a?.lexicalScore ?? a?.lexical) || 0;
    const bLex = Number(b?.lexicalScore ?? b?.lexical) || 0;
    if (aLex !== bLex) return aLex - bLex;

    const aSem = Number(a?.semanticScore ?? a?.semantic) || 0;
    const bSem = Number(b?.semanticScore ?? b?.semantic) || 0;
    if (aSem !== bSem) return aSem - bSem;

    const aKey = hitId(a);
    const bKey = hitId(b);
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    return 0;
}

function mergeHybridHits(semanticHits, lexicalHits, topK) {
    const merged = new Map();
    for (const hit of semanticHits || []) {
        const key = hitId(hit);
        if (!key) continue;
        const current = merged.get(key) || { entry: hit.entry, semantic: 0, lexical: 0 };
        current.entry = current.entry || hit.entry;
        current.semantic = Math.max(current.semantic, Number(hit.score) || 0);
        merged.set(key, current);
    }
    for (const hit of lexicalHits || []) {
        const key = hitId(hit);
        if (!key) continue;
        const current = merged.get(key) || { entry: hit.entry, semantic: 0, lexical: 0 };
        current.entry = current.entry || hit.entry;
        current.lexical = Math.max(current.lexical, Number(hit.score) || 0);
        merged.set(key, current);
    }
    const rows = Array.from(merged.values())
        .filter((row) => {
            // Soft-drop weak semantic-only candidates when lexical support exists.
            if ((Number(row.lexical) || 0) > 0) return true;
            return (Number(row.semantic) || 0) >= SEMANTIC_MIN_SCORE;
        });

    const maxSemantic = rows.reduce((acc, row) => Math.max(acc, Number(row.semantic) || 0), 0);
    const lexicalSupportCount = rows.filter((row) => (Number(row.lexical) || 0) > 0).length;
    const useWeakSemanticBlend = lexicalSupportCount > 0 && maxSemantic < SEMANTIC_STRONG_SCORE;
    const semanticWeight = useWeakSemanticBlend ? 0.45 : HYBRID_SEMANTIC_WEIGHT;
    const lexicalWeight = useWeakSemanticBlend ? 0.55 : HYBRID_LEXICAL_WEIGHT;

    return rows
        .map((row) => {
            const lexicalNormalized = normalizeLexicalScore(row.lexical);
            return {
                entry: row.entry,
                score: (semanticWeight * row.semantic) + (lexicalWeight * lexicalNormalized),
                semanticScore: row.semantic,
                lexicalScore: row.lexical,
                lexicalScoreNormalized: lexicalNormalized,
            };
        })
        .sort((a, b) => compareHitsStable(b, a, "score"))
        .slice(0, topK);
}

function citationFromHit(hit) {
    const entry = hit?.entry || {};
    const id = entry?.id || null;
    const source = entrySource(entry) || "(kb)";
    const base = {
        id,
        source,
    };
    const score = Number(hit?.score);
    if (Number.isFinite(score)) {
        base.score = Number(score.toFixed(6));
    }
    if (typeof id === "string") {
        const m = id.match(/(\d+)$/);
        if (m) {
            const idx = Number.parseInt(m[1], 10);
            if (Number.isFinite(idx)) base.chunkIndex = idx;
        }
    }
    return base;
}

function retrieve(kb, question, k = 4) {
    const entries = getEntries(kb);
    if (!entries.length) return [];

    const qTokens = tokenize(question);
    const scored = entries
        .map((e) => ({ entry: e, score: scoreText(qTokens, entryText(e)) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => compareHitsStable(b, a, "score"))
        .slice(0, k);

    return scored;
}

function buildKBContext(hits, maxChars = 2500) {
    if (!hits.length) return "";
    let out = "[KB CONTEXT]\n";
    for (const hit of hits) {
        const src = entrySource(hit.entry) || "(kb)";
        let txt = entryText(hit.entry).trim();
        if (txt.length > 900) txt = `${txt.slice(0, 900)}…`;
        const line = `- (${src}) ${txt}\n`;
        if ((out + line).length > maxChars) break;
        out += line;
    }
    return out.trim();
}

async function providerChat({ systemPrompt, userText, k, providerName, modelName, runtimeScope, runtimeTask }) {
    let runtimeBreadcrumbs = null;
    try {
        const runtimeHooks = buildRuntimeScopeHooks(runtimeScope);
        const executionBoundary = createRuntimeExecutionBoundary({
            runtimeTask,
            runtimeHooks,
            userText,
        });
        assertRuntimeExecutionBoundary(executionBoundary);

        if (executionBoundary.deniedReason === "unsupported_scope_mode" && !runtimeHooks.boundary.fallbackToLocalSafe) {
            throw makeExecutionError(
                "execution_unsupported",
                "Unsupported scope mode for bounded execution"
            );
        }
        if (!runtimeHooks.boundary.allowNormalBehavior && runtimeHooks.boundary.fallbackToLocalSafe) {
            // Keep Phase-51 safety posture: non-local scope falls back to local-safe behavior.
        }

        const useKB = process.env.REZ_USE_KB === "1" && runtimeHooks.allowKB;
        const topK = Number.isFinite(k) && k > 0 ? k : 4;
        let context = "";
        let kbHits = [];
        let kbMode = "lexical";
        let semanticHitsCount = 0;
        let lexicalHitsCount = 0;
        let mergedHitsCount = 0;
        let citations = [];
        if (useKB) {
            const kbVectors = loadKBVectors();
            const vectorItems = Array.isArray(kbVectors?.items) ? kbVectors.items : [];
            const declaredDim = Number(kbVectors?.embed?.dim);
            const hasValidDim = Number.isFinite(declaredDim) && declaredDim > 0;
            const hasConsistentVectors = hasValidDim
                && vectorItems.length > 0
                && vectorItems.every((it) => Array.isArray(it?.vector) && it.vector.length === declaredDim);

            if (hasConsistentVectors) {
                const queryVector = makeDeterministicVector(userText, declaredDim);
                const candidateK = Math.max(topK, HYBRID_CANDIDATE_K);
                const semanticHits = semanticTopK(vectorItems, queryVector, candidateK);
                semanticHitsCount = semanticHits.length;
                const kb = loadKB();
                const lexicalHits = retrieve(kb, userText, candidateK);
                lexicalHitsCount = lexicalHits.length;
                const hybridHits = mergeHybridHits(semanticHits, lexicalHits, topK);
                mergedHitsCount = hybridHits.length;
                if (hybridHits.length) {
                    if (semanticHits.length > 0 && lexicalHits.length > 0) kbMode = "hybrid";
                    else if (semanticHits.length > 0) kbMode = "semantic";
                    else kbMode = "lexical";
                    kbHits = hybridHits;
                    context = buildKBContext(kbHits, 2500);
                }
            }

            if (!context) {
                const kb = loadKB();
                kbHits = retrieve(kb, userText, topK);
                lexicalHitsCount = kbHits.length;
                context = buildKBContext(kbHits, 2500);
                kbMode = "lexical";
            }

            if (kbHits.length > 0) {
                citations = kbHits.slice(0, topK).map(citationFromHit);
            }
        }
        const envSystemPrompt = process.env.REZ_SYSTEM_PROMPT?.trim();
        const baseSystemPrompt = envSystemPrompt || systemPrompt || "";
        const finalSystemPrompt = context
            ? `${baseSystemPrompt}\n\n${context}`.trim()
            : baseSystemPrompt.trim();

        const messages = [];
        if (finalSystemPrompt) {
            messages.push({ role: "system", content: finalSystemPrompt });
        }
        messages.push({ role: "user", content: userText });

        const payload = {
            model: modelName,
            messages,
            temperature: 0.2,
            max_tokens: 512,
        };
        const provider = getProvider(providerName || DEFAULT_PROVIDER);
        const providerBaseUrl = providerName === "ollama" ? OLLAMA_BASE : LMSTUDIO_BASE;
        const guardedModeActive = executionBoundary.mode === GUARDED_LOOP_EXECUTION_POLICY.mode;
        const guardedStability = guardedModeActive ? resolveGuardedRuntimeStabilityConfig() : null;
        const guardedStartedAtMs = Date.now();
        runtimeBreadcrumbs = guardedModeActive
            ? createRuntimeBreadcrumbRecorder({
                printEnabled: guardedStability?.printBreadcrumbs === true,
            })
            : null;
        if (guardedModeActive) {
            runtimeBreadcrumbs.add("guarded_execution_start", {
                maxSteps: executionBoundary.maxSteps,
                stepTimeoutMs: guardedStability.stepTimeoutMs,
                executionTimeoutMs: guardedStability.executionTimeoutMs,
            });
        }
        let stepMessages = payload.messages;
        let stepIndex = 1;
        let out = {};
        let reply = "";

        // Deterministic bounded execution:
        // - single_step mode executes once.
        // - guarded_loop mode continues until maxSteps hard-cap is reached.
        while (stepIndex <= executionBoundary.maxSteps) {
            if (guardedModeActive) {
                runtimeBreadcrumbs.add("guarded_step_start", {
                    stepIndex,
                    maxSteps: executionBoundary.maxSteps,
                });
                assertGuardedExecutionNotCancelled(guardedStability);
                assertGuardedExecutionBudget(guardedStartedAtMs, guardedStability);
            }
            const providerResult = guardedModeActive
                ? await runProviderStepWithTimeout({
                    provider,
                    model: payload.model,
                    messages: stepMessages,
                    temperature: payload.temperature,
                    max_tokens: payload.max_tokens,
                    baseUrl: providerBaseUrl,
                    timeoutMs: guardedStability.stepTimeoutMs,
                })
                : await provider.chat({
                    model: payload.model,
                    messages: stepMessages,
                    temperature: payload.temperature,
                    max_tokens: payload.max_tokens,
                    baseUrl: providerBaseUrl,
                });
            if (!providerResult?.ok) {
                throw makeExecutionError(
                    providerResult?.error || "provider_failed",
                    providerResult?.message || "Provider chat failed"
                );
            }
            out = providerResult.raw || {};
            reply = typeof providerResult.reply === "string"
                ? providerResult.reply
                : toAnswerText(out);

            if (guardedModeActive) {
                const transition = resolveGuardedStepOutcome({
                    stepIndex,
                    maxSteps: executionBoundary.maxSteps,
                    replyText: reply,
                    forceNeedsReview: guardedStability.forceNeedsReview && stepIndex === 1,
                });
                runtimeBreadcrumbs.add("guarded_transition", {
                    stepIndex,
                    outcome: transition.outcome,
                    reason: transition.reason,
                });
                if (transition.outcome === GUARDED_STEP_OUTCOMES.CONTINUE) {
                    stepMessages = [
                        ...stepMessages,
                        { role: "assistant", content: reply },
                        { role: "user", content: GUARDED_LOOP_EXECUTION_POLICY.continuationPrompt },
                    ];
                    runtimeBreadcrumbs.add("guarded_step_end", {
                        stepIndex,
                        terminal: false,
                        reason: transition.reason,
                    });
                    stepIndex += 1;
                    continue;
                }
                if (transition.outcome === GUARDED_STEP_OUTCOMES.STOP) {
                    runtimeBreadcrumbs.add("guarded_step_end", {
                        stepIndex,
                        terminal: true,
                        reason: transition.reason,
                    });
                    break;
                }
                if (transition.outcome === GUARDED_STEP_OUTCOMES.NEEDS_REVIEW) {
                    throw makeExecutionError(
                        "execution_needs_review",
                        "Guarded runtime reached needs_review terminal (internal-only deterministic stop)"
                    );
                }
                throw makeExecutionError(
                    "execution_transition_failed",
                    `Guarded runtime reached fail terminal (${transition.reason})`
                );
            }

            const shouldContinue = stepIndex < executionBoundary.maxSteps;
            if (!shouldContinue) break;

            stepMessages = [
                ...stepMessages,
                { role: "assistant", content: reply },
                { role: "user", content: GUARDED_LOOP_EXECUTION_POLICY.continuationPrompt },
            ];
            stepIndex += 1;
        }
        if (guardedModeActive) {
            runtimeBreadcrumbs.add("guarded_execution_end", {
                terminal: "success",
                stepCount: stepIndex,
            });
        }

        return {
            reply,
            out,
            kb: {
                enabled: useKB,
                topK,
                hits: kbHits.map((h) => ({
                    source: entrySource(h.entry) || "(kb)",
                    score: h.score,
                })),
                mode: kbMode,
                chunksUsed: kbHits.length,
                semanticHits: semanticHitsCount,
                lexicalHits: lexicalHitsCount,
                mergedHits: mergedHitsCount,
                citations,
            },
        };
    } catch (error) {
        if (runtimeBreadcrumbs) {
            runtimeBreadcrumbs.add("guarded_execution_end", {
                terminal: "failed",
                code: error?.code || "assistant_failed",
                message: error?.message || "Unknown execution failure",
            });
        }
        throw normalizeExecutionFailure(error);
    }
}

function toAnswerText(out) {
    return out?.choices?.[0]?.message?.content ?? "";
}

function extractUsage(out) {
    const u = out?.usage || {};
    const stats = out?.stats || {};
    const promptTokens = Number.isFinite(u.prompt_tokens)
        ? u.prompt_tokens
        : (Number.isFinite(stats.input_tokens) ? stats.input_tokens : null);
    const completionTokens = Number.isFinite(u.completion_tokens)
        ? u.completion_tokens
        : (Number.isFinite(stats.total_output_tokens) ? stats.total_output_tokens : null);
    const totalTokens = Number.isFinite(u.total_tokens)
        ? u.total_tokens
        : ((Number.isFinite(promptTokens) && Number.isFinite(completionTokens))
            ? promptTokens + completionTokens
            : null);
    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
    };
}

function normalizeUsage(u) {
    return {
        prompt_tokens: Number.isFinite(u?.prompt_tokens) ? u.prompt_tokens : null,
        completion_tokens: Number.isFinite(u?.completion_tokens) ? u.completion_tokens : null,
        total_tokens: Number.isFinite(u?.total_tokens) ? u.total_tokens : null,
    };
}

function makeMeta({ provider, model, latencyMs, usage, kb }) {
    return {
        provider: provider || DEFAULT_PROVIDER,
        model: model || null,
        latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
        usage: normalizeUsage(usage),
        kb: {
            enabled: Boolean(kb?.enabled),
            topK: Number.isFinite(kb?.topK) ? kb.topK : 4,
            hits: Number.isFinite(kb?.hits) ? kb.hits : 0,
            mode: typeof kb?.mode === "string" ? kb.mode : "lexical",
            chunksUsed: Number.isFinite(kb?.chunksUsed) ? kb.chunksUsed : 0,
            semanticHits: Number.isFinite(kb?.semanticHits) ? kb.semanticHits : 0,
            lexicalHits: Number.isFinite(kb?.lexicalHits) ? kb.lexicalHits : 0,
            mergedHits: Number.isFinite(kb?.mergedHits) ? kb.mergedHits : 0,
            citations: Array.isArray(kb?.citations) ? kb.citations : [],
        },
    };
}

function writeJsonLine(payload) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function main() {
    const startedAt = Date.now();
    const { flags, question } = parseArgs(process.argv);
    const jsonOnly = flags.json || process.env.REZ_JSON_ONLY === "1";
    const runtimeScope = resolveRuntimeScopeFromEnv(process.env.REZ_RUNTIME_SCOPE);
    const runtimeTask = resolveRuntimeTaskFromEnv(process.env.REZ_RUNTIME_TASK, runtimeScope);
    const providerName = (flags.provider || process.env.REZ_PROVIDER || DEFAULT_PROVIDER)
        .toString()
        .trim()
        .toLowerCase();
    const modelName = process.env.REZ_MODEL
        || (providerName === "ollama" ? OLLAMA_MODEL : LMSTUDIO_MODEL);

    if (!question) {
        if (jsonOnly) {
            writeJsonLine({
                ok: false,
                error: { code: "invalid_input", message: "question is required" },
                meta: makeMeta({
                    provider: providerName,
                    model: modelName,
                    latencyMs: Date.now() - startedAt,
                    usage: null,
                    kb: { enabled: process.env.REZ_USE_KB === "1", topK: flags.k, hits: 0 },
                }),
            });
            process.exit(1);
        }
        console.log('Usage: node apps/assistant/rez-ai.js [--print] [--json] [--k N] [--provider name] "question"');
        process.exit(1);
    }

    const systemPrompt = readSystemPrompt();
    try {
        transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.RUNNING);
        const { out, kb, reply } = await providerChat({
            systemPrompt,
            userText: question,
            k: flags.k,
            providerName,
            modelName,
            runtimeScope,
            runtimeTask,
        });
        transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.SUCCEEDED);

        const text = typeof reply === "string" ? reply : toAnswerText(out);

        const cacheDir = path.join(process.cwd(), "data", "cache");
        fs.mkdirSync(cacheDir, { recursive: true });

        const answerPath = path.join(cacheDir, "last_answer.txt");
        const responsePath = path.join(cacheDir, "last_response.json");

        fs.writeFileSync(answerPath, text, { encoding: "utf8" });
        fs.writeFileSync(responsePath, JSON.stringify(out, null, 2), { encoding: "utf8" });

        const resolvedModelName = out?.model_instance_id || out?.model || modelName;
        const usage = extractUsage(out);
        const totalMs = Date.now() - startedAt;

        if (jsonOnly) {
            writeJsonLine({
                ok: true,
                reply: text,
                meta: makeMeta({
                    provider: providerName,
                    model: resolvedModelName,
                    latencyMs: totalMs,
                    usage,
                    kb: {
                        enabled: kb?.enabled,
                        topK: kb?.topK,
                        hits: (kb?.hits || []).length,
                        mode: kb?.mode,
                        chunksUsed: Number.isFinite(kb?.chunksUsed) ? kb.chunksUsed : (kb?.hits || []).length,
                        semanticHits: Number.isFinite(kb?.semanticHits) ? kb.semanticHits : 0,
                        lexicalHits: Number.isFinite(kb?.lexicalHits) ? kb.lexicalHits : 0,
                        mergedHits: Number.isFinite(kb?.mergedHits) ? kb.mergedHits : 0,
                        citations: Array.isArray(kb?.citations) ? kb.citations : [],
                    },
                }),
            });
            return;
        }

        console.log(`Saved: ${path.relative(process.cwd(), answerPath)}`);
        console.log(`Model: ${resolvedModelName}`);
        if (flags.print) {
            console.log("\n--- REZ-AI ---\n");
            console.log(text);
        }
    } catch (e) {
        transitionRuntimeTaskState(runtimeTask, RUNTIME_TASK_STATES.FAILED);
        if (jsonOnly) {
            writeJsonLine({
                ok: false,
                error: {
                    code: e?.code || "assistant_failed",
                    message: e?.message || "Unknown error",
                },
                meta: makeMeta({
                    provider: providerName,
                    model: modelName,
                    latencyMs: Date.now() - startedAt,
                    usage: null,
                    kb: {
                        enabled: process.env.REZ_USE_KB === "1",
                        topK: flags.k,
                        hits: 0,
                        mode: "lexical",
                        chunksUsed: 0,
                        semanticHits: 0,
                        lexicalHits: 0,
                        mergedHits: 0,
                    },
                }),
            });
            process.exit(1);
            return;
        }
        throw e;
    }
}

main().catch((e) => {
    if (process.argv.includes("--json") || process.env.REZ_JSON_ONLY === "1") {
        writeJsonLine({
            ok: false,
            error: {
                code: e?.code || "assistant_failed",
                message: e?.message || "Unknown error",
            },
            meta: makeMeta({
                provider: (process.env.REZ_PROVIDER || DEFAULT_PROVIDER).toLowerCase(),
                model: process.env.REZ_MODEL || null,
                latencyMs: null,
                usage: null,
                kb: {
                    enabled: process.env.REZ_USE_KB === "1",
                    topK: 4,
                    hits: 0,
                    mode: "lexical",
                    chunksUsed: 0,
                    semanticHits: 0,
                    lexicalHits: 0,
                    mergedHits: 0,
                },
            }),
        });
        process.exit(1);
        return;
    }
    console.error("❌ REZ-AI failed:", e.message);
    process.exit(1);
});