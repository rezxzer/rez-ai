# REZ-AI MASTER PLAN (Free → Platform → Business)

Project Root: C:\Projects\rez-ai  
Mode: Local-first (Free development phase)  
Goal: Build powerful AI platform first. Monetize later.

---

# 🧭 VISION

REZ-AI = Modular AI Platform

Phase 1: Local Pro AI System  
Phase 2: Platform Layer (Accounts + Control)  
Phase 3: Business Layer (Optional Cloud Compute)

We build everything FREE first.
No business logic until core is stable.

---

# 🏗 CURRENT ARCHITECTURE (Baseline)

UI (apps/ui)
→ POST /api/chat
  - core fields: { message, systemPrompt, useKB }
  - optional fields: { provider, model, planMode }

Backend (server.js)
→ spawn apps/assistant/rez-ai.js
→ passes env:
   - REZ_SYSTEM_PROMPT
   - REZ_USE_KB

Assistant (rez-ai.js)
→ builds messages array
→ optional KB inject
→ calls selected provider runtime (LM Studio working / Ollama env-dependent; remote_openai disabled stub)
Provider abstraction clarification:
- Providers represent inference runtimes rather than specific tools.
- Current local runtimes (`lmstudio`, `ollama`) are interchangeable implementations of the provider layer.
- `remote_openai` is a compatibility stub for remote-provider behavior validation, not a production cloud integration.
- Future hosted/cloud inference runtimes are expected to connect through the same provider abstraction without breaking runtime/API contract boundaries.
→ writes cache
→ prints stdout

Persistence:
localStorage['rez-ai-chats-v1']

---

# 🔥 PHASE 1 — STABILITY & FOUNDATION (Priority P0)

Goal: Make system production-stable before scaling features.

## 1.1 Backend Process Safety
- Add child kill timeout (25s max)
- Kill child on request abort
- Add concurrency limit (max 2 active requests)
- Return 429 when busy

## 1.2 Structured JSON Contract
Replace stdout text parsing with:
{
  ok: boolean,
  reply: string,
  model: string,
  usage?: object,
  latencyMs: number,
  error?: string
}

Assistant must support:
--print-json flag

Backend must:
Parse JSON only
Return safe error messages

## 1.3 Health Monitoring
Add endpoint:
GET /health/lm

Backend pings LM Studio:
- lightweight check
- returns { ok:true, modelLoaded:true }

UI must reflect real status (not static label)

---

# 🧠 PHASE 2 — KB/RAG v1 (Free Intelligence Upgrade)

Goal: Make "Use KB" real and scalable.

## 2.1 KB Source
data/kb/
  *.md
  *.txt

## 2.2 KB Build Pipeline
Script: scripts/kb_build.js

- Read files
- Chunk (700 chars, overlap 120)
- Write data/cache/kb.json
- Print stats

## 2.3 Retrieval v1
- Keyword tokenize/score/top-k
- Inject context ONLY if REZ_USE_KB=1

## 2.4 UI Wiring
- useKB toggle controls request field
- backend passes REZ_USE_KB
- assistant conditionally loads KB

---

# 🚀 PHASE 3 — KB/RAG v2 (Embeddings)

Goal: Upgrade retrieval quality.

## 3.1 Embedding Source Decision

Primary provider:
- LM Studio embeddings endpoint (OpenAI-compatible) as default for local-first parity with current stack.

Fallback provider:
- Ollama embeddings endpoint (optional fallback) when LM Studio embedding endpoint is unavailable.

Why:
- Local-compatible, no cloud dependency.
- Reuses existing provider/base URL pattern already used across backend/assistant boundaries.

Planned env keys:
- `REZ_EMBED_PROVIDER` (default: `lmstudio`, allowed: `lmstudio|ollama`)
- `REZ_EMBED_MODEL` (default: local embedding model name)
- `REZ_PROVIDER_LMSTUDIO_BASE_URL` (already exists; reused)
- `REZ_PROVIDER_OLLAMA_BASE_URL` (already exists; reused)
- `REZ_EMBED_TIMEOUT_MS` (default: `8000`)

## 3.2 Vector Store Design (Local)

Storage location:
- `data/cache/` (same local cache boundary as current KB artifacts).

Planned files:
- Keep `data/cache/kb.json` as source chunks + metadata.
- Add `data/cache/kb_vectors.json` for embedding vectors and retrieval index metadata.

Schema (example):
```json
{
  "version": 2,
  "builtAt": "2026-03-02T00:00:00.000Z",
  "embed": {
    "provider": "lmstudio",
    "model": "text-embedding-model",
    "dim": 768
  },
  "items": [
    {
      "id": "kb_0001",
      "source": "data/kb/intro.md",
      "chunk": "....",
      "tokensApprox": 120,
      "vector": [0.0123, -0.0441]
    }
  ]
}
```

Design note:
- Reuse and extend `scripts/kb_build.js` (no duplicate builder pipeline).

## 3.3 Retrieval Pipeline v2 (Hybrid)

Query flow:
1. Build lexical score (existing keyword tokenize/score).
2. Build semantic score (embedding cosine similarity).
3. Combine into hybrid score: `final = lexicalWeight * lexical + semanticWeight * semantic`.
4. Select top-k (default `k=4`) with max context cap (~2500 chars preserved).

Planned defaults:
- `lexicalWeight = 0.35`
- `semanticWeight = 0.65`
- `topK = 4`

Fallback behavior:
- If embedding generation fails, vector index missing, or provider unavailable:
  - auto-fallback to existing keyword-only retrieval (v1 behavior).
- If `REZ_USE_KB=0`:
  - skip both lexical and semantic retrieval, keep current no-KB behavior.

## 3.4 Citation Format (Assistant Output)

Assistant response rule:
- Keep normal answer body.
- Append `Sources` section only when KB is used and at least one chunk is selected.

Example format:
```text
Answer:
<assistant final answer>

Sources:
- [S1] data/kb/intro.md (chunk: kb_0001)
- [S2] data/kb/faq.md (chunk: kb_0007)
```

Boundary rule:
- Citation assembly happens in assistant response composition layer; backend contract remains JSON-stable.

## 3.5 Phase 3 Acceptance Criteria (Explicit DoD)

Phase 3 is DONE only if all pass:
- [x] `npm run kb:build` generates vectorized cache artifact (`kb_vectors.json`) with provider/model metadata.
- [x] Retrieval uses hybrid scoring (lexical + semantic) and returns top-k deterministically.
- [x] `REZ_USE_KB=0` preserves existing non-KB behavior (no context injection).
- [x] Embedding failure path falls back to keyword-only retrieval without crashing request flow.
- [x] KB citations are exposed in `meta.kb.citations` and UI Sources panel is shown only when citations exist.
- [x] Existing boundaries unchanged:
  - UI -> backend request contract stable
  - backend -> assistant spawn/env boundary stable
  - assistant -> backend JSON output stable
- [x] Manual checks recorded in `docs/REZ_AI_UI_PROGRESS.md` after implementation.

---

# 🛠 PHASE 4 — Workflow Tools

Goal: Turn REZ-AI into productivity engine.

Architecture guardrails for Phase 4:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new pages, no new backend endpoints, no contract rewrite.
- Workflow features must be prompt/payload-level improvements over existing UI controls.

## 4.1 Scope (Small Tools, Existing UI Only)

### Tool A — Guided Plan Mode (Plan -> Next Step Loop)
User-facing behavior:
- User clicks `Plan` to generate a short actionable plan, then clicks `Next step` to get exactly one small task.
- Keeps execution iterative without leaving current chat.
Uses existing UI area:
- `QUICK ACTIONS` workflow buttons + existing composer.
Payload fields:
- Reuses existing `/api/chat` payload (`message`, `systemPrompt`, `useKB`, `provider`, `model`), no new required fields.

### Tool B — Task Extractor to Checklist
User-facing behavior:
- User clicks `Extract tasks` and gets prioritized actionable checklist from recent conversation context.
- Intended for converting long chats into concrete TODOs.
Uses existing UI area:
- `QUICK ACTIONS` button + existing markdown-lite message view.
Payload fields:
- Existing payload only; prompt template drives behavior.

### Tool C — Cursor Prompt Generator (Safe Handoff)
User-facing behavior:
- User clicks `Cursor prompt` and gets a ready-to-use implementation prompt with scope/constraints/output format.
- Improves consistency of agent handoff.
Uses existing UI area:
- `QUICK ACTIONS` button + composer prefill.
Payload fields:
- Existing payload only; no API schema changes.

### Tool D — Memory Note Builder + KB Append Loop
User-facing behavior:
- User clicks `Generate from chat` to create structured notes, then `Save notes to KB (append)` for persistence.
- Supports repeatable "summarize -> save -> rebuild KB" workflow.
Uses existing UI area:
- `MEMORY` panel actions already present.
Payload fields:
- Existing `/api/kb/append` body (`chatId`, `title`, `notes`) unchanged.

## 4.2 Phase 4 Acceptance Criteria (Explicit DoD)

Phase 4 is DONE only if all pass:
- [x] All scoped tools (A-D) are usable from current sidebar sections (Quick Actions / Memory) with no new page.
- [x] All tools call existing backend contracts only (`/api/chat`, `/api/kb/append`) without breaking payload compatibility.
- [x] Per-chat prompt behavior remains isolated (preset/prompt changes in one chat do not leak to others).
- [x] Workflow outputs are consistent across provider switch (LM Studio / Ollama) without UI crashes.
- [x] Notes workflow remains safe: generate notes, append to KB, and keep existing manual rebuild step.
- [x] Existing model stats, retry, timeout, and persistence behavior remain intact.
- [x] Manual checks are recorded in `docs/REZ_AI_UI_PROGRESS.md`.

## 4.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Harden Workflow Prompt Templates
Scope:
- Refine existing prompt templates (`Plan`, `Next step`, `Extract tasks`, `Cursor prompt`) for deterministic structure.
Manual verify:
- Click each workflow button and confirm input prefill has stable, scoped instruction format.
- Send generated prompt and confirm response structure matches expected intent.

### Step 2 — Tighten Per-Chat Prompt/Workflow Cohesion
Scope:
- Ensure active chat preset + system prompt are always the source for workflow generation.
Manual verify:
- Switch between chats with different presets; generated workflow prompts must reflect active chat only.
- Refresh page; confirm persisted state preserves behavior.

### Step 3 — Memory Workflow Completion Pass
Scope:
- Validate `Generate from chat` -> notes edit -> `Save notes to KB (append)` loop as one guided flow.
Manual verify:
- Generate notes, save to KB, confirm success notice and rebuild helper path.
- Confirm no regression in notes export/copy actions.

### Step 4 — End-to-End Workflow Reliability Check
Scope:
- Run workflow tools under both providers with existing timeout/retry protections.
Manual verify:
- Execute all workflow buttons once on LM Studio and once on Ollama.
- Confirm no contract errors in UI and no new critical console/runtime errors.

---

# 🧱 PHASE 5 — Platform Layer (Still Free)

Goal: Prepare for business without charging.

Still local compute. No cloud auth rollout in this phase.

Architecture guardrails for Phase 5:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new backend service, no new app pages, no contract break.
- Any new fields must be optional and backward-compatible.

## 5.1 Scope (Preparation Only, Existing UI/Backend)

### Item A — Local Identity Profile (client-side)
User-facing behavior:
- User can set a local profile label (name + optional role) used for personalization context.
- Profile is saved locally and can be edited anytime.
Uses existing UI area:
- Existing sidebar/settings-style controls (no new page).
Payload compatibility:
- Optional metadata in `/api/chat` request only (e.g. `profile`), ignored safely when absent.

### Item B — Usage Snapshot (session-level)
User-facing behavior:
- User sees lightweight session usage summary (messages count, requests, estimated token totals).
- Stats reset stays local per browser/session controls.
Uses existing UI area:
- Existing stats/model panel and local state.
Payload compatibility:
- No required API changes; computed from current UI + existing `meta.usage`.

### Item C — Role Mode (local access posture)
User-facing behavior:
- User can toggle local role mode (e.g. `owner`, `viewer`) that adjusts workflow affordances only in UI.
- Prevents accidental actions in viewer mode (soft local guard).
Uses existing UI area:
- Existing sidebar controls near presets/workflows.
Payload compatibility:
- Optional hint field can be passed to `/api/chat`; backend/assistant remain compatible if missing.

### Item D — Feature Flags (local)
User-facing behavior:
- User can enable/disable advanced workflow features from local flags.
- Flags are persisted and applied instantly without reload.
Uses existing UI area:
- Existing Quick Actions / Memory / provider-side controls (no routing changes).
Payload compatibility:
- No required contract changes; flags gate UI behavior and optional prompt hints only.

## 5.2 Phase 5 Acceptance Criteria (Explicit DoD)

Phase 5 is DONE only if all pass:
- [x] All scoped items (A-D) work from existing UI sections without creating new pages.
- [x] `/api/chat` and `/api/kb/append` remain backward-compatible (no required new fields).
- [x] Existing provider flow (LM Studio/Ollama), retry, timeout, and stats continue to work unchanged.
- [x] Local profile/role/flags persist reliably across refresh.
- [x] Role/flag controls affect UI behavior predictably without runtime errors.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

Status: **PHASE 5 DoD — PASS**

## 5.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Local profile + storage wiring
Scope:
- Add local profile state and persistence using existing localStorage utilities/patterns.
Manual verify:
- Set profile, refresh page, confirm value is restored.
- Send chat and confirm no regression in normal request flow.

### Step 2 — Usage snapshot in existing stats area
Scope:
- Expose lightweight session usage counters from already available UI/meta data.
Manual verify:
- Send multiple prompts and confirm counters increment consistently.
- Provider switch does not reset unexpectedly unless explicitly requested.

### Step 3 — Role mode soft guard (UI-only)
Scope:
- Add local role switch and disable selected high-impact actions in viewer mode.
Manual verify:
- Toggle role and confirm guarded actions are visually disabled/enabled correctly.
- Core chat remains usable.

### Step 4 — Local feature flags
Scope:
- Add small local flag set controlling advanced workflow actions visibility/availability.
Manual verify:
- Toggle flags and confirm affected controls respond immediately.
- No impact on baseline chat contract or backend stability.

---

# 💰 PHASE 6 — Business Layer (Later)

Goal: Add monetization-ready controls while keeping current product flow stable.

Brief summary of existing Phase 6 intent (from prior notes):
- Start only after system is stable.
- Keep three commercial paths open: Local Pro License, BYOK, Cloud Compute.
- Add business safety basics: billing integration, stronger limits, restricted origins, abuse protection.

Architecture guardrails for Phase 6:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new app/pages/services; all controls live in existing sidebar/settings/quick-actions areas.
- Keep `/api/chat` response contract backward-compatible; new fields must be optional.
- No hard auth enforcement by default in this phase; paid-path checks are soft-gated by flags/profile/state first.

## 6.1 Scope (Business-Ready Within Existing Architecture)

### Item A — Plan mode (Local Free/Pro state)
User-facing behavior:
- User can switch local plan mode (`free` / `pro`) for feature simulation and UI gating.
- Pro-only affordances are visible but clearly marked when unavailable.
Uses existing UI area:
- Existing sidebar controls and Quick Actions panel (no new route/page).
Payload compatibility:
- Optional request hint (e.g. `planMode`) may be sent to `/api/chat`; backend ignores safely when absent.

### Item B — BYOK provider keys (local only)
User-facing behavior:
- User can store provider API key references locally and choose BYOK mode without forcing cloud path.
- Missing/invalid key shows readable UI warning; chat fallback remains available where applicable.
Uses existing UI area:
- Existing provider/model controls + settings-like sidebar blocks.
Payload compatibility:
- Optional metadata in existing chat payload only; no required schema change for current requests.

### Item C — Cloud compute toggle (soft launch posture)
User-facing behavior:
- User can enable/disable cloud-compute option locally for readiness testing.
- When disabled, cloud options are hidden/disabled; local providers continue unchanged.
Uses existing UI area:
- Existing provider selector + model stats/health context.
Payload compatibility:
- Optional provider hint only; existing providers remain default behavior and contract-compatible.

### Item D — Business safety controls baseline
User-facing behavior:
- User sees predictable limits/error messages for paid-path safety (rate/cors/abuse posture visibility).
- Existing free/local workflow stays usable with no surprise lockouts.
Uses existing UI area:
- Existing status/error surfaces and current backend endpoints.
Payload compatibility:
- No mandatory new request fields; safety controls applied server-side with backward-compatible responses.

## 6.2 Phase 6 Acceptance Criteria (Explicit DoD)

Phase 6 is DONE only if all pass:
- [x] All scoped items (A-D) work through existing UI sections and current backend endpoints.
- [x] `/api/chat` contract remains backward-compatible for both local and business-ready paths.
- [x] BYOK/cloud toggles do not break LM Studio/Ollama local provider flow.
- [x] Plan/safety controls behave predictably and fail gracefully with readable errors.
- [x] Rate/CORS/abuse hardening changes are additive and do not regress current UX flows.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

Status: **PHASE 6 DoD — PASS**

## 6.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Plan mode scaffold (UI + optional hint)
Scope:
- Add local `free/pro` mode state and persistence, with soft UI gating only.
Manual verify:
- Toggle plan mode and confirm relevant controls change state without page reload.
- Send normal chats in both modes and confirm no contract regression.

### Step 2 — BYOK readiness (local settings + provider path safety)
Scope:
- Add local BYOK setting hooks and safe validation messaging without forcing cloud usage.
Manual verify:
- Enter missing/invalid key scenario and confirm clear, non-crashing warning.
- Keep local provider chat flow working unchanged when BYOK is off.

### Step 3 — Cloud compute soft toggle + provider compatibility
Scope:
- Add local cloud toggle that controls option visibility/availability only.
Manual verify:
- Toggle cloud option on/off and confirm provider list/UI behavior updates predictably.
- Confirm LM Studio/Ollama remain functional regardless of cloud toggle state.

### Step 4 — Business safety hardening pass (additive)
Scope:
- Apply additive safety controls (rate posture, origin restriction readiness, abuse checks) without contract break.
Manual verify:
- Validate protected paths return stable structured errors when limits are hit.
- Confirm baseline free/local chat flow still works under normal usage.

---

# 🧭 PHASE 7 — Operational Maturity (Within Current Stack)

Goal: Make the platform easier to operate day-to-day without changing architecture.

Brief summary of existing Phase 7 intent (from current document text):
- `CURRENT NEXT STEP` already points to implementing Phase 7.
- Existing vision emphasizes modular, local-first evolution with business readiness layered in.
- Existing milestone goals emphasize "project brain" workflows and repeatable outputs; Phase 7 extends that into operational reliability and controls.

Architecture guardrails for Phase 7:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; use existing sidebar, stats, and current endpoints.
- Keep `/api/chat` contract backward-compatible; only additive optional fields if needed.
- No hard enforcement by default unless explicitly enabled by existing local controls.

## 7.1 Scope (Operational Layer, Existing Surfaces Only)

### Item A — Local operations snapshot (read-only)
User-facing behavior:
- User sees concise operational snapshot (request success/fail mix, recent latency trend, provider distribution).
- Snapshot is local and optional; does not block any workflow.
Uses existing UI area:
- Existing Model Stats / status area and sidebar cards.
Payload compatibility:
- No required request changes; can reuse existing usage log and current response meta.

### Item B — Guardrail visibility controls (soft)
User-facing behavior:
- User can toggle visibility of guardrails/warnings (rate/auth/provider hints) to reduce noise or increase safety visibility.
- Warnings remain informational; no forced blocking path introduced.
Uses existing UI area:
- Existing Quick Actions / status/error display surfaces.
Payload compatibility:
- Optional UI-only state; backend payloads remain compatible when absent.

### Item C — Provider fallback preference (local)
User-facing behavior:
- User can set local fallback preference order (e.g. LM Studio first, Ollama second) for soft guidance.
- If preferred provider is unavailable, UI suggests fallback predictably.
Uses existing UI area:
- Existing provider selector and health status panel.
Payload compatibility:
- Optional hint only; existing provider request fields remain valid and unchanged.

### Item D — Readiness checklist mode (doc-backed)
User-facing behavior:
- User can run a compact readiness checklist flow (health, limits, auth scaffold, KB mode) before release-like testing.
- Output is summary-oriented and non-destructive.
Uses existing UI area:
- Existing status/quick actions and documentation-driven checks.
Payload compatibility:
- No required API contract changes; checklist uses existing endpoints.

## 7.2 Phase 7 Acceptance Criteria (Explicit DoD)

Phase 7 is DONE only if all pass:
- [x] All scoped items (A-D) are delivered through existing UI sections and existing backend endpoints.
- [x] `/api/chat` response contract stays backward-compatible; additions are optional only.
- [x] Provider fallback/readiness flows do not break LM Studio/Ollama baseline chat behavior.
- [x] Operational snapshot and guardrail visibility are stable across refresh and do not cause runtime errors.
- [x] Any new warnings/checklist outputs are informative and non-blocking by default.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

Status: **PHASE 7 DoD — PASS**

## 7.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Operations snapshot card (UI-only)
Scope:
- Add compact operational snapshot derived from existing local data/meta.
Manual verify:
- Send multiple requests and confirm snapshot values update consistently.
- Refresh page and confirm persisted snapshot-related state behaves predictably.

### Step 2 — Guardrail visibility toggles (soft)
Scope:
- Add local toggles controlling visibility of warning/hint layers only.
Manual verify:
- Toggle settings and confirm warning surfaces show/hide immediately.
- Core chat request flow remains unchanged regardless of toggle state.

### Step 3 — Provider fallback preference hinting
Scope:
- Add local preferred fallback ordering and apply it as non-blocking suggestion behavior.
Manual verify:
- Simulate unreachable preferred provider and confirm fallback suggestion appears.
- Select fallback provider and confirm normal chat continues.

### Step 4 — Readiness checklist pass (existing endpoints)
Scope:
- Add a small readiness runbook/checklist flow using current endpoints and UI surfaces.
Manual verify:
- Run checklist and confirm each check reports pass/fail with readable output.
- Confirm no contract changes are required for normal `/api/chat` use.

---

# 🧭 PHASE 8 — Release Readiness (No Architecture Changes)

Goal: Prepare the current stack for repeatable release checks and safer day-to-day operation.

Brief summary of existing Phase 8 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 8.
- No dedicated Phase 8 block existed yet; this section formalizes the next execution scope while keeping the current architecture and compatibility rules.

Architecture guardrails for Phase 8:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; use existing sidebar, stats, status, and current endpoints.
- Keep `/api/chat` response contract backward-compatible; any additions must be optional.
- Keep all controls soft and non-blocking by default unless explicitly enabled later.

## 8.1 Scope (Release Readiness in Existing Surfaces)

### Item A — Release preflight checklist (UI-assisted)
User-facing behavior:
- User can run a concise preflight list (backend health, provider reachability, KB mode, limits posture).
- Checklist reports pass/warn states without interrupting normal chat usage.
Uses existing UI area:
- Existing status area, Model Stats card, and Quick Actions section.
Payload compatibility:
- No required payload changes; checks rely on existing endpoints and existing response fields.

### Item B — Session sanity report (local export-ready summary)
User-facing behavior:
- User can view a compact session summary for validation runs (ops window counters, provider usage mix, recent warnings).
- Summary is local and optional; intended for manual release verification.
Uses existing UI area:
- Existing Model Stats / Ops snapshot surfaces and local notices.
Payload compatibility:
- No required API changes; derived from already available local/meta data.

### Item C — Soft compatibility warnings (non-blocking)
User-facing behavior:
- User sees explicit warnings when selected settings combinations are risky (e.g. unavailable provider + fallback mismatch).
- Warnings suggest corrective action but never hard-block sending by default.
Uses existing UI area:
- Existing warning/toast/status hint surfaces in sidebar/chat header.
Payload compatibility:
- UI-only additive behavior; backend contract unchanged.

### Item D — Repeatable manual verification flow
User-facing behavior:
- User can follow a stable, short verification flow before release-like testing.
- Flow references current capabilities only (health checks, chat response shape, ops metrics persistence).
Uses existing UI area:
- Existing documentation + current UI controls/endpoints.
Payload compatibility:
- No new required request fields; normal contracts stay backward-compatible.

## 8.2 Phase 8 Acceptance Criteria (Explicit DoD)

Phase 8 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented through existing UI sections and existing backend endpoints.
- [x] `/api/chat` and related UI handling remain backward-compatible; no contract break.
- [x] Preflight/sanity/warning flows are non-blocking and do not regress baseline chat behavior.
- [x] Local persistence for release-readiness signals is stable across refresh.
- [x] Manual verification flow is documented and repeatable from current project docs.
- [x] Manual checks are recorded in `docs/REZ_AI_UI_PROGRESS.md`.

Status: **PHASE 8 DoD — PASS**

## 8.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Preflight checklist surface
Scope:
- Add a compact preflight checklist UI using existing health/provider/contract signals.
Manual verify:
- Run checklist and confirm pass/warn output updates correctly.
- Confirm chat remains usable while checklist is visible.

### Step 2 — Session sanity summary
Scope:
- Add local summary view for release run signals (ops totals/window/provider mix/warnings).
Manual verify:
- Generate activity and confirm summary values reflect current session state.
- Refresh and confirm persisted summary signals restore predictably.

### Step 3 — Soft compatibility hint layer
Scope:
- Add non-blocking compatibility hints for risky setting/provider combinations.
Manual verify:
- Trigger a risky combination and confirm clear suggestion appears.
- Apply suggested adjustment and confirm normal chat flow continues.

### Step 4 — Final readiness runbook sync (docs + UI mapping)
Scope:
- Finalize a short repeatable readiness flow mapped to existing UI controls/endpoints.
Manual verify:
- Execute the runbook steps end-to-end and confirm expected outcomes are observable.
- Confirm no new endpoint/contract requirement is introduced.

---

# 🧭 PHASE 9 — Hardening & Drift Control (Current Stack)

Goal: Keep the platform stable under real usage drift while preserving current contracts and flow.

Brief summary of existing Phase 9 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 9.
- No dedicated Phase 9 block existed yet; this section formalizes a hardening-focused phase without introducing new architecture.

Architecture guardrails for Phase 9:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; build on existing sidebar/status/stats and current endpoints.
- Keep `/api/chat` request/response contract backward-compatible; additive optional fields only.
- Keep all new checks/hints non-blocking by default unless explicitly enabled later.

## 9.1 Scope (Hardening Without Architecture Changes)

### Item A — Contract drift watch (UI + backend signal sanity)
User-facing behavior:
- User gets clear visibility when runtime responses deviate from expected stable fields.
- Drift signals remain informative and do not block message sending.
Uses existing UI area:
- Existing preflight/snapshot/status surfaces.
Payload compatibility:
- No required contract changes; uses existing response/meta fields and optional local diagnostics.

### Item B — Provider stability posture (soft fallback confidence)
User-facing behavior:
- User can see whether selected provider path is stable over recent requests (pass/warn posture).
- Suggestions for safer provider path are actionable but optional.
Uses existing UI area:
- Existing provider selector, fallback controls, and warnings.
Payload compatibility:
- No required API changes; computed from existing health checks and local session signals.

### Item C — Session recovery helpers (local)
User-facing behavior:
- User can quickly recover from unstable session state via local reset helpers (non-destructive where possible).
- Recovery helpers improve reliability without changing backend behavior.
Uses existing UI area:
- Existing Model Stats / Quick Actions controls.
Payload compatibility:
- UI-only/local state handling; backend contract remains unchanged.

### Item D — Release-grade manual verification pack
User-facing behavior:
- User can run a concise repeatable hardening verification set before release-like runs.
- Verification output is human-readable and based on existing endpoints/signals.
Uses existing UI area:
- Existing preflight/checklist/status areas and project docs.
Payload compatibility:
- No required new request fields; all checks rely on current contracts and endpoints.

## 9.2 Phase 9 Acceptance Criteria (Explicit DoD)

Phase 9 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented using existing UI surfaces and existing backend endpoints.
- [x] `/api/chat` and UI response handling remain backward-compatible (no contract break).
- [x] Drift/stability/recovery helpers remain non-blocking and do not regress normal chat flow.
- [x] Provider stability and fallback hints remain predictable across refresh/session changes.
- [x] Manual hardening verification pack is repeatable from project docs and UI controls.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

Status: **PHASE 9 DoD — PASS**

## 9.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Contract drift indicators (soft)
Scope:
- Add compact drift indicators for expected response fields using existing runtime signals.
Manual verify:
- Trigger normal chats and confirm indicators remain pass/green for expected shape.
- Simulate degraded conditions and confirm warning indicators appear without blocking chat.

### Step 2 — Provider stability summary
Scope:
- Add lightweight recent stability summary for selected provider/fallback path.
Manual verify:
- Run multiple requests and confirm stability posture updates from recent outcomes.
- Switch provider and confirm summary recalculates correctly.

### Step 3 — Session recovery actions (local, non-destructive)
Scope:
- Add local recovery helpers for unstable UI/session state (soft reset flows).
Manual verify:
- Trigger recovery action and confirm local state resets as documented.
- Confirm chat still works immediately after recovery action.

### Step 4 — Hardening verification pack closeout
Scope:
- Finalize and align the hardening verification sequence with current UI and docs.
Manual verify:
- Execute checklist end-to-end and confirm each check is observable and repeatable.
- Confirm no new API contract or endpoint requirement is introduced.

---

# 🧭 PHASE 10 — Consistency & Maintenance Loop (Current Stack)

Goal: Keep product behavior consistent over time with lightweight maintenance loops and no architecture changes.

Brief summary of existing Phase 10 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 10.
- No dedicated Phase 10 section existed yet; this block formalizes the next maintenance-focused phase inside current boundaries.

Architecture guardrails for Phase 10:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend existing sidebar, stats, preflight, and status surfaces only.
- Keep `/api/chat` request/response contract backward-compatible; additions must remain optional.
- Keep checks/hints/recovery flows soft and non-blocking by default.

## 10.1 Scope (Consistency Layer, Existing Surfaces Only)

### Item A — Stability trend visibility (local)
User-facing behavior:
- User can see short-term trend posture (improving/stable/degrading) from recent outcomes.
- Trend is informational and helps decide when to switch provider/fallback.
Uses existing UI area:
- Existing Model Stats / Ops / Provider stability area.
Payload compatibility:
- No required payload changes; computed from existing local metrics and response metadata.

### Item B — Maintenance reminders (soft, local)
User-facing behavior:
- User receives gentle reminders for maintenance actions (rerun preflight, clear stale warnings, re-check provider health).
- Reminders never block chat and can be ignored safely.
Uses existing UI area:
- Existing Preflight card, notice/toast, and quick actions hints.
Payload compatibility:
- UI-only/local logic; backend contracts remain unchanged.

### Item C — Drift recovery guidance (actionable, non-blocking)
User-facing behavior:
- When drift/warn posture appears, user gets clear next-step guidance tied to existing controls.
- Applying guidance remains optional and reversible.
Uses existing UI area:
- Existing Contract drift, compatibility hints, and recovery action controls.
Payload compatibility:
- No required API contract changes; based on existing runtime signals.

### Item D — Repeatable maintenance runbook
User-facing behavior:
- User can execute a short recurring maintenance loop to keep environment healthy.
- Results are human-readable and mapped to current controls/endpoints.
Uses existing UI area:
- Existing docs + preflight/status/model stats sections.
Payload compatibility:
- No new required request fields; all checks stay within current endpoint contracts.

## 10.2 Phase 10 Acceptance Criteria (Explicit DoD)

Phase 10 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI sections and current backend endpoints.
- [x] `/api/chat` contract and existing chat UX remain backward-compatible.
- [x] Trend/reminder/guidance layers are non-blocking and do not regress normal chat flow.
- [x] Maintenance signals remain stable across refresh and local session changes.
- [x] Runbook steps are repeatable and observable using current controls/endpoints.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

Status: **PHASE 10 DoD — PASS**

## 10.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Stability trend indicator (soft)
Scope:
- Add compact trend signal derived from recent local outcomes (no new backend dependency).
Manual verify:
- Generate mixed success/fail runs and confirm trend changes accordingly.
- Confirm trend display does not block chat actions.

### Step 2 — Maintenance reminder cues
Scope:
- Add local reminder cues tied to existing preflight/stability signals.
Manual verify:
- Trigger stale/warn conditions and confirm reminder appears.
- Dismiss/ignore reminder and confirm chat continues normally.

### Step 3 — Guided recovery suggestions
Scope:
- Add explicit next-step guidance for drift/stability warning states using existing controls.
Manual verify:
- Trigger warning state and confirm suggested action appears clearly.
- Apply suggestion and confirm state improves without contract changes.

### Step 4 — Maintenance runbook closeout
Scope:
- Finalize recurring maintenance checklist mapped to current UI + docs.
Manual verify:
- Execute runbook end-to-end and confirm each step is observable.
- Confirm no new endpoint or contract requirement is introduced.

---

# 🧭 PHASE 11 — Quality Guardrails Loop (Current Stack)

Goal: Raise day-to-day quality confidence with lightweight guardrails and repeatable checks, without architecture changes.

Brief summary of existing Phase 11 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 11.
- No dedicated Phase 11 block existed yet; this section formalizes the next quality-guardrails phase inside existing system boundaries.

Architecture guardrails for Phase 11:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; use existing preflight/status/stats/sidebar surfaces.
- Keep `/api/chat` request/response contract backward-compatible; additions stay optional.
- Keep all hints/checks/recovery actions non-blocking by default.

## 11.1 Scope (Quality Guardrails, Existing Surfaces)

### Item A — Signal confidence badges (soft)
User-facing behavior:
- User sees compact confidence badges for key runtime signals (contract, provider stability, trend health).
- Badges are informative only and do not prevent sending chats.
Uses existing UI area:
- Existing Model Stats + Preflight area.
Payload compatibility:
- No required payload changes; computed from existing local/meta runtime data.

### Item B — Smart reminder frequency control (local)
User-facing behavior:
- User avoids reminder fatigue via lightweight local cooldown/dedupe behavior for repeated warnings.
- Critical warnings still appear when state materially changes.
Uses existing UI area:
- Existing reminder/preflight hint lines and local dismiss actions.
Payload compatibility:
- UI-only local state; backend contract remains unchanged.

### Item C — Recovery effectiveness feedback
User-facing behavior:
- After running recovery actions, user sees whether posture improved (e.g., warn -> pass) in a compact way.
- Feedback remains advisory and non-blocking.
Uses existing UI area:
- Existing guided recovery + stability/contract indicators.
Payload compatibility:
- No required new fields; evaluation uses current local signals.

### Item D — Repeatable quality check pack
User-facing behavior:
- User can run a short recurring quality-check set (preflight + drift + provider posture + recovery verification).
- Results are readable and reproducible for release hygiene.
Uses existing UI area:
- Existing docs and current UI controls/endpoints.
Payload compatibility:
- No new required endpoint/contract behavior; relies on current contracts.

## 11.2 Phase 11 Acceptance Criteria (Explicit DoD)

Phase 11 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI sections and current backend endpoints.
- [x] `/api/chat` contract and baseline chat flow remain backward-compatible.
- [x] Confidence/reminder/recovery feedback layers stay non-blocking and stable.
- [x] Reminder dedupe/cooldown behavior persists predictably across refresh.
- [x] Quality-check pack is repeatable and observable using current controls/endpoints.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

Status: PHASE 11 DoD — PASS

## 11.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Confidence badges pass
Scope:
- Add compact signal-confidence badges for existing drift/stability/trend outputs.
Manual verify:
- Generate normal traffic and confirm badges stay in healthy posture.
- Trigger warning conditions and confirm badges downgrade without blocking chat.

### Step 2 — Reminder dedupe/cooldown
Scope:
- Add local cooldown/deduping for repeated reminder cues from unchanged warning states.
Manual verify:
- Keep same warning state active and confirm reminders do not spam repeatedly.
- Change warning state and confirm a new reminder appears appropriately.

### Step 3 — Recovery feedback indicator
Scope:
- Add compact before/after feedback when guided recovery actions are applied.
Manual verify:
- Trigger warning state, apply recovery action, and confirm feedback indicates improvement/no-change.
- Confirm feedback is informational only and does not alter endpoint contracts.

### Step 4 — Quality-check pack closeout
Scope:
- Finalize and align recurring quality-check sequence with existing UI controls/docs.
Manual verify:
- Execute the sequence end-to-end and confirm each check is visible/repeatable.
- Confirm no new endpoint or contract requirement is introduced.

---

# 🧭 PHASE 12 — Operator Confidence Pack (Current Stack)

Goal: Make day-to-day operation safer and faster by tightening signal clarity and recovery confidence using existing UI + endpoints only.

Brief summary of existing Phase 12 intent (from current document text):
- `CURRENT NEXT STEP` already points to implementing Phase 12.
- No dedicated Phase 12 block existed yet; this section formalizes the next iteration within the same architecture boundaries.

Architecture guardrails for Phase 12:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend existing Model Stats + Preflight + Guided recovery surfaces.
- Keep `/api/chat` request/response contract backward-compatible; additions remain optional.
- Keep all indicators/reminders/recovery helpers informational and non-blocking by default.

## 12.1 Scope (Confidence Operations, Existing Surfaces)

### Item A — Signal snapshot strip (soft)
User-facing behavior:
- User sees one compact snapshot line combining key posture signals (contract, provider stability, trend, reminder state).
- Snapshot is readable at a glance and does not interrupt chat flow.
Uses existing UI area:
- Existing Model Stats + Preflight card.
Payload compatibility:
- No required payload changes; derived from existing local UI/runtime state.

### Item B — Recovery outcome memory (local)
User-facing behavior:
- User can see most recent recovery outcome state (improved / no-change / regressed) across refresh.
- Outcome remains advisory and does not auto-trigger actions.
Uses existing UI area:
- Existing Guided recovery + Recovery feedback line.
Payload compatibility:
- UI-only local persistence; backend contracts unchanged.

### Item C — Warning-state change marker
User-facing behavior:
- User gets a compact marker when warning state materially changes (same warning, new warning, cleared warning).
- Helps distinguish stale repeats from meaningful state changes.
Uses existing UI area:
- Existing Reminder / Preflight hint lines.
Payload compatibility:
- No required endpoint changes; computed from current warning signatures and local timestamps.

### Item D — Repeatable operator check sequence v2
User-facing behavior:
- User can run a short, repeatable manual loop: preflight -> review drift/stability/snapshot -> apply guided recovery -> verify feedback.
- Sequence is explicit and easy to rerun before release decisions.
Uses existing UI area:
- Existing Preflight controls, Model Stats rows, and guided recovery actions.
Payload compatibility:
- No new required endpoint/contract behavior; uses current controls/endpoints.

## 12.2 Phase 12 Acceptance Criteria (Explicit DoD)

Phase 12 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented through existing UI sections and current backend endpoints.
- [x] `/api/chat` contract and baseline chat flow remain backward-compatible.
- [x] Snapshot/reminder/recovery layers remain informational and non-blocking.
- [x] Local state signals (cooldowns/outcomes/markers) persist predictably across refresh.
- [x] Operator check sequence is repeatable and observable without new architecture.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

Status: PHASE 12 DoD — PASS

## 12.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Signal snapshot strip
Scope:
- Add one compact snapshot strip combining existing posture signals in current stats/preflight surfaces.
Manual verify:
- With healthy state, confirm snapshot shows stable/healthy posture labels.
- Trigger warning state and confirm snapshot updates quickly without blocking chat actions.

### Step 2 — Recovery outcome persistence
Scope:
- Persist latest recovery feedback outcome locally and display it in compact form after refresh.
Manual verify:
- Run guided recovery action, confirm outcome appears, refresh page, and confirm it is retained.
- Confirm no automatic recovery action is triggered from persisted state.

### Step 3 — Warning-state change marker
Scope:
- Add lightweight marker that distinguishes unchanged repeated warnings from newly changed warning states.
Manual verify:
- Keep identical warning state and confirm marker indicates unchanged/stable warning.
- Change warning condition and confirm marker indicates state change clearly.

### Step 4 — Operator sequence closeout
Scope:
- Finalize a repeatable Phase 12 operator sequence using existing controls and document it clearly.
Manual verify:
- Execute sequence end-to-end (preflight -> stats review -> guided recovery -> feedback check) and confirm all steps are observable.
- Confirm no new endpoint requirement or contract change is introduced.

---

# 🧭 PHASE 13 — Session Reliability Loop (Current Stack)

Goal: Improve per-session reliability clarity so operators can quickly understand stability drift and safe next actions without changing architecture.

Brief summary of existing Phase 13 intent (from current document text):
- `CURRENT NEXT STEP` already points to implementing Phase 13.
- No dedicated Phase 13 block existed yet; this section formalizes Phase 13 scope and execution plan inside current system boundaries.

Architecture guardrails for Phase 13:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend existing Model Stats + Preflight + Guided recovery surfaces only.
- Keep `/api/chat` request/response contract backward-compatible; any additions must remain optional.
- Keep all reliability signals and helpers advisory/non-blocking by default.

## 13.1 Scope (Session Reliability, Existing Surfaces)

### Item A — Session posture mini timeline (soft)
User-facing behavior:
- User sees a compact timeline of recent posture transitions (healthy/warn) within the current session.
- Timeline is informational only and does not block send/recovery actions.
Uses existing UI area:
- Existing Model Stats + Preflight hint lines.
Payload compatibility:
- No required payload changes; timeline derives from existing local runtime signals.

### Item B — Recovery action/result pairing (local)
User-facing behavior:
- User sees compact pairing of last recovery action and resulting posture state for quick auditability.
- Pairing persists locally across refresh for current browser profile.
Uses existing UI area:
- Existing Guided recovery + Recovery feedback line.
Payload compatibility:
- UI-only local persistence; backend/assistant contracts unchanged.

### Item C — Warning stability qualifier
User-facing behavior:
- User gets a short qualifier for warning behavior (`new`, `flapping`, `stable`, `cleared`) to reduce ambiguity.
- Qualifier remains advisory and never auto-applies changes.
Uses existing UI area:
- Existing Preflight warning/reminder area.
Payload compatibility:
- No endpoint changes required; computed from local warning signature history.

### Item D — Repeatable session reliability check pack
User-facing behavior:
- User can run a concise reliability check loop: preflight -> inspect posture timeline/qualifier -> run recovery -> confirm paired outcome.
- Loop is repeatable for release hygiene and troubleshooting.
Uses existing UI area:
- Existing Preflight controls, Model Stats rows, and guided recovery actions.
Payload compatibility:
- No new required endpoint/contract behavior; uses current controls/endpoints only.

## 13.2 Phase 13 Acceptance Criteria (Explicit DoD)

Phase 13 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented using existing UI sections and current backend endpoints.
- [x] `/api/chat` contract and baseline chat flow remain backward-compatible.
- [x] Reliability timeline/qualifier/recovery-pair indicators remain advisory and non-blocking.
- [x] Local reliability state persists predictably across refresh for intended items.
- [x] Session reliability check pack is repeatable and observable without architecture changes.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

Status: PHASE 13 DoD — PASS

## 13.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Session posture mini timeline
Scope:
- Add compact recent posture timeline from existing local stability/drift/reminder signals.
Manual verify:
- Under healthy operation, confirm timeline shows stable healthy entries.
- Trigger warning conditions and confirm timeline appends warning transitions without blocking chat.

### Step 2 — Recovery pair persistence
Scope:
- Persist and display compact last recovery action + resulting posture pair after refresh.
Manual verify:
- Execute guided recovery and confirm pair appears with latest result.
- Refresh page and confirm pair remains visible; no auto-action is triggered.

### Step 3 — Warning stability qualifier
Scope:
- Add lightweight qualifier that marks warning behavior as new/flapping/stable/cleared.
Manual verify:
- Keep warning unchanged and confirm qualifier trends to stable.
- Toggle warning state repeatedly and confirm qualifier indicates flapping/changed behavior clearly.

### Step 4 — Reliability pack closeout
Scope:
- Finalize repeatable Phase 13 reliability check sequence and align docs with current controls.
Manual verify:
- Run full sequence end-to-end and confirm each step is visible/repeatable.
- Confirm no new endpoint requirement or contract-breaking behavior is introduced.

---

# 🧭 PHASE 14 — Operational Consistency Pack (Current Stack)

Goal: Strengthen day-to-day operational consistency so warning/recovery behavior stays readable, repeatable, and low-noise across normal sessions.

Brief summary of existing Phase 14 intent (from current document text):
- `CURRENT NEXT STEP` already points to implementing Phase 14.
- No dedicated Phase 14 block existed yet; this section formalizes Goal + Scope and execution boundaries for the next phase.

Architecture guardrails for Phase 14:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend existing Model Stats + Preflight + Guided recovery surfaces only.
- Keep `/api/chat` request/response contract backward-compatible; any additional metadata remains optional.
- Keep all consistency indicators and helpers advisory/non-blocking by default.

## 14.1 Scope (Operational Consistency, Existing Surfaces)

### Item A — Consistency status strip (soft)
User-facing behavior:
- User sees one compact status strip summarizing session consistency posture from existing reliability signals.
- Strip is informative only and never blocks chat or recovery actions.
Uses existing UI area:
- Existing Model Stats + Preflight hint lines.
Payload compatibility:
- No required payload changes; derived from existing local/runtime UI state.

### Item B — Recovery confidence hint (local)
User-facing behavior:
- User gets a compact confidence hint after recovery actions (e.g., confidence rising/stable/uncertain) using current before/after outcomes.
- Hint remains visible across refresh for quick operator recall.
Uses existing UI area:
- Existing Recovery feedback + Guided recovery area.
Payload compatibility:
- UI-only local persistence; backend/assistant contracts unchanged.

### Item C — Warning noise classifier
User-facing behavior:
- User sees lightweight warning noise classification (`quiet`, `normal`, `noisy`) based on recent warning transitions.
- Classifier helps prioritize action but does not auto-change settings.
Uses existing UI area:
- Existing Preflight warning/marker/qualifier lines.
Payload compatibility:
- No endpoint changes required; computed from local warning history.

### Item D — Repeatable consistency check loop
User-facing behavior:
- User can run a short consistency loop: preflight -> review strip/classifier -> run recovery -> verify confidence hint.
- Loop is repeatable and suitable for release-prep routine checks.
Uses existing UI area:
- Existing Preflight controls, Model Stats rows, and guided recovery actions.
Payload compatibility:
- No new required endpoint/contract behavior; uses current controls/endpoints only.

## 14.2 Phase 14 Acceptance Criteria (Explicit DoD)

Phase 14 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented using existing UI sections and current backend endpoints.
- [x] `/api/chat` contract and baseline chat flow remain backward-compatible.
- [x] Consistency strip/confidence/classifier layers remain advisory and non-blocking.
- [x] Local consistency signals persist predictably across refresh for intended items.
- [x] Consistency check loop is repeatable and observable without architecture changes.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

Status: PHASE 14 DoD — PASS

## 14.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Consistency status strip
Scope:
- Add a compact consistency strip from existing reliability signals in current stats/preflight surfaces.
Manual verify:
- Under healthy flow, confirm strip reports stable/healthy consistency.
- Trigger warning/recovery activity and confirm strip updates without blocking chat.

### Step 2 — Recovery confidence hint persistence
Scope:
- Add compact recovery confidence hint derived from existing recovery outcomes and persist it locally across refresh.
Manual verify:
- Run guided recovery and confirm confidence hint appears with latest state.
- Refresh page and confirm hint remains visible with no automatic action trigger.

### Step 3 — Warning noise classifier
Scope:
- Add lightweight classifier for warning transition noise (`quiet`/`normal`/`noisy`) from recent warning behavior.
Manual verify:
- Keep warnings mostly stable and confirm classifier stays `quiet` or `normal`.
- Rapidly toggle warning conditions and confirm classifier escalates to `noisy`.

### Step 4 — Consistency loop closeout
Scope:
- Finalize a repeatable Phase 14 consistency loop and align docs to current controls/endpoints.
Manual verify:
- Execute the loop end-to-end and confirm every step is visible/repeatable.
- Confirm no new endpoint requirement or contract-breaking behavior is introduced.

---

# 🧭 PHASE 15 — Reliability Signal Hygiene (Current Stack)

Goal: Improve signal hygiene so operators can quickly distinguish meaningful reliability changes from routine noise while staying on the same architecture.

Brief summary of existing Phase 15 intent (from current document text):
- `CURRENT NEXT STEP` already points to implementing Phase 15.
- No dedicated Phase 15 block existed yet; this section formalizes Goal + Scope and a minimal execution plan within current boundaries.

Architecture guardrails for Phase 15:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend existing Model Stats + Preflight + Guided recovery surfaces only.
- Keep `/api/chat` request/response contract backward-compatible; any additions remain optional.
- Keep all hygiene indicators and helpers advisory/non-blocking by default.

## 15.1 Scope (Signal Hygiene, Existing Surfaces)

### Item A — Signal freshness indicator (soft)
User-facing behavior:
- User sees a compact freshness indicator for reliability signals (fresh/stale) so stale state is easy to spot.
- Indicator is informational only and never blocks chat/recovery actions.
Uses existing UI area:
- Existing Model Stats + Preflight hint lines.
Payload compatibility:
- No required payload changes; freshness derives from existing local timestamps/state.

### Item B — Recovery confidence recency context
User-facing behavior:
- User sees compact recency context near recovery confidence (e.g., just now / recently / stale) for better decision-making.
- Context persists locally across refresh where applicable.
Uses existing UI area:
- Existing Recovery confidence + Recovery feedback hints.
Payload compatibility:
- UI-only local state; backend/assistant contracts unchanged.

### Item C — Warning noise trend label
User-facing behavior:
- User gets a lightweight trend label for warning noise direction (`calming`/`steady`/`worsening`) on top of current noise class.
- Label remains advisory and does not auto-apply any settings.
Uses existing UI area:
- Existing warning classifier/qualifier lines in Preflight.
Payload compatibility:
- No endpoint changes required; computed from local warning-history deltas.

### Item D — Repeatable signal hygiene check loop
User-facing behavior:
- User can run a short hygiene loop: preflight -> inspect freshness+noise trend -> run recovery -> validate confidence recency.
- Loop is repeatable for routine release-readiness checks.
Uses existing UI area:
- Existing Preflight controls, Model Stats rows, and guided recovery actions.
Payload compatibility:
- No new required endpoint/contract behavior; uses current controls/endpoints only.

## 15.2 Phase 15 Acceptance Criteria (Explicit DoD)

Phase 15 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented using existing UI sections and current backend endpoints.
- [x] `/api/chat` contract and baseline chat flow remain backward-compatible.
- [x] Freshness/recency/noise-trend layers remain advisory and non-blocking.
- [x] Local hygiene signals persist predictably across refresh for intended items.
- [x] Signal hygiene check loop is repeatable and observable without architecture changes.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

Status: PHASE 15 DoD — PASS

## 15.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Signal freshness indicator
Scope:
- Add compact freshness indicator from existing reliability signal timestamps/state in current stats/preflight surfaces.
Manual verify:
- Under active interaction, confirm indicator reports fresh state.
- Pause interactions and confirm indicator shifts toward stale without blocking chat.

### Step 2 — Recovery confidence recency
Scope:
- Add compact recency context to recovery confidence and persist it locally across refresh.
Manual verify:
- Run guided recovery and confirm recency context appears with latest confidence.
- Refresh page and confirm recency context remains visible with no automatic action trigger.

### Step 3 — Warning noise trend label
Scope:
- Add lightweight trend label (`calming`/`steady`/`worsening`) from recent warning noise transitions.
Manual verify:
- Keep warning noise stable and confirm trend stays `steady` or `calming`.
- Rapidly increase warning transitions and confirm trend moves to `worsening`.

### Step 4 — Hygiene loop closeout
Scope:
- Finalize repeatable Phase 15 hygiene loop and align docs to current controls/endpoints.
Manual verify:
- Execute the loop end-to-end and confirm each step is visible/repeatable.
- Confirm no new endpoint requirement or contract-breaking behavior is introduced.

---

# 🧭 PHASE 16 — Operator Signal Trust Loop (Current Stack)

Goal: Increase operator trust in reliability signals by making status transitions easier to interpret and validate during normal daily operation.

Brief summary of existing Phase 16 intent (from current document text):
- `CURRENT NEXT STEP` already points to implementing Phase 16.
- No dedicated Phase 16 block existed yet; this section formalizes Goal + Scope and a minimal execution plan inside current stack boundaries.

Architecture guardrails for Phase 16:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend only existing Model Stats + Preflight + Guided recovery surfaces.
- Keep `/api/chat` request/response contract backward-compatible; additions remain optional.
- Keep trust indicators and helpers advisory/non-blocking by default.

## 16.1 Scope (Signal Trust, Existing Surfaces)

### Item A — Signal trust badge (soft)
User-facing behavior:
- User sees one compact trust badge summarizing reliability signal confidence for the active session.
- Badge is informational only and never blocks chat/recovery actions.
Uses existing UI area:
- Existing Model Stats + Preflight hint lines.
Payload compatibility:
- No required payload changes; trust posture is computed from existing local reliability signals.

### Item B — Confidence recency consistency hint
User-facing behavior:
- User sees whether confidence recency and freshness posture are aligned (`aligned`/`lagging`) for quick sanity checks.
- Hint persists locally across refresh where relevant.
Uses existing UI area:
- Existing Signal freshness + Recovery confidence lines.
Payload compatibility:
- UI-only local state/derivation; backend/assistant contracts unchanged.

### Item C — Warning volatility posture
User-facing behavior:
- User gets a lightweight volatility posture (`low`/`medium`/`high`) derived from warning noise class + trend together.
- Posture remains advisory and does not auto-apply actions.
Uses existing UI area:
- Existing warning noise classifier + trend + qualifier lines in Preflight.
Payload compatibility:
- No endpoint changes required; computed from existing local warning behavior state.

### Item D — Repeatable trust validation loop
User-facing behavior:
- User can run a short trust loop: preflight -> inspect trust/volatility posture -> run recovery -> validate recency alignment.
- Loop is repeatable for release confidence and incident triage checks.
Uses existing UI area:
- Existing Preflight controls, Model Stats rows, and guided recovery actions.
Payload compatibility:
- No new required endpoint/contract behavior; relies on current controls/endpoints.

## 16.2 Phase 16 Acceptance Criteria (Explicit DoD)

Phase 16 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI sections and current backend endpoints.
- [x] `/api/chat` contract and baseline chat flow remain backward-compatible.
- [x] Trust/consistency/volatility layers remain advisory and non-blocking.
- [x] Local trust signals persist predictably across refresh for intended items.
- [x] Trust validation loop is repeatable and observable without architecture changes.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

Status: PHASE 16 DoD — PASS

## 16.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Signal trust badge
Scope:
- Add compact trust badge derived from existing reliability indicators in current stats/preflight surfaces.
Manual verify:
- Under stable conditions, confirm badge shows healthy trust posture.
- Trigger warning drift/noise and confirm badge downgrades without blocking chat.

### Step 2 — Recency alignment hint
Scope:
- Add compact hint that compares freshness and recovery-confidence recency alignment and persist where needed.
Manual verify:
- Run recovery and confirm hint shows aligned state when timestamps are current.
- Let state age and confirm hint can shift to lagging without automatic actions.

### Step 3 — Warning volatility posture
Scope:
- Add lightweight posture label (`low`/`medium`/`high`) from warning noise class + trend transitions.
Manual verify:
- Keep warnings stable and confirm posture stays low/medium.
- Rapidly toggle warning conditions and confirm posture escalates to high.

### Step 4 — Trust loop closeout
Scope:
- Finalize repeatable Phase 16 trust validation loop and align docs to existing controls/endpoints.
Manual verify:
- Execute loop end-to-end and confirm each step is visible/repeatable.
- Confirm no new endpoint requirement or contract-breaking behavior is introduced.

---

# 🧭 PHASE 17 — Reliability Readiness Signals (Current Stack)

Goal: Improve operational readiness visibility by making reliability signals easier to audit, compare, and act on in daily sessions.

Brief summary of existing Phase 17 intent (from current document text):
- `CURRENT NEXT STEP` already points to implementing Phase 17.
- No dedicated Phase 17 block existed yet; this section formalizes Goal + Scope and a minimal implementation path inside the current architecture.

Architecture guardrails for Phase 17:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend only existing Model Stats + Preflight + Guided recovery surfaces.
- Keep `/api/chat` request/response contract backward-compatible; additions remain optional.
- Keep readiness indicators and helpers advisory/non-blocking by default.

## 17.1 Scope (Readiness Signals, Existing Surfaces)

### Item A — Readiness signal rollup (soft)
User-facing behavior:
- User sees a compact rollup of readiness posture from current trust/freshness/volatility indicators.
- Rollup is informational only and does not block chat or recovery actions.
Uses existing UI area:
- Existing Model Stats + Preflight hint lines.
Payload compatibility:
- No required payload changes; rollup derives from existing local signal state.

### Item B — Alignment confidence marker
User-facing behavior:
- User sees a compact marker showing whether recency alignment and trust posture move together (`coherent`/`mixed`).
- Marker persists locally across refresh where relevant.
Uses existing UI area:
- Existing Signal trust + Recency alignment lines.
Payload compatibility:
- UI-only local derivation/persistence; backend/assistant contracts unchanged.

### Item C — Volatility pressure tag
User-facing behavior:
- User gets a lightweight pressure tag (`low`/`elevated`) derived from warning volatility posture + noise trend.
- Tag remains advisory and never auto-applies changes.
Uses existing UI area:
- Existing warning volatility/noise/trend lines in Preflight.
Payload compatibility:
- No endpoint changes required; computed from existing local warning behavior state.

### Item D — Repeatable readiness validation loop
User-facing behavior:
- User can run a short readiness loop: preflight -> review rollup/marker/pressure -> run recovery -> recheck readiness.
- Loop is repeatable for routine release readiness and incident triage checks.
Uses existing UI area:
- Existing Preflight controls, Model Stats rows, and guided recovery actions.
Payload compatibility:
- No new required endpoint/contract behavior; uses current controls/endpoints only.

## 17.2 Phase 17 Acceptance Criteria (Explicit DoD)

Phase 17 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI sections and current backend endpoints.
- [x] `/api/chat` contract and baseline chat flow remain backward-compatible.
- [x] Readiness rollup/marker/pressure layers remain advisory and non-blocking.
- [x] Local readiness signals persist predictably across refresh for intended items.
- [x] Readiness validation loop is repeatable and observable without architecture changes.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

Status: PHASE 17 DoD — PASS

## 17.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Readiness signal rollup
Scope:
- Add compact readiness rollup from existing trust/freshness/volatility indicators in current stats/preflight surfaces.
Manual verify:
- Under stable conditions, confirm rollup reports healthy readiness posture.
- Trigger warning/recovery drift and confirm rollup updates without blocking chat.

### Step 2 — Alignment confidence marker
Scope:
- Add compact marker showing coherence between recency alignment and trust posture; persist where needed.
Manual verify:
- With stable signals, confirm marker shows coherent posture.
- Create mixed signal state and confirm marker shifts to mixed without automatic actions.

### Step 3 — Volatility pressure tag
Scope:
- Add lightweight pressure tag (`low`/`elevated`) from warning volatility posture + noise trend transitions.
Manual verify:
- Keep warning behavior stable and confirm pressure remains low.
- Rapidly increase warning transitions and confirm pressure elevates.

### Step 4 — Readiness loop closeout
Scope:
- Finalize repeatable Phase 17 readiness validation loop and align docs to existing controls/endpoints.
Manual verify:
- Execute loop end-to-end and confirm each step is visible/repeatable.
- Confirm no new endpoint requirement or contract-breaking behavior is introduced.

---

# 🧭 PHASE 18 — Reliability Operations Handshake (Current Stack)

Goal: Improve operational handoff confidence by making reliability posture easier to summarize, compare, and re-validate across repeated sessions.

Brief summary of existing Phase 18 intent (from current document text):
- `CURRENT NEXT STEP` already points to implementing Phase 18.
- No dedicated Phase 18 block existed yet; this section formalizes Goal + Scope and a minimal implementation path within the existing architecture.

Architecture guardrails for Phase 18:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend only existing Model Stats + Preflight + Guided recovery surfaces.
- Keep `/api/chat` request/response contract backward-compatible; additions remain optional.
- Keep all handshake indicators and checks advisory/non-blocking by default.

## 18.1 Scope (Operations Handshake, Existing Surfaces)

### Item A — Reliability handshake summary (soft)
User-facing behavior:
- User sees a compact handshake summary that combines readiness posture with trust/alignment signals.
- Summary is informative only and does not block chat or recovery actions.
Uses existing UI area:
- Existing Model Stats + Preflight hint lines.
Payload compatibility:
- No required payload changes; summary derives from existing local signal state.

### Item B — Recheck confidence cue
User-facing behavior:
- User gets a compact cue that indicates whether current posture should be rechecked now or later (`recheck now`/`monitor`).
- Cue persists locally across refresh where relevant.
Uses existing UI area:
- Existing Signal freshness + readiness/volatility/trust lines.
Payload compatibility:
- UI-only local derivation/persistence; backend/assistant contracts unchanged.

### Item C — Drift pressure comparator
User-facing behavior:
- User sees a lightweight comparator (`improving`/`steady`/`worsening`) based on current pressure and prior pressure snapshots.
- Comparator remains advisory and does not auto-apply settings/actions.
Uses existing UI area:
- Existing warning volatility/pressure + trend lines in Preflight.
Payload compatibility:
- No endpoint changes required; computed from existing local warning and pressure signals.

### Item D — Repeatable handshake verification loop
User-facing behavior:
- User can run a short handshake loop: preflight -> inspect summary/cue/comparator -> run recovery -> re-verify handshake state.
- Loop is repeatable for release-readiness and operator handoff checks.
Uses existing UI area:
- Existing Preflight controls, Model Stats rows, and guided recovery actions.
Payload compatibility:
- No new required endpoint/contract behavior; uses current controls/endpoints only.

## 18.2 Phase 18 Acceptance Criteria (Explicit DoD)

Phase 18 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI sections and current backend endpoints.
- [x] `/api/chat` contract and baseline chat flow remain backward-compatible.
- [x] Handshake summary/cue/comparator layers remain advisory and non-blocking.
- [x] Local handshake signals persist predictably across refresh for intended items.
- [x] Handshake verification loop is repeatable and observable without architecture changes.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

## 18.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Reliability handshake summary
Scope:
- Add compact handshake summary from existing readiness/trust/alignment indicators in current stats/preflight surfaces.
Manual verify:
- Under stable conditions, confirm summary reports healthy handshake posture.
- Trigger warning/recovery drift and confirm summary updates without blocking chat.

### Step 2 — Recheck confidence cue
Scope:
- Add compact cue (`recheck now`/`monitor`) based on freshness + pressure posture and persist where needed.
Manual verify:
- Keep fresh/stable conditions and confirm cue stays `monitor`.
- Let signals age or increase pressure and confirm cue shifts to `recheck now` without automatic actions.

### Step 3 — Drift pressure comparator
Scope:
- Add lightweight comparator (`improving`/`steady`/`worsening`) using current pressure against recent local pressure snapshots.
Manual verify:
- Keep pressure stable and confirm comparator remains `steady` or `improving`.
- Increase warning transitions and confirm comparator moves to `worsening`.

### Step 4 — Handshake loop closeout
Scope:
- Finalize repeatable Phase 18 handshake verification loop and align docs to existing controls/endpoints.
Manual verify:
- Execute loop end-to-end and confirm each step is visible/repeatable.
- Confirm no new endpoint requirement or contract-breaking behavior is introduced.

Status: PHASE 18 DoD — PASS

---

# 🧭 PHASE 19 — Handshake Consistency Follow-through (Current Stack)

Goal: Improve operator confidence after handshake checks by adding compact follow-through signals that make consistency drift easier to spot and re-verify across repeated sessions.

Brief summary of existing Phase 19 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 19.
- No dedicated Phase 19 block existed yet; this section formalizes Goal + Scope and a minimal implementation path within the existing architecture.

Architecture guardrails for Phase 19:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend only existing Model Stats + Preflight + guided recovery surfaces.
- Keep `/api/chat` request/response contract backward-compatible; additions remain optional.
- Keep all follow-through indicators advisory/non-blocking by default.

## 19.1 Scope (Consistency Follow-through, Existing Surfaces)

### Item A — Handshake continuity signal (soft)
User-facing behavior:
- User sees a compact continuity signal that compares latest handshake posture with recent handshake history.
- Signal is informational only and never blocks chat or recovery actions.
Uses existing UI area:
- Existing Model Stats reliability rows + Preflight hint lines.
Payload compatibility:
- No required payload changes; derived from existing local handshake/readiness signals.

### Item B — Recheck outcome marker
User-facing behavior:
- User gets a compact marker indicating whether latest recheck outcome looks confirming, mixed, or degraded.
- Marker persists locally across refresh where relevant.
Uses existing UI area:
- Existing Recheck/Freshness/Pressure-related lines in Model Stats + Preflight.
Payload compatibility:
- UI-only local derivation/persistence; backend/assistant contracts unchanged.

### Item C — Drift direction qualifier
User-facing behavior:
- User sees a lightweight qualifier (`improving`/`steady`/`worsening`) for consistency drift based on recent local signal snapshots.
- Qualifier remains advisory and does not auto-apply any settings/actions.
Uses existing UI area:
- Existing pressure/comparator/noise/trend lines in Preflight and Model Stats.
Payload compatibility:
- No endpoint changes required; computed from existing local reliability signal state.

### Item D — Repeatable follow-through verification loop
User-facing behavior:
- User can run a short loop: preflight -> inspect continuity/outcome/qualifier -> run recovery -> recheck follow-through state.
- Loop is repeatable for release-readiness and operator handoff confidence checks.
Uses existing UI area:
- Existing Preflight controls, Model Stats rows, and guided recovery actions.
Payload compatibility:
- No new required endpoint/contract behavior; uses current controls/endpoints only.

## 19.2 Phase 19 Acceptance Criteria (Explicit DoD)

Phase 19 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI sections and current backend endpoints.
- [x] `/api/chat` contract and baseline chat flow remain backward-compatible.
- [x] Continuity/outcome/qualifier layers remain advisory and non-blocking.
- [x] Local follow-through signals persist predictably across refresh for intended items.
- [x] Follow-through verification loop is repeatable and observable without architecture changes.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

## 19.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Handshake continuity signal
Scope:
- Add compact continuity signal from existing handshake/readiness/trust alignment context in current stats/preflight surfaces.
Manual verify:
- Under stable conditions, confirm continuity reports consistent follow-through posture.
- Trigger warning/recovery drift and confirm continuity updates without blocking chat.

### Step 2 — Recheck outcome marker
Scope:
- Add compact marker (`confirming`/`mixed`/`degraded`) from latest recheck-related local signals and persist where needed.
Manual verify:
- Keep fresh/low-pressure conditions and confirm marker shows confirming posture.
- Increase pressure or stale freshness and confirm marker shifts to mixed/degraded without automatic actions.

### Step 3 — Drift direction qualifier
Scope:
- Add lightweight qualifier (`improving`/`steady`/`worsening`) using current consistency posture against recent local snapshots.
Manual verify:
- Keep posture stable and confirm qualifier remains `steady` or `improving`.
- Increase warning transitions/pressure and confirm qualifier moves to `worsening`.

### Step 4 — Follow-through loop closeout
Scope:
- Finalize repeatable Phase 19 follow-through verification loop and align docs to existing controls/endpoints.
Manual verify:
- Execute loop end-to-end and confirm each step is visible/repeatable.
- Confirm no new endpoint requirement or contract-breaking behavior is introduced.

Status: PHASE 19 DoD — PASS

---

# 🧭 PHASE 20 — Follow-through Confidence Calibration (Current Stack)

Goal: Improve operator calibration after follow-through checks by surfacing compact confidence cues that clarify whether consistency signals are converging, stable, or diverging across repeated sessions.

Brief summary of existing Phase 20 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 20.
- No dedicated Phase 20 block existed yet; this section formalizes Goal + Scope and a minimal implementation path within the existing architecture.

Architecture guardrails for Phase 20:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend only existing Model Stats + Preflight + guided recovery surfaces.
- Keep `/api/chat` request/response contract backward-compatible; additions remain optional.
- Keep all calibration indicators advisory/non-blocking by default.

## 20.1 Scope (Confidence Calibration, Existing Surfaces)

### Item A — Follow-through confidence rollup (soft)
User-facing behavior:
- User sees a compact rollup that summarizes follow-through confidence from continuity, recheck outcome, and drift direction context.
- Rollup is informational only and never blocks chat or recovery actions.
Uses existing UI area:
- Existing Model Stats reliability rows + Preflight hint lines.
Payload compatibility:
- No required payload changes; derived from existing local follow-through signals.

### Item B — Recheck confidence stability marker
User-facing behavior:
- User gets a compact marker indicating whether recent recheck confidence is stabilizing, mixed, or degrading.
- Marker persists locally across refresh where relevant.
Uses existing UI area:
- Existing Recheck/Freshness/Continuity-related lines in Model Stats + Preflight.
Payload compatibility:
- UI-only local derivation/persistence; backend/assistant contracts unchanged.

### Item C — Consistency divergence tag
User-facing behavior:
- User sees a lightweight divergence tag (`improving`/`steady`/`worsening`) based on current confidence posture against recent local snapshots.
- Tag remains advisory and does not auto-apply any settings/actions.
Uses existing UI area:
- Existing consistency/pressure/qualifier lines in Preflight and Model Stats.
Payload compatibility:
- No endpoint changes required; computed from existing local reliability signal state.

### Item D — Repeatable calibration verification loop
User-facing behavior:
- User can run a short loop: preflight -> inspect rollup/marker/tag -> run recovery -> recheck calibration posture.
- Loop is repeatable for release-readiness and operator handoff confidence checks.
Uses existing UI area:
- Existing Preflight controls, Model Stats rows, and guided recovery actions.
Payload compatibility:
- No new required endpoint/contract behavior; uses current controls/endpoints only.

## 20.2 Phase 20 Acceptance Criteria (Explicit DoD)

Phase 20 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI sections and current backend endpoints.
- [x] `/api/chat` contract and baseline chat flow remain backward-compatible.
- [x] Confidence rollup/marker/tag layers remain advisory and non-blocking.
- [x] Local calibration signals persist predictably across refresh for intended items.
- [x] Calibration verification loop is repeatable and observable without architecture changes.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

## 20.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Follow-through confidence rollup
Scope:
- Add compact rollup from existing continuity/recheck outcome/drift direction context in current stats/preflight surfaces.
Manual verify:
- Under stable conditions, confirm rollup reports healthy calibration posture.
- Trigger warning/recovery drift and confirm rollup updates without blocking chat.

### Step 2 — Recheck confidence stability marker
Scope:
- Add compact marker (`stabilizing`/`mixed`/`degrading`) from latest recheck-related confidence signals and persist where needed.
Manual verify:
- Keep fresh/low-pressure conditions and confirm marker shows stabilizing posture.
- Increase pressure or stale freshness and confirm marker shifts to mixed/degrading without automatic actions.

### Step 3 — Consistency divergence tag
Scope:
- Add lightweight tag (`improving`/`steady`/`worsening`) using current confidence posture against recent local snapshots.
Manual verify:
- Keep posture stable and confirm tag remains `steady` or `improving`.
- Increase warning transitions/pressure and confirm tag moves to `worsening`.

### Step 4 — Calibration loop closeout
Scope:
- Finalize repeatable Phase 20 calibration verification loop and align docs to existing controls/endpoints.
Manual verify:
- Execute loop end-to-end and confirm each step is visible/repeatable.
- Confirm no new endpoint requirement or contract-breaking behavior is introduced.

Status: PHASE 20 DoD — PASS

---

# 🧭 PHASE 21 — Calibration Signal Coherence Pack (Current Stack)

Goal: Improve operator confidence in calibration quality by surfacing compact coherence signals that show whether confidence indicators are aligned, stable, and converging across repeated sessions.

Brief summary of existing Phase 21 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 21.
- No dedicated Phase 21 block existed yet; this section formalizes Goal + Scope and a minimal implementation path within the existing architecture.

Architecture guardrails for Phase 21:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend only existing Model Stats + Preflight + guided recovery surfaces.
- Keep `/api/chat` request/response contract backward-compatible; additions remain optional.
- Keep all coherence indicators advisory/non-blocking by default.

## 21.1 Scope (Signal Coherence Pack, Existing Surfaces)

### Item A — Calibration coherence rollup (soft)
User-facing behavior:
- User sees a compact rollup that summarizes coherence across confidence rollup, recheck stability, and divergence posture.
- Rollup is informative only and never blocks chat or recovery actions.
Uses existing UI area:
- Existing Model Stats reliability rows + Preflight hint lines.
Payload compatibility:
- No required payload changes; derived from existing local calibration signals.

### Item B — Recheck alignment marker
User-facing behavior:
- User gets a compact marker indicating whether latest recheck confidence is aligned, mixed, or lagging relative to current posture.
- Marker persists locally across refresh where relevant.
Uses existing UI area:
- Existing Recheck/Freshness/Confidence-related lines in Model Stats + Preflight.
Payload compatibility:
- UI-only local derivation/persistence; backend/assistant contracts unchanged.

### Item C — Coherence trend tag
User-facing behavior:
- User sees a lightweight trend tag (`improving`/`steady`/`worsening`) based on current coherence posture against recent local snapshots.
- Tag remains advisory and does not auto-apply any settings/actions.
Uses existing UI area:
- Existing confidence/coherence/divergence lines in Preflight and Model Stats.
Payload compatibility:
- No endpoint changes required; computed from existing local reliability signal state.

### Item D — Repeatable coherence verification loop
User-facing behavior:
- User can run a short loop: preflight -> inspect rollup/marker/tag -> run recovery -> recheck coherence posture.
- Loop is repeatable for release-readiness and operator handoff confidence checks.
Uses existing UI area:
- Existing Preflight controls, Model Stats rows, and guided recovery actions.
Payload compatibility:
- No new required endpoint/contract behavior; uses current controls/endpoints only.

## 21.2 Phase 21 Acceptance Criteria (Explicit DoD)

Phase 21 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI sections and current backend endpoints.
- [x] `/api/chat` contract and baseline chat flow remain backward-compatible.
- [x] Coherence rollup/marker/tag layers remain advisory and non-blocking.
- [x] Local coherence signals persist predictably across refresh for intended items.
- [x] Coherence verification loop is repeatable and observable without architecture changes.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

## 21.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Calibration coherence rollup
Scope:
- Add compact coherence rollup from existing confidence rollup/recheck stability/divergence context in current stats/preflight surfaces.
Manual verify:
- Under stable conditions, confirm rollup reports healthy coherence posture.
- Trigger warning/recovery drift and confirm rollup updates without blocking chat.

### Step 2 — Recheck alignment marker
Scope:
- Add compact marker (`aligned`/`mixed`/`lagging`) from latest recheck-related confidence context and persist where needed.
Manual verify:
- Keep fresh/stable conditions and confirm marker shows aligned posture.
- Increase pressure or stale freshness and confirm marker shifts to mixed/lagging without automatic actions.

### Step 3 — Coherence trend tag
Scope:
- Add lightweight tag (`improving`/`steady`/`worsening`) using current coherence posture against recent local snapshots.
Manual verify:
- Keep posture stable and confirm tag remains `steady` or `improving`.
- Increase warning transitions/pressure and confirm tag moves to `worsening`.

### Step 4 — Coherence loop closeout
Scope:
- Finalize repeatable Phase 21 coherence verification loop and align docs to existing controls/endpoints.
Manual verify:
- Execute loop end-to-end and confirm each step is visible/repeatable.
- Confirm no new endpoint requirement or contract-breaking behavior is introduced.

Status: PHASE 21 DoD — PASS

---

# 🧭 PHASE 22 — Coherence Assurance Signal Loop (Current Stack)

Goal: Improve operator assurance by surfacing compact coherence-assurance signals that clarify whether calibration posture is holding, drifting, or recovering across repeated sessions.

Brief summary of existing Phase 22 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 22.
- No dedicated Phase 22 block existed yet; this section formalizes Goal + Scope and a minimal implementation path within the existing architecture.

Architecture guardrails for Phase 22:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend only existing Model Stats + Preflight + guided recovery surfaces.
- Keep `/api/chat` request/response contract backward-compatible; additions remain optional.
- Keep all assurance indicators advisory/non-blocking by default.

## 22.1 Scope (Coherence Assurance, Existing Surfaces)

### Item A — Coherence assurance rollup (soft)
User-facing behavior:
- User sees a compact assurance rollup summarizing coherence rollup, recheck alignment, and coherence trend posture.
- Rollup is informative only and never blocks chat or recovery actions.
Uses existing UI area:
- Existing Model Stats reliability rows + Preflight hint lines.
Payload compatibility:
- No required payload changes; derived from existing local coherence signals.

### Item B — Recheck posture confidence marker
User-facing behavior:
- User gets a compact marker indicating whether latest recheck posture confidence is confirmed, mixed, or at-risk.
- Marker persists locally across refresh where relevant.
Uses existing UI area:
- Existing Recheck/Freshness/Coherence-related lines in Model Stats + Preflight.
Payload compatibility:
- UI-only local derivation/persistence; backend/assistant contracts unchanged.

### Item C — Assurance drift trend tag
User-facing behavior:
- User sees a lightweight trend tag (`improving`/`steady`/`worsening`) based on current assurance posture against recent local snapshots.
- Tag remains advisory and does not auto-apply any settings/actions.
Uses existing UI area:
- Existing rollup/marker/trend lines in Preflight and Model Stats.
Payload compatibility:
- No endpoint changes required; computed from existing local reliability signal state.

### Item D — Repeatable assurance verification loop
User-facing behavior:
- User can run a short loop: preflight -> inspect rollup/marker/tag -> run recovery -> recheck assurance posture.
- Loop is repeatable for release-readiness and operator handoff confidence checks.
Uses existing UI area:
- Existing Preflight controls, Model Stats rows, and guided recovery actions.
Payload compatibility:
- No new required endpoint/contract behavior; uses current controls/endpoints only.

## 22.2 Phase 22 Acceptance Criteria (Explicit DoD)

Phase 22 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI sections and current backend endpoints.
- [x] `/api/chat` contract and baseline chat flow remain backward-compatible.
- [x] Assurance rollup/marker/tag layers remain advisory and non-blocking.
- [x] Local assurance signals persist predictably across refresh for intended items.
- [x] Assurance verification loop is repeatable and observable without architecture changes.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

## 22.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Coherence assurance rollup
Scope:
- Add compact assurance rollup from existing coherence rollup/recheck alignment/coherence trend context in current stats/preflight surfaces.
Manual verify:
- Under stable conditions, confirm rollup reports healthy assurance posture.
- Trigger warning/recovery drift and confirm rollup updates without blocking chat.

### Step 2 — Recheck posture confidence marker
Scope:
- Add compact marker (`confirmed`/`mixed`/`at-risk`) from latest recheck-related coherence context and persist where needed.
Manual verify:
- Keep fresh/stable conditions and confirm marker shows confirmed posture.
- Increase pressure or stale freshness and confirm marker shifts to mixed/at-risk without automatic actions.

### Step 3 — Assurance drift trend tag
Scope:
- Add lightweight tag (`improving`/`steady`/`worsening`) using current assurance posture against recent local snapshots.
Manual verify:
- Keep posture stable and confirm tag remains `steady` or `improving`.
- Increase warning transitions/pressure and confirm tag moves to `worsening`.

### Step 4 — Assurance loop closeout
Scope:
- Finalize repeatable Phase 22 assurance verification loop and align docs to existing controls/endpoints.
Manual verify:
- Execute loop end-to-end and confirm each step is visible/repeatable.
- Confirm no new endpoint requirement or contract-breaking behavior is introduced.

Status: PHASE 22 DoD — PASS

---

# 🧭 PHASE 23 — Assurance Convergence Signal Pack (Current Stack)

Goal: Improve operator confidence in long-running sessions by surfacing compact convergence signals that show whether assurance posture is reinforcing, steady, or diverging over time.

Brief summary of existing Phase 23 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 23.
- No dedicated Phase 23 block existed yet; this section formalizes Goal + Scope and a minimal implementation path within the existing architecture.

Architecture guardrails for Phase 23:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend only existing Model Stats + Preflight + guided recovery surfaces.
- Keep `/api/chat` request/response contract backward-compatible; additions remain optional.
- Keep all convergence indicators advisory/non-blocking by default.

## 23.1 Scope (Assurance Convergence, Existing Surfaces)

### Item A — Assurance convergence rollup (soft)
User-facing behavior:
- User sees a compact convergence rollup that summarizes assurance rollup, posture confidence, and assurance drift posture.
- Rollup is informative only and never blocks chat or recovery actions.
Uses existing UI area:
- Existing Model Stats reliability rows + Preflight hint lines.
Payload compatibility:
- No required payload changes; derived from existing local assurance signals.

### Item B — Recheck convergence marker
User-facing behavior:
- User gets a compact marker indicating whether recheck convergence is confirmed, mixed, or unstable.
- Marker persists locally across refresh where relevant.
Uses existing UI area:
- Existing Recheck/Freshness/Assurance-related lines in Model Stats + Preflight.
Payload compatibility:
- UI-only local derivation/persistence; backend/assistant contracts unchanged.

### Item C — Convergence drift trend tag
User-facing behavior:
- User sees a lightweight trend tag (`improving`/`steady`/`worsening`) based on current convergence posture against recent local snapshots.
- Tag remains advisory and does not auto-apply any settings/actions.
Uses existing UI area:
- Existing rollup/marker/trend lines in Preflight and Model Stats.
Payload compatibility:
- No endpoint changes required; computed from existing local reliability signal state.

### Item D — Repeatable convergence verification loop
User-facing behavior:
- User can run a short loop: preflight -> inspect rollup/marker/tag -> run recovery -> recheck convergence posture.
- Loop is repeatable for release-readiness and operator handoff confidence checks.
Uses existing UI area:
- Existing Preflight controls, Model Stats rows, and guided recovery actions.
Payload compatibility:
- No new required endpoint/contract behavior; uses current controls/endpoints only.

## 23.2 Phase 23 Acceptance Criteria (Explicit DoD)

Phase 23 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI sections and current backend endpoints.
- [x] `/api/chat` contract and baseline chat flow remain backward-compatible.
- [x] Convergence rollup/marker/tag layers remain advisory and non-blocking.
- [x] Local convergence signals persist predictably across refresh for intended items.
- [x] Convergence verification loop is repeatable and observable without architecture changes.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

## 23.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Assurance convergence rollup
Scope:
- Add compact convergence rollup from existing assurance rollup/posture confidence/assurance drift context in current stats/preflight surfaces.
Manual verify:
- Under stable conditions, confirm rollup reports healthy convergence posture.
- Trigger warning/recovery drift and confirm rollup updates without blocking chat.

### Step 2 — Recheck convergence marker
Scope:
- Add compact marker (`confirmed`/`mixed`/`unstable`) from latest recheck-related assurance context and persist where needed.
Manual verify:
- Keep fresh/stable conditions and confirm marker shows confirmed convergence.
- Increase pressure or stale freshness and confirm marker shifts to mixed/unstable without automatic actions.

### Step 3 — Convergence drift trend tag
Scope:
- Add lightweight tag (`improving`/`steady`/`worsening`) using current convergence posture against recent local snapshots.
Manual verify:
- Keep posture stable and confirm tag remains `steady` or `improving`.
- Increase warning transitions/pressure and confirm tag moves to `worsening`.

### Step 4 — Convergence loop closeout
Scope:
- Finalize repeatable Phase 23 convergence verification loop and align docs to existing controls/endpoints.
Manual verify:
- Execute loop end-to-end and confirm each step is visible/repeatable.
- Confirm no new endpoint requirement or contract-breaking behavior is introduced.

Status: PHASE 23 DoD — PASS

---

# 🧭 PHASE 24 — Advisory Surface Compression (Current Stack)

Goal: Reduce visible advisory noise with progressive disclosure while preserving all existing signal calculations and local persistence behavior.

Architecture guardrails for Phase 24:
- UI-only rendering organization on existing Model Stats + Preflight surfaces.
- No backend/assistant/endpoints changes.
- No changes to signal computation helpers (`useMemo`/`useEffect`/existing derivations); render-only visibility and labeling updates.
- Keep advisory behavior non-blocking and compact.

## 24.1 Scope (Advisory Compression, Existing Surfaces)

### Item A — Progressive disclosure toggles (persisted)
User-facing behavior:
- Model Stats + Preflight each expose `Show details` / `Hide details` with details collapsed by default.
- Toggle state persists across refresh.
Uses existing UI area:
- Existing Model Stats and Quick Actions -> Preflight cards.
Payload compatibility:
- No endpoint or contract changes; UI-only local state.

### Item B — Core set finalization + grouped details
User-facing behavior:
- Core lines stay compact (always visible) and non-blocking.
- Remaining advisory lines move under grouped details sections: Session / Recovery / Noise / Diagnostics.
Uses existing UI area:
- Existing advisory rows/hints in Model Stats + Preflight.
Payload compatibility:
- No endpoint or contract changes; render regrouping only.

### Item C — Details toggle hidden-count labels
User-facing behavior:
- Collapsed toggle labels show hidden counts (`Show details (N)`), expanded state shows `Hide details`.
- Preflight count updates dynamically for active conditional blocks.
Uses existing UI area:
- Existing Details toggles in Model Stats + Preflight.
Payload compatibility:
- No endpoint or contract changes; local render metadata only.

### Item D — Closeout and documentation sync
User-facing behavior:
- Advisory surfaces remain compact and understandable with no functional regressions.
Uses existing UI area:
- Existing docs + current advisory UI surfaces.
Payload compatibility:
- No endpoint or contract changes.

## 24.2 Phase 24 Acceptance Criteria (Explicit DoD)

Phase 24 is DONE only if all pass:
- [x] Progressive disclosure toggles exist for Model Stats and Preflight and persist across refresh.
- [x] Core sets are finalized and details are grouped under Session / Recovery / Noise / Diagnostics.
- [x] Details toggle labels show hidden counts, with dynamic conditional counting for Preflight.
- [x] Signal computations/persistence logic remain unchanged (render-only scope).
- [x] `/api/chat` contract and existing endpoint behavior remain backward-compatible.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

Status: PHASE 24 DoD — PASS

---

# 🧭 PHASE 25 — Advisory Clarity & Scanability Pack (Current Stack)

Goal: Improve operator scan speed and clarity across compressed advisory surfaces while preserving existing signal computations, persistence behavior, and non-blocking flow.

Brief summary of existing Phase 25 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 25.
- This section formalizes Goal + Scope + execution plan using the current architecture and existing UI surfaces only.

Architecture guardrails for Phase 25:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend only existing Model Stats + Preflight advisory surfaces.
- No required backend endpoint additions; keep all contract changes optional/additive only.
- Preserve existing signal derivations/persistence behavior; Phase 25 focuses on render presentation and operator clarity.
- Keep all indicators advisory and non-blocking by default.

## 25.1 Scope (Clarity & Scanability, Existing Surfaces)

### Item A — Core label normalization pass (soft)
User-facing behavior:
- User sees consistent compact wording for top-level core rows/hints so related concepts are easier to scan.
- Wording changes are presentation-only (no behavior or signal-source changes).
Uses existing UI area:
- Existing always-visible Core rows in Model Stats + Preflight.
Payload compatibility:
- No endpoint changes; UI text/render-only updates.

### Item B — Details section readability pass (soft)
User-facing behavior:
- User sees clearer sectioned details (`Session`/`Recovery`/`Noise`/`Diagnostics`) with stable ordering and compact headings.
- Details remain collapsed by default and expandable via existing toggles.
Uses existing UI area:
- Existing Details blocks in Model Stats + Preflight.
Payload compatibility:
- No endpoint changes; render grouping/order only.

### Item C — Toggle affordance polish (soft)
User-facing behavior:
- User gets clearer toggle affordance with stable count labels and concise helper text where needed.
- Count behavior remains dynamic for conditionally active Preflight detail blocks.
Uses existing UI area:
- Existing `Show details (N)` / `Hide details` toggles in Model Stats + Preflight.
Payload compatibility:
- No endpoint changes; UI-only label/affordance pass.

### Item D — Repeatable clarity verification loop
User-facing behavior:
- User can run a short loop: baseline scan -> expand details -> run preflight/recovery -> re-scan for readability/consistency.
- Loop validates clarity improvements without affecting functional workflow.
Uses existing UI area:
- Existing Model Stats, Preflight controls, and advisory detail sections.
Payload compatibility:
- No endpoint/contract changes required; existing controls only.

## 25.2 Phase 25 Acceptance Criteria (Explicit DoD)

Phase 25 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI sections and current backend endpoints.
- [x] Core advisory labels are compact/consistent across Model Stats and Preflight.
- [x] Details sections remain grouped and scanable with stable ordering and no layout redesign.
- [x] Details toggle labels/hidden counts remain clear, accurate, and dynamic where conditionals apply.
- [x] Signal computation logic and persistence behavior remain unchanged (render-label/grouping scope only).
- [x] `/api/chat` contract and baseline chat flow remain backward-compatible.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

## 25.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Core label normalization
Scope:
- Normalize top-level Core row/hint wording for compact scanability across Model Stats + Preflight.
Manual verify:
- Confirm core labels are concise and consistently phrased between surfaces.
- Confirm no signal value/logic changed; only labels/placement text updated.

### Step 2 — Details section readability alignment
Scope:
- Align details heading/read order (`Session`/`Recovery`/`Noise`/`Diagnostics`) and keep compact presentation.
Manual verify:
- Expand details in both surfaces and confirm section ordering is stable and easy to scan.
- Confirm advisory content remains the same signals, only reorganized/polished for readability.

### Step 3 — Toggle affordance micro-polish
Scope:
- Refine `Show details (N)` / `Hide details` affordance text and keep count behavior predictable for active conditional blocks.
Manual verify:
- Collapse/expand both surfaces and confirm toggle copy is clear and count remains accurate.
- Activate/deactivate conditional detail blocks and confirm Preflight count updates correctly.

### Step 4 — Clarity loop closeout
Scope:
- Finalize repeatable clarity verification loop and sync docs to current UI behavior/endpoints.
Manual verify:
- Run baseline scan -> expand details -> run preflight/recovery -> re-scan and confirm improvements are observable.
- Confirm no new endpoint requirement or contract-breaking behavior is introduced.

Status: PHASE 25 DoD — PASS

---

# 🚀 PHASE 26 — Advisory Actionability Pack (Current Stack)

Goal: Improve operator decision speed by making advisory signals more actionable (clear next-step guidance and confidence context) while preserving existing computations, persistence, and endpoint contracts.

Brief summary of existing Phase 26 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 26.
- This section defines a minimal, UI-first actionability plan using existing advisory surfaces and current backend endpoints only.

Architecture guardrails for Phase 26:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend only existing Model Stats + Preflight advisory surfaces.
- No new required backend endpoints; keep compatibility with `/api/chat`, `/api/kb/append`, `/api/features`, `/api/auth/me`.
- Preserve existing signal computations (`useMemo`/`useEffect`/helpers) and persistence schemas; scope is render/wording/grouping guidance only.
- Keep all advisories non-blocking; no auto-actions or forced flows.

## 26.1 Scope (Actionability, Existing Surfaces)

### Item A — Core action cue line (soft)
User-facing behavior:
- User sees one compact "Next best action" advisory cue in Core based on already available signal posture.
- Cue stays informational and never triggers actions automatically.
Uses existing UI area:
- Existing always-visible Core area in Preflight (and optional compact mirror in Model Stats).
Payload compatibility:
- No endpoint/payload changes; derived from existing local signal state.

### Item B — Section-level action hints in Details
User-facing behavior:
- User sees concise action-oriented hint text per Details group (`Session`/`Recovery`/`Noise`/`Diagnostics`) to reduce guesswork.
- Hints are contextual and remain non-blocking.
Uses existing UI area:
- Existing Details groups in Model Stats + Preflight.
Payload compatibility:
- No endpoint/payload changes; render text based on existing computed signals.

### Item C — Confidence qualifier polish for actions
User-facing behavior:
- User gets compact confidence qualifier (e.g., high/medium/low confidence cue) next to recommended action wording.
- Qualifier clarifies when to act now vs monitor.
Uses existing UI area:
- Existing advisory text lines and toggle-expanded Details content.
Payload compatibility:
- No endpoint/payload changes; uses existing reliability/readiness outputs.

### Item D — Repeatable actionability verification loop
User-facing behavior:
- User can run a short loop: read core cue -> inspect group hints -> run existing recovery/preflight action -> re-check cue confidence.
- Loop helps validate guidance quality without changing existing workflow controls.
Uses existing UI area:
- Existing Preflight controls, recovery actions, and advisory rows/hints.
Payload compatibility:
- No new contract requirements; existing controls/endpoints only.

## 26.2 Phase 26 Acceptance Criteria (Explicit DoD)

Phase 26 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI sections and current backend endpoints.
- [x] Core includes a compact action cue line that remains advisory/non-blocking.
- [x] Details groups include concise action hints with consistent wording and stable ordering.
- [x] Action confidence qualifier is visible and understandable where action guidance appears.
- [x] Signal computations and persistence schemas remain unchanged (render/label scope only).
- [x] `/api/chat` and existing endpoint contracts remain backward-compatible.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

## 26.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Core action cue scaffold
Scope:
- Add one compact core advisory cue that summarizes immediate next best action from current signal posture.
Manual verify:
- Confirm cue appears in Core and updates when posture changes.
- Confirm cue is non-blocking and does not alter existing actions/endpoints.

### Step 2 — Details group action hints
Scope:
- Add concise action-oriented hint line(s) under existing `Session`/`Recovery`/`Noise`/`Diagnostics` groups.
Manual verify:
- Expand Details and confirm each group has clear, compact guidance text.
- Confirm grouping/order/toggle behavior from Phase 24/25 remains intact.

### Step 3 — Action confidence qualifier polish
Scope:
- Add compact confidence qualifier next to action guidance using existing signal outputs.
Manual verify:
- Confirm qualifier changes logically under stable vs warning-heavy conditions.
- Confirm no changes to signal derivation logic or persistence semantics.

### Step 4 — Actionability loop closeout
Scope:
- Finalize repeatable actionability verification loop and align docs to current UI behavior/endpoints.
Manual verify:
- Run cue -> details hint -> existing action -> recheck loop and confirm guidance is observable/repeatable.
- Confirm no new endpoint requirement or contract-breaking behavior is introduced.

Status: PHASE 26 DoD — PASS

---

# 🚀 PHASE 27 — Advisory Confidence Calibration Pack (Current Stack)

Goal: Improve trust in advisory guidance by calibrating confidence cues against existing posture signals so operators can better distinguish "act now" vs "monitor" scenarios.

Brief summary of existing Phase 27 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 27.
- This section formalizes a UI-first confidence-calibration pass on top of Phase 26 actionability signals without changing architecture or endpoints.

Architecture guardrails for Phase 27:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend only existing Model Stats + Preflight advisory surfaces.
- Use only existing endpoints/contracts: `/api/chat`, `/api/kb/append`, `/api/features`, `/api/auth/me`.
- Preserve existing signal derivations/persistence schemas; scope is rendering/labeling/calibration only.
- Keep guidance advisory and non-blocking; no auto-actions.

## 27.1 Scope (Confidence Calibration, Existing Surfaces)

### Item A — Core confidence tier for next action
User-facing behavior:
- User sees a compact confidence tier attached to the core next-action cue (e.g., high/medium/low confidence).
- Tier clarifies urgency while keeping the cue informational.
Uses existing UI surface:
- Existing Preflight Core next-action line (and optional compact mirror in Model Stats Core).
Payload/API compatibility:
- No endpoint/payload changes; derived from already available local advisory signals.

### Item B — Group-level confidence qualifiers in Details
User-facing behavior:
- User sees concise confidence qualifiers within `Session`/`Recovery`/`Noise`/`Diagnostics` hint lines.
- Qualifiers stay compact and readable without adding new panels.
Uses existing UI surface:
- Existing Details group hint headers in Model Stats + Preflight.
Payload/API compatibility:
- No endpoint/payload changes; uses existing signal outputs and current render flow.

### Item C — Confidence consistency alignment pass
User-facing behavior:
- User gets consistent confidence wording across Core and Details (same terminology, no conflicting phrasing).
- Reduces ambiguity when scanning quickly under warning-heavy sessions.
Uses existing UI surface:
- Existing advisory copy lines, core cue line, and details hint copy.
Payload/API compatibility:
- No endpoint/payload changes; copy/render normalization only.

### Item D — Repeatable calibration verification loop
User-facing behavior:
- User can run a loop: inspect core cue+tier -> inspect detail qualifiers -> run existing action -> recheck confidence shifts.
- Loop validates whether confidence messaging tracks posture changes coherently.
Uses existing UI surface:
- Existing Preflight actions, advisory Core/Details lines, and current stats surfaces.
Payload/API compatibility:
- No new contract requirements; relies on existing endpoints and UI state only.

## 27.2 Phase 27 Acceptance Criteria (Explicit DoD)

Phase 27 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI surfaces and current backend endpoints.
- [x] Core next-action cue includes compact confidence tiering without blocking behavior.
- [x] Details group hints include concise confidence qualifiers with stable ordering and compact presentation.
- [x] Confidence wording is consistent across Core and Details (no conflicting labels).
- [x] Existing signal computations and persistence schemas remain unchanged.
- [x] `/api/chat`, `/api/kb/append`, `/api/features`, and `/api/auth/me` remain backward-compatible.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

## 27.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Core confidence tier scaffold
Intended behavior:
- Add compact confidence tier to the existing core next-action cue using current local signal posture.
Manual verify:
- Confirm tier appears in Core and changes between stable vs warning-heavy conditions.
- Confirm cue+tier remain non-blocking and do not trigger automatic actions.

### Step 2 — Details group confidence qualifiers
Intended behavior:
- Add concise confidence qualifiers to existing `Session`/`Recovery`/`Noise`/`Diagnostics` hint lines.
Manual verify:
- Expand Details and confirm each group includes compact qualifier text.
- Confirm existing disclosure/toggle/count behavior remains unchanged.

### Step 3 — Confidence copy consistency polish
Intended behavior:
- Normalize confidence phrasing so Core and Details use one coherent terminology set.
Manual verify:
- Confirm no mixed/conflicting confidence phrasing across advisory surfaces.
- Confirm no signal logic/persistence/backend/API changes were introduced.

### Step 4 — Calibration loop closeout
Intended behavior:
- Finalize repeatable confidence-calibration verification loop and sync docs to current UI behavior/endpoints.
Manual verify:
- Run inspect -> act -> recheck loop and confirm confidence cues shift coherently with posture.
- Confirm no endpoint requirement or contract-breaking behavior is introduced.

Status: PHASE 27 DoD — PASS

---

# 🚀 PHASE 28 — Response Quality & Prompt Calibration Pack (Current Stack)

Goal: Improve assistant response quality and consistency by calibrating prompt framing and quality signals across existing system prompt/preset flows, without changing architecture or endpoint contracts.

Brief summary of existing Phase 28 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 28.
- This section formalizes a UI-first response-quality calibration pass built on existing confidence/advisory layers from Phase 27.

Architecture guardrails for Phase 28:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend only existing composer/system-prompt/preset and advisory UI surfaces.
- Use only existing endpoints/contracts: `/api/chat`, `/api/kb/append`, `/api/features`, `/api/auth/me`.
- Preserve existing signal computations/persistence schemas; scope is prompt framing, copy calibration, and non-blocking UI guidance.
- Keep all guidance advisory and non-blocking; no forced prompt rewrites or automatic sends.

## 28.1 Scope (Response Quality Calibration, Existing Surfaces)

### Item A — Prompt quality cue in composer flow (soft)
User-facing behavior:
- User sees a compact prompt-quality cue before sending, based on already available local context (preset/system prompt + advisory posture).
- Cue helps refine phrasing but never blocks send.
Uses existing UI surface:
- Existing composer area and surrounding workflow hint text.
Payload/API compatibility:
- No endpoint/payload changes; uses current UI state and existing `/api/chat` flow.

### Item B — Preset/system prompt calibration hints (soft)
User-facing behavior:
- User sees concise guidance on when to tighten/relax prompt framing for better response quality.
- Guidance stays compact and optional.
Uses existing UI surface:
- Existing Preset selector, system prompt editor, and workflow quick-action context.
Payload/API compatibility:
- No endpoint/payload changes; render/copy-only hints from existing state.

### Item C — Response quality confidence alignment tag (soft)
User-facing behavior:
- User gets a compact quality-confidence tag aligned with Phase 27 confidence signals to indicate expected response reliability.
- Tag remains advisory and non-blocking.
Uses existing UI surface:
- Existing Preflight/Model Stats advisory lines and core action cue area.
Payload/API compatibility:
- No endpoint/payload changes; derived from existing local confidence/signal outputs.

### Item D — Repeatable quality calibration loop
User-facing behavior:
- User can run a loop: adjust prompt framing -> send via existing flow -> inspect confidence/quality cues -> refine prompt.
- Loop improves repeatability of higher-quality answers without architectural changes.
Uses existing UI surface:
- Existing composer, preset/system prompt controls, and advisory signal surfaces.
Payload/API compatibility:
- No new contract requirements; existing endpoints and controls only.

## 28.2 Phase 28 Acceptance Criteria (Explicit DoD)

Phase 28 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI surfaces and current backend endpoints.
- [x] Prompt quality cue appears in composer flow and remains advisory/non-blocking.
- [x] Preset/system prompt calibration hints are compact, consistent, and optional.
- [x] Response quality confidence tag aligns with existing Phase 27 confidence terminology.
- [x] Existing signal computations and persistence schemas remain unchanged.
- [x] `/api/chat`, `/api/kb/append`, `/api/features`, and `/api/auth/me` remain backward-compatible.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

## 28.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Prompt quality cue scaffold
Intended behavior:
- Add a compact, non-blocking prompt-quality cue near the existing composer/send flow using current local context.
Manual verify:
- Confirm cue appears while composing and updates with preset/system prompt context changes.
- Confirm send behavior remains unchanged and no new API interaction is introduced.

### Step 2 — Preset/system prompt calibration hint pass
Intended behavior:
- Add concise calibration hints for preset/system prompt usage to improve expected response quality.
Manual verify:
- Switch presets/edit system prompt and confirm hints update coherently.
- Confirm hints remain compact and do not alter prompt content automatically.

### Step 3 — Quality confidence alignment tag
Intended behavior:
- Add a compact quality-confidence tag aligned to existing confidence posture terminology from Phase 27.
Manual verify:
- Confirm tag shifts logically under stable vs warning-heavy signal posture.
- Confirm no changes to signal derivation logic, persistence semantics, or endpoint behavior.

### Step 4 — Quality calibration closeout
Intended behavior:
- Finalize repeatable response-quality calibration loop and sync docs to current UI behavior/endpoints.
Manual verify:
- Run compose -> send -> inspect cues -> refine loop and confirm improvements are observable/repeatable.
- Confirm no endpoint requirement or contract-breaking behavior is introduced.

Status: PHASE 28 DoD — PASS

---

# 🚀 PHASE 29 — Conversation Guidance & Context Awareness Pack (Current Stack)

Goal: Improve how REZ-AI understands and reflects conversation context during active chat by surfacing compact, non-blocking guidance cues that help users keep prompts and follow-ups coherent.

Brief summary of existing Phase 29 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 29.
- This section defines a minimal, UI-first conversation-awareness plan built on existing Phase 28 prompt-quality cues and existing advisory signals.

Architecture guardrails for Phase 29:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend only existing chat message/composer/advisory surfaces.
- Use only existing endpoints/contracts: `/api/chat`, `/api/kb/append`, `/api/features`, `/api/auth/me`.
- Keep `/api/chat` request/response contract unchanged.
- Preserve existing signal computations and persistence semantics; scope is UI guidance/copy/rendering only.
- Keep all cues advisory and non-blocking; no forced edits/auto-send behavior.

## 29.1 Scope (Conversation Awareness, Existing Surfaces)

### Item A — Conversation continuity cue near composer
User-facing behavior:
- User sees a compact continuity cue that summarizes whether the next prompt appears aligned with recent conversation context.
- Cue nudges clarification only when continuity looks weak.
Uses existing UI surface:
- Existing composer hint area near prompt-quality and scaffold helpers.
Payload/API compatibility:
- No endpoint/payload changes; derived from existing local chat/composer context.

### Item B — Lightweight message-level context hints
User-facing behavior:
- User sees small non-blocking hints near recent assistant/user messages indicating context carry-over quality (e.g., coherent/mixed/needs-clarification).
- Hints remain compact and optional for quick scanning.
Uses existing UI surface:
- Existing chat message list/message meta area.
Payload/API compatibility:
- No endpoint/payload changes; render-only hints from existing message history.

### Item C — Prompt continuation guidance (follow-up shaping)
User-facing behavior:
- User receives a concise follow-up guidance hint (what to include next: goal delta, constraints delta, expected output delta) when continuity is mixed.
- Guidance improves iterative prompt quality without overriding user input.
Uses existing UI surface:
- Existing composer hint line(s) and current prompt-quality cue region.
Payload/API compatibility:
- No endpoint/payload changes; local advisory copy only.

### Item D — Repeatable context-awareness verification loop
User-facing behavior:
- User can run a loop: send prompt -> inspect continuity hint -> adjust follow-up -> re-check continuity.
- Loop helps maintain coherent multi-turn conversations.
Uses existing UI surface:
- Existing chat list, message area, composer, and current advisory cue surfaces.
Payload/API compatibility:
- No new contract requirements; existing endpoints and UI controls only.

## 29.2 Phase 29 Acceptance Criteria (Explicit DoD)

Phase 29 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI surfaces and current backend endpoints.
- [x] Composer shows compact continuity guidance that is advisory and non-blocking.
- [x] Message-level context hints are visible, compact, and do not redesign chat layout.
- [x] Follow-up shaping guidance improves continuity clarity without modifying user text automatically.
- [x] Existing signal computations and persistence semantics remain unchanged.
- [x] `/api/chat` contract remains unchanged; `/api/kb/append`, `/api/features`, `/api/auth/me` remain backward-compatible.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

## 29.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Composer continuity cue scaffold
Intended behavior:
- Add one compact continuity cue in composer hint area based on current input and recent conversation context.
Manual verify:
- Confirm cue appears while composing and updates as conversation/input evolves.
- Confirm cue remains advisory and does not alter send behavior.

### Step 2 — Message-level context hint pass
Intended behavior:
- Add lightweight context carry-over hints near recent messages without changing message content structure.
Manual verify:
- Confirm hints appear for recent messages and remain visually compact.
- Confirm no layout redesign or API interaction changes are introduced.

### Step 3 — Follow-up shaping guidance polish
Intended behavior:
- Add concise follow-up guidance copy for mixed continuity scenarios (goal/constraints/output delta).
Manual verify:
- Confirm guidance appears only when needed and stays compact/non-blocking.
- Confirm no existing signal logic/persistence behavior changes.

### Step 4 — Context loop closeout
Intended behavior:
- Finalize repeatable context-awareness verification loop and sync docs with implemented UI behavior.
Manual verify:
- Run send -> inspect hint -> adjust follow-up -> recheck loop and confirm continuity guidance improves iterative flow.
- Confirm no endpoint requirement or contract-breaking behavior is introduced.

Status: PHASE 29 DoD — PASS

---

# 🚀 PHASE 30 — Conversation Memory & Context Compression Pack (Current Stack)

Goal: Improve conversation continuity and response accuracy by adding lightweight conversation memory and context compression cues across existing chat surfaces.

Brief summary of existing Phase 30 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 30.
- This phase introduces UI-first context-memory/compression guidance so long chats remain coherent without backend architecture changes.

Architecture guardrails for Phase 30:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/routing; extend only existing chat/composer/advisory UI areas.
- Use existing endpoints/contracts only: `/api/chat`, `/api/kb/append`, `/api/features`, `/api/auth/me`.
- Keep `/api/chat` contract unchanged.
- No new databases, no new storage layers, and no backend persistence redesign.
- Preserve existing signal computations/persistence semantics; keep all additions advisory and non-blocking.

## 30.1 Scope (Memory + Compression, Existing Surfaces)

### Item A — Conversation memory cues (soft)
User-facing behavior:
- User sees compact cues indicating what recent context is likely most relevant for the next prompt.
- Cues help preserve continuity in multi-turn workflows without forcing behavior.
Uses existing UI surface:
- Existing composer hint area and nearby conversation guidance lines.
Payload/API compatibility:
- No endpoint/payload changes; derived from existing local chat/composer state.

### Item B — Context compression for long chats (soft)
User-facing behavior:
- User gets a short compression hint when thread complexity/length grows (e.g., suggest narrowing to key points).
- Hint remains one-line and optional.
Uses existing UI surface:
- Existing composer hint region and/or compact advisory lines in chat sidebar/main area.
Payload/API compatibility:
- No endpoint/payload changes; UI-only render guidance from current local message context.

### Item C — Assistant response continuity hints (soft)
User-facing behavior:
- User sees lightweight hints indicating whether next response should continue prior result/error trajectory.
- Improves coherence of follow-up prompts and expected assistant responses.
Uses existing UI surface:
- Existing message/composer continuity hints and advisory context lines.
Payload/API compatibility:
- No endpoint/payload changes; no contract updates required.

### Item D — Lightweight context summary display (soft)
User-facing behavior:
- User can view a compact summary snippet of current conversation context (high-signal only) to reduce repetition.
- Summary remains advisory and non-blocking.
Uses existing UI surface:
- Existing composer/chat hint area (no new panel/page required).
Payload/API compatibility:
- No endpoint/payload changes; summary is UI-derived from existing local state.

## 30.2 Phase 30 Acceptance Criteria (Explicit DoD)

Phase 30 is DONE only if all pass:
- [x] All scoped items (A-D) are implemented via existing UI surfaces and current backend endpoints.
- [x] Conversation memory cues are visible, compact, and advisory-only.
- [x] Long-chat context compression hint improves clarity without layout redesign.
- [x] Continuity hints and lightweight context summary improve follow-up coherence.
- [x] Existing signal computations and persistence semantics remain unchanged.
- [x] `/api/chat` contract remains unchanged; `/api/kb/append`, `/api/features`, and `/api/auth/me` stay backward-compatible.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

## 30.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — Conversation memory cue scaffold
Intended behavior:
- Add compact memory cue(s) in existing composer guidance area to surface most relevant prior context.
Manual verify:
- Confirm cue appears and updates as chat context changes.
- Confirm cue is advisory/non-blocking and does not alter send behavior.

### Step 2 — Long-chat compression hint
Intended behavior:
- Add one-line compression hint when conversation appears broad/long to encourage concise follow-up.
Manual verify:
- Confirm hint appears in long/multi-topic context and stays compact.
- Confirm no API/network/contract behavior changes.

### Step 3 — Response continuity hint polish
Intended behavior:
- Add/refine continuity hint wording so user can explicitly continue last result/error path.
Manual verify:
- Confirm hint wording is coherent for follow-up scenarios.
- Confirm no changes to signal derivation or persistence semantics.

### Step 4 — Context summary closeout
Intended behavior:
- Finalize lightweight context summary display and document repeatable memory+compression verification loop.
Manual verify:
- Run multi-turn flow and confirm summary/cues improve continuity and response quality.
- Confirm no new endpoint requirement or contract-breaking behavior is introduced.

Status: PHASE 30 DoD — PASS

---

# 🚀 PHASE 31 — Conversation Context Compression (Current Stack)

Goal: Prevent context drift in long chats by maintaining a rolling local conversation summary.

Brief summary of existing Phase 31 intent (from current document text):
- `CURRENT NEXT STEP` now points to implementing Phase 31.
- This phase introduces client-side conversation context compression to keep prompts coherent while reducing long-history payload pressure.

Architecture guardrails for Phase 31:
- No new backend services.
- No new storage layers.
- `/api/chat` contract remains unchanged.
- Summary is generated client-side only.
- Use existing local state (`messages` array) and current UI flow.
- No new pages/routing; current architecture only.

## 31.1 Scope (Conversation Context Compression, Existing Surfaces)

### Item A — Rolling conversation summary
User-facing behavior:
- App maintains a compact rolling summary string representing recent conversation context.
- Summary refreshes every N messages (default 6) to reduce drift.
Uses existing UI surface:
- Existing chat/composer local state management (no new panel required for baseline behavior).
Payload/API compatibility:
- UI-only local derivation; no endpoint or schema changes.

### Item B — Context assembly for `/api/chat`
User-facing behavior:
- On send, context is assembled as: summary + last 4 messages, instead of full history payload.
- User should experience more stable continuity in longer threads.
Uses existing UI surface:
- Existing composer send flow and current chat message pipeline.
Payload/API compatibility:
- `/api/chat` contract shape remains unchanged; only client-side context composition changes.

### Item C — Token protection
User-facing behavior:
- Summary stays capped (about 400 chars) to prevent prompt bloat.
- Context remains concise even for long sessions.
Uses existing UI surface:
- Existing local context assembly logic before send.
Payload/API compatibility:
- No endpoint changes; local truncation/guard only.

### Item D — UI transparency (advanced/debug)
User-facing behavior:
- Optional debug line shows current context summary only when advanced tools are enabled.
- Keeps normal UI clean while allowing operator visibility.
Uses existing UI surface:
- Existing composer hint area (advanced tools mode).
Payload/API compatibility:
- No endpoint changes; render-only informational display.

## 31.2 Phase 31 Acceptance Criteria (Explicit DoD)

Phase 31 is DONE only if all pass:
- [x] Summary updates every 6 messages.
- [x] Context sent = summary + last 4 messages.
- [x] No backend/API changes.
- [x] Token usage reduced for long chats.
- [x] Debug summary visible only in advanced tools mode.
- [x] `/api/chat` contract remains unchanged.
- [x] Manual checks are documented in `docs/REZ_AI_UI_PROGRESS.md`.

## 31.3 Minimal Implementation Plan (Isolated Steps)

### Step 1 — summary state
Intended behavior:
- Add local summary state and baseline update trigger tied to message count cadence (default every 6 messages).
Manual verify:
- Send messages and confirm summary state refreshes at expected interval.
- Confirm no backend or API-side changes are required.

### Step 2 — update summary generator
Intended behavior:
- Implement lightweight client-side summary generator from existing `messages` content.
- Keep output concise and stable for continuity usage.
Manual verify:
- Confirm generated summary reflects major conversation intent.
- Confirm summary remains readable and does not exceed target cap after trimming.

### Step 3 — context assembly logic
Intended behavior:
- Use summary + last 4 messages for outgoing context assembly while preserving request contract shape.
Manual verify:
- Confirm send flow works unchanged and responses remain coherent.
- Confirm full-history send path is replaced by compressed context assembly logic.

### Step 4 — debug display
Intended behavior:
- Add optional advanced-tools-only debug line: `Context summary: ...` in composer hint region.
Manual verify:
- Confirm debug line appears only when advanced tools are enabled.
- Confirm normal mode stays uncluttered and no network/API behavior changes occur.

Status: PHASE 31 DoD — PASS

---

# 🚀 PHASE 32 — Prompt Quality Hardening (UI-only, Current Stack)

Goal: Improve prompt grounding and reduce hallucinations while keeping `/api/chat` contract unchanged.

## 32.1 Phase 32 Acceptance Criteria (DoD closeout)

Phase 32 is DONE only if all pass:
- [x] Step 1 complete: system prompt hardening for global + General behavior.
- [x] Step 2 complete: Developer anti-hallucination rules and unknown fallback are enforced.
- [x] Step 3 complete: Developer response structure is enforced with append-once guard.
- [x] Step 4 complete: DoD regression verification is documented in `docs/REZ_AI_UI_PROGRESS.md`.

Status: PHASE 32 DoD — PASS

---

# 🚀 PHASE 33 — Repo-aware Dev Assistant (Current Stack)

Goal: Improve developer-task reliability by making assistant guidance explicitly repo-aware, verifiable, and non-hallucinated while keeping current architecture and `/api/chat` contract unchanged.

Brief summary:
- Phase 33 focuses on "dev assistant quality loop" behavior in existing UI prompt assembly and docs workflow.
- The objective is to increase concrete, file-grounded outputs for coding tasks without adding new backend services or endpoints.

Architecture guardrails for Phase 33:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/storage layers; stay inside existing composer/preset/prompt surfaces and docs.
- Keep `/api/chat` request/response shape unchanged; only prompt-content or UI copy/visibility changes are allowed.
- Keep behavior soft/non-blocking; no hard lockouts added for normal chat flows.

## 33.1 Scope (Repo-aware Dev Assistant, Existing Surfaces Only)

### Item A — Repo-aware response contract cues (Developer preset)
User-facing behavior:
- Developer guidance explicitly prioritizes confirmed repo paths/symbols and avoids generic implementation claims.
- If exact repo context is missing, response uses existing unknown fallback pattern instead of inventing paths/endpoints.
Uses existing UI area:
- Existing prompt-hardening path in `apps/ui/src/App.jsx` (Developer preset behavior).
Payload compatibility:
- No payload key changes; only content of `systemPrompt` guidance is refined.

### Item B — Verification-first output posture
User-facing behavior:
- Developer outputs consistently include concrete manual verification steps tied to touched surfaces.
- Guidance emphasizes "what to click/what to check" for UI verification requests.
Uses existing UI area:
- Existing composer hint/rules path and current Developer response structure requirements.
Payload compatibility:
- Existing `/api/chat` payload fields remain unchanged.

### Item C — Prompt quality alignment for dev tasks
User-facing behavior:
- Prompt-shaping hints better nudge users toward file + constraint + acceptance-criteria phrasing for coding requests.
- Behavior remains compact and non-blocking in current composer hint region.
Uses existing UI area:
- Existing composer hint lines and helper controls in `apps/ui/src/App.jsx`.
Payload compatibility:
- No endpoint changes; prompt guidance remains local UI logic.

### Item D — Docs-backed reliability loop
User-facing behavior:
- Progress and verification for developer-assistant hardening are tracked in docs with repeatable checks.
- Team can quickly audit whether changes improve grounded responses.
Uses existing UI area:
- Existing docs workflow (`REZ_AI_MASTER_PLAN.md`, `REZ_AI_UI_PROGRESS.md`, `REZ_AI_CONTEXT.md`).
Payload compatibility:
- Docs-only process improvements; runtime contract unaffected.

## 33.2 Phase 33 Acceptance Criteria (DoD)

Phase 33 is DONE only if all pass:
- [x] Phase 33 Step 1-3 changes are completed within existing UI/docs surfaces only.
- [x] Developer guidance remains repo-aware and avoids invented file paths/endpoints.
- [x] General preset remains concise and is not forced into Developer-only structure.
- [x] `/api/chat` request/response contract remains unchanged.
- [x] Verification results are logged in `docs/REZ_AI_UI_PROGRESS.md`.

Status: PHASE 33 DoD — PASS

## 33.3 Minimal Step Plan (1-4)

### Step 1 — Dev task grounding cues
Intended behavior:
- Strengthen Developer preset guidance to prioritize confirmed repo context, exact edits, and scoped outcomes.
Manual verify:
- Send Developer coding request and confirm response references only known/confirmed paths or unknown fallback.
- Confirm no API contract changes.

### Step 2 — Verification-first hints
Intended behavior:
- Refine compact guidance to ensure manual verify steps are always practical and surface-specific.
Manual verify:
- Ask for UI fix and confirm response includes precise check steps ("where to click/what to look for").
- Confirm behavior stays non-blocking and compact.

### Step 3 — Prompt quality calibration for dev requests
Intended behavior:
- Improve prompt-shaping copy so dev requests are framed with task, constraints, acceptance criteria, and repo context.
Manual verify:
- Switch presets and confirm Developer-oriented shaping remains distinct while General remains concise.
- Confirm no endpoint/payload/schema changes.

### Step 4 — Closeout (DoD PASS) + docs sync
Intended behavior:
- Mark Phase 33 DoD PASS only after Step 1-3 verification is documented and contract stability is reconfirmed.
Manual verify:
- Re-run checklist and ensure `REZ_AI_UI_PROGRESS.md` includes the Phase 33 verification record.
- Confirm `CURRENT NEXT STEP` is updated to the next phase or explicitly marked unknown.

---

# 🚀 PHASE 34 — KB/RAG Quality Upgrade (Current Stack)

Goal: Improve KB/RAG answer quality and refresh workflow reliability while keeping current architecture stable and avoiding unverified claims about implemented embedding providers.

Brief summary:
- Current KB pipeline is working (`kb.json` + `kb_vectors.json`) and assistant retrieval is active.
- Semantic retrieval currently uses deterministic/heuristic vectors, and KB rebuild remains manual.
- Phase 34 focuses on quality and workflow upgrades within the existing stack, while preparing a safe path for real embedding providers later.

Architecture guardrails for Phase 34:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/storage layers unless explicitly introduced in a later phase.
- Keep `/api/chat` request/response shape unchanged; quality improvements should be additive and backward-compatible.
- Do not claim external embedding provider integration as implemented unless code/runtime verifies it.

## 34.1 Scope (KB/RAG Quality Upgrade, Existing Surfaces First)

### Item A — Retrieval quality tuning (current artifacts)
User-facing behavior:
- KB-assisted answers become more relevant and consistent for repeated project questions.
- Citation relevance improves without changing normal chat behavior.
Uses existing area:
- Existing assistant KB load/retrieval path and current cache artifacts (`kb.json`, `kb_vectors.json`).
Payload compatibility:
- No required `/api/chat` key changes.

### Item B — Heuristic semantic path hardening
User-facing behavior:
- Semantic + hybrid retrieval behavior becomes more predictable under current deterministic vector approach.
- Failure modes remain soft with readable behavior when KB signals are weak.
Uses existing area:
- Existing assistant retrieval/rerank logic (no new runtime service required).
Payload compatibility:
- Existing response shape remains unchanged; citations/meta stay additive.

### Item C — Refresh/rebuild workflow quality
User-facing behavior:
- KB update workflow is clearer and less error-prone for local operation.
- Rebuild steps are easier to run/verify after KB source changes.
Uses existing area:
- Existing `scripts/kb_build.js`, `data/kb/`, and current docs workflow.
Payload compatibility:
- No API contract changes required.

### Item D — Future embedding-provider readiness (planned, not implemented)
User-facing behavior:
- Project has a documented migration path for real embedding providers later.
- No misleading UI/runtime claims about provider-backed embeddings before implementation.
Uses existing area:
- Existing roadmap/docs (`REZ_AI_MASTER_PLAN.md`, `REZ_AI_CONTEXT.md`, `REZ_AI_UI_PROGRESS.md`).
Payload compatibility:
- Planning-only in this phase block; runtime contract unchanged.

## 34.2 Phase 34 Acceptance Criteria (DoD)

Phase 34 is DONE only if all pass:
- [x] Retrieval quality tuning work is completed without regressing current chat flow.
- [x] Heuristic/deterministic semantic retrieval behavior is clearly documented as current reality.
- [x] KB refresh/rebuild workflow guidance is updated and verifiable.
- [x] Any embedding-provider path is documented as planned unless actually implemented and verified.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: PHASE 34 DoD — PASS

## 34.3 Minimal Step Plan (1-4)

### Step 1 — Baseline retrieval quality pass
Intended behavior:
- Tune/validate current retrieval heuristics using existing KB artifacts and current assistant flow.
Manual verify:
- Run representative KB questions and confirm relevance improves without contract change.
- Confirm normal non-KB chat behavior remains stable.

### Step 2 — Semantic/hybrid behavior hardening
Intended behavior:
- Improve predictability of current heuristic semantic + hybrid retrieval path under existing architecture.
Manual verify:
- Validate stable retrieval outcomes across repeated prompts and mixed query styles.
- Confirm failure paths remain soft/non-blocking.

### Step 3 — Refresh workflow polish (manual path)
Intended behavior:
- Clarify and harden manual KB refresh process with current audited flow:
  1) append/update source content (including `/api/kb/append` -> `data/kb/notes.txt`)
  2) run `npm run kb:build`
  3) verify cache artifacts (`data/cache/kb.json`, `data/cache/kb_vectors.json`)
  4) verify retrieval with `useKB=true`
Manual verify:
- Confirm append path writes to `data/kb/notes.txt` (no auto-rebuild claim).
- Run `npm run kb:build` and confirm both cache artifacts are regenerated.
- Ask KB-style question with `useKB=true` and confirm retrieval + citations remain compatible.
- Confirm docs state semantic retrieval is heuristic/deterministic and embedding-provider integration is still planned.

### Step 4 — Closeout (DoD PASS) + docs sync
Intended behavior:
- Mark Phase 34 DoD PASS only after quality checks and docs verification are logged.
Manual verify:
- Confirm `REZ_AI_UI_PROGRESS.md` includes verification ledger for Step 1-3.
- Confirm `CURRENT NEXT STEP` is advanced after closeout.

---

# 🚀 PHASE 35 — Tool / Automation Layer (Current Stack)

Goal: Add safe tool-style and automation helpers on top of the current working core (chat + KB/RAG) without changing architecture or `/api/chat` contract.

Brief summary:
- Current core app is stable and usable.
- KB/RAG is operational with known limitations (heuristic/deterministic semantic path, manual rebuild workflow).
- No full tool-execution runtime is implemented yet; Phase 35 is a planned, incremental layer.

Architecture guardrails for Phase 35:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/storage layers unless explicitly introduced in a later scoped phase.
- Keep `/api/chat` request/response shape unchanged; automation helpers should be additive and backward-compatible.
- Keep safety-first behavior: no destructive actions by default, no hidden background side effects.

## 35.1 Scope (Tool / Automation Layer, Planned)

### Item A — Safe tool-style actions
User-facing behavior:
- User can run bounded helper actions (summaries/checklists/refinement prompts) that stay non-destructive and reviewable before execution.
Uses existing area:
- Existing UI workflow/composer helpers and assistant prompt path.
Payload compatibility:
- No required `/api/chat` key changes.

### Item B — Workflow/automation helper pack
User-facing behavior:
- User gets compact automation-ready helpers for repeated project routines (status checks, release prep, follow-up batching).
Uses existing area:
- Existing quick actions + composer helper surfaces.
Payload compatibility:
- Existing payload/response shape remains unchanged.

### Item C — Repo/project analysis support (safe mode)
User-facing behavior:
- User can request structured project/repo analysis outputs (findings, risk lists, verify checklists) using current context and available artifacts.
Uses existing area:
- Existing assistant response flow and docs-led verification workflow.
Payload compatibility:
- No API contract changes required.

### Item D — Reporting/logging helper outputs
User-facing behavior:
- User can produce repeatable report-style outputs for audits/progress updates without introducing a new execution subsystem.
Uses existing area:
- Existing docs/update workflow (`REZ_AI_UI_PROGRESS.md`, `REZ_AI_CONTEXT.md`, `REZ_AI_MASTER_PLAN.md`).
Payload compatibility:
- Planning/output format layer only; runtime contract unchanged.

## 35.2 Phase 35 Acceptance Criteria (DoD)

Phase 35 is DONE only if all pass:
- [x] Tool/automation helper behavior is implemented as safe, non-destructive, and review-first.
- [x] No full tool-execution backend/runtime claims are introduced without implementation.
- [x] Repo/project analysis helper outputs are structured and reproducible.
- [x] Reporting helper outputs are documented and verifiable.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: PHASE 35 DoD — PASS

## 35.3 Minimal Step Plan (1-4)

### Step 1 — Safe tool-style helper baseline
Intended behavior:
- Add first set of safe helper actions that improve operator productivity without altering backend contracts.
Manual verify:
- Run helper actions and confirm outputs are non-destructive and reviewable.
- Confirm chat contract unchanged.

### Step 2 — Workflow automation helper calibration
Intended behavior:
- Improve helper consistency for recurring tasks (compact, repeatable, low-noise outputs).
Manual verify:
- Run repeated helper scenarios and confirm stable output shape and usability.
- Confirm no architecture/service/storage changes.

### Step 3 — Repo/project analysis support pass
Intended behavior:
- Add/standardize analysis-oriented helper behavior for project/repo checks and reporting prompts.
Manual verify:
- Run representative analysis requests and confirm structured findings + verify checklist outputs.
- Confirm behavior remains soft/non-blocking.

### Step 4 — Closeout (DoD PASS) + docs sync
Intended behavior:
- Mark Phase 35 DoD PASS only after Step 1-3 verification is logged and contract stability is reconfirmed.
Manual verify:
- Confirm `REZ_AI_UI_PROGRESS.md` includes Phase 35 verification ledger.
- Confirm `CURRENT NEXT STEP` is advanced after closeout.

---

# 🚀 PHASE 36 — Identity / Entitlement Foundation (Current Stack)

Goal: Establish identity and entitlement groundwork using existing auth/profile/plan signals, while keeping billing/subscription decisions for a later phase and preserving the current architecture.

Brief summary:
- Auth scaffold already exists in the backend (`/api/auth/me` + auth-aware feature context paths).
- Local `planMode` state/propagation already exists for UI/business-ready simulation.
- No real billing/subscription system is implemented yet.
- No backend entitlement enforcement layer is implemented yet.

Architecture guardrails for Phase 36:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/storage layers unless explicitly introduced in a later scoped phase.
- Keep `/api/chat` request/response shape unchanged; identity/entitlement work must remain additive and backward-compatible.
- Keep billing/provider commercial decisions explicitly out-of-scope for this phase (foundation only).

## 36.1 Scope (Identity / Entitlement Foundation, Planned)

### Item A — Identity/account foundation signals
User-facing behavior:
- User identity context is clearer and easier to verify in local flow (authenticated vs unauthenticated posture).
- Identity-related behavior remains soft/non-blocking for current local-first usage.
Uses existing area:
- Existing backend auth scaffold and existing UI status/feature surfaces.
Payload compatibility:
- No required `/api/chat` key changes.

### Item B — Entitlement groundwork (plan awareness)
User-facing behavior:
- Plan awareness remains consistent across UI surfaces using current `planMode`/feature-flag posture.
- Entitlement-related cues are clear without hard lockouts.
Uses existing area:
- Existing plan controls, feature flags endpoint, and current helper/workflow surfaces.
Payload compatibility:
- Existing optional `planMode` usage remains compatible.

### Item C — User/plan observability hygiene
User-facing behavior:
- User can understand which behaviors are local simulation vs identity-aware signals.
- Entitlement state communication is explicit and non-misleading.
Uses existing area:
- Existing docs, local status hints, and feature/auth read surfaces.
Payload compatibility:
- No API contract changes required.

### Item D — Billing decision deferral (planned later)
User-facing behavior:
- No false promise of active billing/subscription features.
- Project clearly communicates that billing/provider choices are postponed to a future phase.
Uses existing area:
- Existing roadmap/docs (`REZ_AI_MASTER_PLAN.md`, `REZ_AI_CONTEXT.md`, `REZ_AI_UI_PROGRESS.md`).
Payload compatibility:
- Planning/documentation only; runtime contract unchanged.

## 36.2 Phase 36 Acceptance Criteria (DoD)

Phase 36 is DONE only if all pass:
- [x] Identity/auth foundation behavior is documented and verifiable against current scaffold.
- [x] Entitlement groundwork using existing plan signals is consistent and non-misleading.
- [x] No claim of implemented billing/subscription runtime is introduced.
- [x] No hard entitlement enforcement backend is claimed as implemented unless code/runtime verifies it.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: PHASE 36 DoD — PASS

## 36.3 Minimal Step Plan (1-4)

### Step 1 — Identity signal baseline
Intended behavior:
- Clarify baseline identity/account posture using existing auth scaffold and current surfaces.
Manual verify:
- Verify authenticated/unauthenticated signals are readable and consistent.
- Confirm `/api/chat` contract unchanged.

### Step 2 — Entitlement signal calibration
Intended behavior:
- Align plan/entitlement cues across existing surfaces using current `planMode` + feature flags.
Manual verify:
- Validate plan-aware cues remain consistent and non-blocking.
- Confirm no new backend enforcement logic is introduced.

### Step 3 — User/plan awareness pass
Intended behavior:
- Improve clarity of local-simulated vs identity-aware behavior in helper/workflow messaging.
Manual verify:
- Confirm user-facing wording is explicit and low-noise.
- Confirm billing/subscription remains marked as not implemented.

### Step 4 — Closeout (DoD PASS) + docs sync
Intended behavior:
- Mark Phase 36 DoD PASS only after Step 1-3 verification is logged and contract stability is reconfirmed.
Manual verify:
- Confirm `REZ_AI_UI_PROGRESS.md` includes Phase 36 verification ledger.
- Confirm `CURRENT NEXT STEP` is advanced after closeout.

---

# 🚀 PHASE 37 — Business / Billing Foundation (Current Stack)

Goal: Define and prepare business/billing foundation decisions using existing plan/auth scaffolding, while keeping real billing integration and enforcement for a carefully scoped future implementation phase.

Brief summary:
- `planMode` already exists in UI/backend flow as a local/business-ready signal.
- Auth scaffold already exists (`/api/auth/me`, auth-aware feature context paths).
- No real billing/subscription runtime is implemented yet.
- No backend entitlement enforcement runtime is implemented yet.

Architecture guardrails for Phase 37:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new services/pages/storage layers unless explicitly introduced in a later scoped phase.
- Keep `/api/chat` request/response shape unchanged; business/billing groundwork remains additive and backward-compatible.
- Keep this phase foundation/planning-first: do not imply active billing runtime before verified implementation.

## 37.1 Scope (Business / Billing Foundation, Planned)

### Item A — Pricing/plan model clarity
User-facing behavior:
- Project plan tiers and intended capabilities are documented clearly enough for implementation sequencing.
- Current local simulation signals remain explicit and non-misleading.
- Baseline wording explicitly separates `current simulated Free/Pro posture` from `future billing-backed plans`.
Uses existing area:
- Existing docs and current plan-related UI cues.
Payload compatibility:
- No required `/api/chat` key changes.

### Item B — Entitlement model definition
User-facing behavior:
- Entitlement model boundaries are defined (what should be gated where) without introducing hard enforcement yet.
- User-facing wording avoids overstating implemented business features.
- Entitlement boundary mapping is explicit by category (available now vs simulated/signaled now vs planned enforcement later):
  - **Baseline chat/runtime access:** available now in local-first posture.
  - **Helper/workflow UI unlocks:** simulated/signaled now via `planMode`/UI cues.
  - **Advanced automation/tooling controls:** planned for later entitlement enforcement; not runtime-enforced today.
  - **Hosted/business features (billing-backed):** planned later; no active billing/subscription runtime today.
Uses existing area:
- Existing plan/auth surfaces and documentation workflow.
Payload compatibility:
- Existing optional `planMode` behavior remains compatible.

### Item C — Payment/provider decision preparation
User-facing behavior:
- Project has a documented decision framework for payment/provider selection (later phase implementation).
- No false claims about already integrated billing providers.
- Billing/provider decision-prep pack is explicit and implementation-ready without locking final provider choice prematurely:
  - **Provider selection criteria:** integration fit, reliability/ops, cost predictability, compliance/security posture, developer ergonomics.
  - **Implementation prerequisites:** entitlement source-of-truth definition, auth-to-entitlement mapping, event/audit logging plan, rollback strategy.
  - **Rollout safety constraints:** staged rollout, feature flags/kill-switch, shadow/soft-check period before hard enforcement, explicit fallback behavior.
  - **Pre-enforcement verification gates:** contract stability, non-misleading UI wording, reconciliation checks between simulated plan cues and backend entitlement decisions.
Uses existing area:
- Existing roadmap/docs (`REZ_AI_MASTER_PLAN.md`, `REZ_AI_CONTEXT.md`, `REZ_AI_UI_PROGRESS.md`).
Payload compatibility:
- Planning/documentation only; runtime contract unchanged.

### Item D — Implementation safety staging
User-facing behavior:
- Billing integration is staged with explicit safety checks before any hard enforcement rollout.
- Current local-first usability is preserved until future implementation is verified.
Uses existing area:
- Existing docs-led verification and release checklist process.
Payload compatibility:
- No runtime contract changes in this planning phase.

## 37.2 Phase 37 Acceptance Criteria (DoD)

Phase 37 is DONE only if all pass:
- [x] Pricing/plan model and entitlement boundaries are documented clearly and non-misleadingly.
- [x] Billing/provider decision prep is documented as planned (not implemented).
- [x] No claim of active billing/subscription runtime is introduced without verified implementation.
- [x] No backend entitlement enforcement runtime is claimed as implemented unless code/runtime verifies it.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: `PHASE 37 DoD — PASS`

## 37.3 Minimal Step Plan (1-4)

### Step 1 — Pricing/plan clarity baseline
Intended behavior:
- Define baseline plan/pricing model clarity in docs using current local-first signals, with explicit non-misleading boundaries:
  - **Free (current):** local-first baseline posture; plan cues are informational UI signals only; no billing runtime enforcement.
  - **Pro (current):** local simulated Pro posture; enables plan-aware UI cues/helper unlock messaging only; not a paid entitlement yet.
  - **Later billing phase (planned):** real pricing, provider/payment integration, and backend entitlement enforcement will be scoped and implemented in a future phase.
Manual verify:
- Confirm wording distinguishes current simulation from future billing runtime.
- Confirm docs do not present pricing/provider/payment decisions as already implemented.
- Confirm no contract changes.

### Step 2 — Entitlement boundary mapping
Intended behavior:
- Map entitlement boundaries and expected enforcement touchpoints for a later implementation phase using explicit category mapping:
  - **Available now (Free/local-first):** baseline chat/runtime path remains usable with current local simulation posture.
  - **Simulated now (Pro signal):** plan-aware UI/helper cues can signal Pro posture, but remain non-billing and non-enforced.
  - **Planned later (billing/enforcement-backed):** entitlement checks, billing state, and enforcement decisions are deferred to future scoped implementation.
Manual verify:
- Confirm boundary definitions are explicit and non-ambiguous.
- Confirm category mapping clearly separates available now vs simulated now vs planned enforcement later.
- Confirm no pricing/provider/enforcement decision is presented as already finalized/implemented.
- Confirm no runtime enforcement is introduced in this phase.

### Step 3 — Billing/provider decision prep pack
Intended behavior:
- Document payment/provider decision criteria and implementation safety constraints for later phase execution with a compact prep pack:
  - define provider evaluation checklist (no final provider lock-in unless later explicitly approved),
  - define entitlement source-of-truth prerequisites,
  - define rollout safety checks and pre-enforcement gates,
  - define migration path from local simulation/signaling (`planMode` + UI cues) to future billing-backed enforcement.
Manual verify:
- Confirm docs avoid false implementation claims and stay audit-aligned.
- Confirm prep-pack categories are explicit (criteria, prerequisites, safety checks, migration path).
- Confirm current reality remains explicit: no active billing runtime and no backend entitlement enforcement today.
- Confirm architecture guardrails remain explicit.

### Step 4 — Closeout (DoD PASS) + docs sync
Intended behavior:
- Mark Phase 37 DoD PASS only after Step 1-3 verification is logged and contract stability is reconfirmed.
Manual verify:
- Confirm `REZ_AI_UI_PROGRESS.md` includes Phase 37 verification ledger.
- Confirm `CURRENT NEXT STEP` is advanced after closeout.

---

# 🚀 PHASE 38 — Multi-User / Workspace Foundation (Current Stack)

Goal: Prepare REZ-AI for multi-user/product-ready operation by documenting workspace and role foundations clearly, without introducing runtime changes, new services, or `/api/chat` contract changes.

Brief summary:
- Current stack remains local-first with single-runtime behavior.
- This phase defines conceptual multi-user/workspace models for future implementation.
- No active multi-user runtime, billing runtime, or backend entitlement enforcement is introduced in this phase.

Architecture guardrails for Phase 38:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new endpoints/pages/services/storage layers in this phase.
- Keep `/api/chat` request/response shape unchanged and backward-compatible.
- Keep phase output docs-first and implementation-safe; do not imply runtime multi-user support before scoped implementation.

## 38.1 Scope (Multi-User / Workspace Foundation, Planned)

### Item A — Workspace model
User-facing behavior:
- Conceptual hierarchy is explicitly documented for future implementation sequencing:
  - **User -> Workspace -> Project context**
- Conceptual model details are explicit and future-ready:
  - A **User** may own or access multiple **Workspaces**.
  - Each **Workspace** contains one or more **Project contexts**.
  - **Project context** is the future scope boundary where KB, memory, and config will be isolated.
- This item is planning groundwork only; current runtime remains single-user/local and does not implement workspace-aware runtime isolation yet.
Uses existing area:
- Existing docs and current auth/plan context surfaces.
Payload compatibility:
- No required `/api/chat` key changes.

### Item B — Context scoping
User-facing behavior:
- Future scoping rules are documented with explicit boundaries for:
  - **KB scope**
  - **memory scope**
  - **config scope**
- Current reality vs future model is explicit:
  - **Current (today):** local/global assumptions in a single-user/local runtime.
  - **Future (planned):** workspace-scoped, project-context-aware isolation model.
- Conceptual scoping boundaries (planning-only):
  - **KB scope:** workspace/project-bound knowledge context to avoid cross-workspace knowledge bleed.
  - **Memory scope:** workspace/project-bound conversation/task memory, isolated by context boundary.
  - **Config scope:** workspace/project-bound settings (model/provider/preset/policy intent) with clear ownership boundary.
- This item is planning groundwork only; runtime workspace-scoped isolation is not implemented yet.
Uses existing area:
- Existing KB/memory/config docs and current local-first behavior notes.
Payload compatibility:
- `/api/chat` contract remains unchanged in this planning phase.

### Item C — Multi-user role model
User-facing behavior:
- Future role boundaries are defined clearly for:
  - **workspace owner**
  - **workspace member**
  - **workspace viewer**
- Conceptual permission boundaries are explicit (planning-only):
  - **workspace_owner**
    - workspace management
    - member management
    - configuration ownership
  - **workspace_member**
    - project collaboration
    - KB/memory interaction
    - automation usage
  - **workspace_viewer**
    - read-only workspace visibility
    - no configuration or automation changes
- This role model is planning groundwork only; runtime role enforcement is not implemented yet.
Uses existing area:
- Existing docs-led planning and auth scaffold context.
Payload compatibility:
- No runtime contract change required in this phase.

### Item D — Product posture clarity
User-facing behavior:
- Transition path is explicit and non-misleading:
  - **local-first -> workspace-aware -> product-ready**
Uses existing area:
- Existing roadmap and architecture sections.
Payload compatibility:
- Planning/documentation only; `/api/chat` compatibility preserved.

## 38.2 Phase 38 Acceptance Criteria (DoD)

Phase 38 is DONE only if all pass:
- [x] Workspace model is documented clearly (`User -> Workspace -> Project context`).
- [x] Multi-user role model is documented clearly (owner/member/viewer).
- [x] Future workspace scoping for KB/memory/config is documented.
- [x] No claim of active runtime multi-user or billing/enforcement implementation is introduced.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: `PHASE 38 DoD — PASS`

## 38.3 Minimal Step Plan (1-4)

### Step 1 — Workspace model definition
Intended behavior:
- Define workspace model baseline and hierarchy (`User -> Workspace -> Project context`) for later implementation, including:
  - user-to-multiple-workspaces relationship,
  - workspace-to-project-context containment,
  - project-context as the future KB/memory/config scoping unit.
Manual verify:
- Confirm hierarchy is explicit and non-ambiguous.
- Confirm docs state this is conceptual planning and not runtime multi-user implementation.
- Confirm no runtime implementation claim is introduced.

### Step 2 — Context scoping model
Intended behavior:
- Define future workspace-scoped model for KB, memory, and config boundaries by explicitly separating:
  - current local/global behavior assumptions,
  - future workspace/project isolation targets,
  - conceptual boundary intent for each scope type (KB/memory/config).
Manual verify:
- Confirm scoping boundaries are practical and implementation-ready.
- Confirm docs explicitly separate current reality from future scoped model.
- Confirm docs state this is conceptual planning and not runtime scoped implementation.
- Confirm no endpoint/runtime changes are implied.

### Step 3 — Role model definition
Intended behavior:
- Define owner/member/viewer role boundaries and intended future permissions at docs level, including conceptual permission intent for:
  - workspace management and ownership controls,
  - collaboration and KB/memory interaction rights,
  - read-only visibility boundaries.
Manual verify:
- Confirm role definitions are explicit and non-overlapping.
- Confirm permission boundaries are conceptual/planning-only and not claimed as runtime-enforced.
- Confirm no enforcement/runtime claim is introduced.

### Step 4 — DoD closeout + docs sync
Intended behavior:
- Mark Phase 38 DoD PASS only after Step 1-3 verification is logged and contract stability is reconfirmed.
Manual verify:
- Confirm `REZ_AI_UI_PROGRESS.md` includes Phase 38 verification ledger.
- Confirm `CURRENT NEXT STEP` is advanced after closeout.

---

# 🚀 PHASE 39 — Context Isolation Foundation (Current Stack)

Goal: Define how assistant context will be safely isolated in a future workspace-aware architecture.

This phase establishes conceptual isolation rules for:
- KB context
- conversation memory
- configuration state
- automation/workflow context

without implementing runtime enforcement.

Architecture guardrails for Phase 39:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new endpoints/services/storage layers/pages in this phase.
- Keep `/api/chat` request/response shape unchanged and backward-compatible.
- Keep output planning-only and implementation-safe; do not imply runtime context isolation before scoped implementation.

## 39.1 Scope (Conceptual Context Isolation)

### Item A — KB isolation boundaries
Future intent:
- KB scoped per workspace.
- Optional further scoping per project context.
Purpose:
- Prevent cross-workspace knowledge bleed.
- Prevent unrelated project knowledge mixing within the same workspace.
Current reality:
- KB currently global/local.
Future boundary semantics:
- **Workspace KB:** default knowledge boundary for a workspace context.
- **Project KB (optional subset):** project-context-focused subset layered inside workspace KB.
- **Fallback/default posture (current system):** single local/global KB behavior remains active until scoped runtime implementation exists.
Explicit note:
- Runtime workspace KB isolation is not implemented yet.

### Item B — Conversation / memory isolation
Future intent:
- Memory scoped by workspace.
- Optionally further scoped by project context.
Purpose:
- Prevent task history or conversation context leaking across workspaces.
- Prevent unrelated project memory carryover inside the same workspace.
Current reality:
- Memory assumed local/global.
Future boundary semantics:
- **Workspace memory:** default memory boundary for a workspace context.
- **Project memory (optional subset):** project-context-focused memory layer inside workspace memory.
- **Fallback/default posture (current system):** single local/global memory behavior remains active until scoped runtime implementation exists.
Explicit note:
- Runtime scoped memory isolation is not implemented yet.

### Item C — Configuration isolation
Future intent:
- Configuration ownership separated by workspace level and optional project level.
Purpose:
- Prevent configuration collisions across teams/projects.
Current reality:
- Config assumed local/global.
Future boundary semantics:
- **Workspace config:** default configuration boundary for workspace-level ownership.
- **Project config (optional subset):** project-context-focused config layer inside workspace config.
- **Fallback/default posture (current system):** local/global config behavior remains active until scoped runtime implementation exists.
Explicit note:
- Runtime config scoping is not implemented yet.

### Item D — Automation / workflow isolation
Future intent:
- Workflow helpers and automation outputs scoped by workspace/project context.
Purpose:
- Prevent cross-project workflow confusion and automation leakage.
Current reality:
- Automation helpers operate in a single-user/local context.
Future boundary semantics:
- **Workspace automation context:** default automation/workflow boundary for workspace-level task context.
- **Project automation context (optional):** project-scoped automation/workflow subset inside workspace context.
- **Fallback/default posture (current system):** single-user/local automation helper behavior remains active until scoped runtime implementation exists.
Explicit note:
- Runtime scoped automation isolation is not implemented yet.

## 39.2 Phase 39 Acceptance Criteria (DoD)

Phase 39 is DONE only if all pass:
- [x] KB isolation boundaries are documented.
- [x] Conversation/memory isolation model is documented.
- [x] Configuration isolation boundaries are documented.
- [x] Automation/workflow isolation model is documented.
- [x] Docs clearly distinguish current runtime vs future isolation model.
- [x] No runtime context isolation implementation claims exist.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: `PHASE 39 DoD — PASS`

## 39.3 Minimal Step Plan (1-4)

### Step 1 — KB isolation model
Intended behavior:
- Define conceptual future KB scoping with workspace scope and optional project scope, explicitly separating:
  - current global/local KB reality,
  - future workspace KB boundary,
  - optional project-context KB subset inside workspace scope,
  - current fallback/default local KB posture.
Manual verify:
- Confirm docs explicitly distinguish current global KB vs future scoped model.
- Confirm KB isolation purpose is explicit (knowledge bleed prevention and project-mix prevention).
- Confirm docs state this is planning-only and not runtime KB isolation implementation.

### Step 2 — Memory isolation model
Intended behavior:
- Define conceptual memory boundaries for workspace memory and optional project memory, explicitly separating:
  - current local/global memory reality,
  - future workspace memory boundary,
  - optional project-context memory subset inside workspace scope,
  - current fallback/default local memory posture.
Manual verify:
- Confirm docs clearly state runtime scoped memory is not implemented yet.
- Confirm docs explicitly distinguish current memory reality vs future scoped model.
- Confirm memory isolation purpose is explicit (cross-workspace leakage prevention and project carryover prevention).
- Confirm docs state this is planning-only and not runtime memory isolation implementation.

### Step 3 — Config + automation isolation model
Intended behavior:
- Define conceptual isolation model for configuration and automation/workflow context, explicitly separating:
  - current local/global config and single-user/local automation reality,
  - future workspace-level boundaries,
  - optional project-context subsets inside workspace scope,
  - current fallback/default local behavior until scoped runtime exists.
Manual verify:
- Confirm docs remain planning-only and non-misleading.
- Confirm isolation purpose is explicit (configuration collision prevention and workflow leakage prevention).
- Confirm docs clearly state runtime config/automation isolation is not implemented yet.

### Step 4 — DoD closeout + docs sync
Manual verify:
- Confirm Phase 39 verification is logged in `REZ_AI_UI_PROGRESS.md`.

---

# 🚀 PHASE 40 — Workspace Runtime Foundation (Current Stack)

Goal: Define how workspace-aware runtime behavior will later fit into the current REZ-AI architecture without breaking the existing `/api/chat` contract.

Architecture guardrails for Phase 40:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new endpoints/pages/services/storage layers in this phase.
- Keep `/api/chat` request/response shape unchanged and backward-compatible.
- Keep this phase planning-only and implementation-safe; do not imply runtime workspace implementation before scoped delivery.

## 40.1 Scope (Workspace Runtime Foundation)

### Item A — Workspace runtime identity
Future intent:
- Runtime can resolve a workspace context.
- Workspace identity can later become available to assistant/backend flows.
Purpose:
- Enable future workspace-aware context resolution paths.
- Provide a safe boundary for future scoped KB/memory/config access.
- Support future collaboration and entitlement layers without breaking existing contract stability.
Current reality:
- Runtime remains single-user/local.
- No runtime workspace identity exists yet.
Future identity semantics:
- **Runtime active workspace (planned):** runtime may later resolve an active workspace context for request handling.
- **Runtime contract position (current):** workspace identity is not part of the current `/api/chat` contract.
- **Fallback/default posture (current system):** local/single-user runtime posture remains active until scoped runtime implementation exists.
Relationship model:
- **User -> Workspace -> Runtime context resolution** remains conceptual in this phase and defines future mapping intent only.
Explicit note:
- Runtime workspace identity is not implemented yet.

### Item B — Project-context runtime binding
Future intent:
- Runtime can bind requests to project context inside a workspace.
- Assistant context selection can later become project-aware.
Purpose:
- Allow future project-aware assistant context selection.
- Support project-scoped KB/memory/config resolution inside an active workspace.
- Reduce unrelated project context mixing within one workspace.
Current reality:
- Project context is conceptual only.
- No runtime binding exists yet.
Future binding semantics:
- **Runtime active project context (planned):** runtime may later resolve an active project context inside an active workspace.
- **Workspace/project relationship (planned):** workspace identity acts as parent boundary; project-context binding acts as nested runtime selection boundary.
- **Runtime contract position (current):** project-context binding is not part of the current `/api/chat` contract.
- **Fallback/default posture (current system):** generic local/single-user request handling remains active until runtime binding implementation exists.
Explicit note:
- Runtime project-context binding is not implemented yet.

### Item C — Scoped context resolution
Future intent:
- Runtime can later resolve scoped KB/memory/config based on workspace/project context.
- Context loading becomes isolation-aware.
Current reality:
- Current context assumptions remain local/global.
Future scoped resolution semantics:
- **Runtime scoped resolution (planned):** runtime may later resolve KB/memory/config using active workspace identity plus optional active project context.
- **Isolation-aware loading (planned):** context loading can later select only workspace/project-relevant context sources.
- **Fallback/default posture (current system):** local/global context resolution behavior remains active until scoped runtime implementation exists.
Explicit note:
- Runtime scoped context resolution is not implemented yet.

### Item D — Response/meta readiness
Future intent:
- Future runtime may expose workspace/project awareness through safe metadata evolution.
- Existing contract stability must be preserved during that transition.
Current reality:
- `/api/chat` contract is unchanged and must remain unchanged in this phase.
Future response/meta readiness semantics:
- **Additive metadata evolution (planned):** future runtime may later expose workspace/project awareness through additive, non-breaking metadata only.
- **Contract safety requirement:** existing `/api/chat` request/response compatibility must be preserved during any future metadata evolution.
- **Fallback/default posture (current system):** current response/meta behavior remains unchanged until future scoped implementation is explicitly delivered.
Explicit note:
- No response/meta runtime expansion is implemented in this phase.

## 40.2 Phase 40 Acceptance Criteria (DoD)

Phase 40 is DONE only if all pass:
- [x] Workspace runtime identity model is documented.
- [x] Project-context runtime binding model is documented.
- [x] Scoped context resolution model is documented.
- [x] Response/meta readiness is documented without implementation claims.
- [x] Docs clearly distinguish current runtime vs future runtime foundation.
- [x] No runtime implementation claims exist.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: `PHASE 40 DoD — PASS`

## 40.3 Minimal Step Plan (1-4)

### Step 1 — Workspace runtime identity model
Intended behavior:
- Define how future runtime may identify workspace context without changing current runtime, including:
  - current single-user/local runtime reality,
  - conceptual future runtime workspace identity model,
  - relationship between user, workspace, and future runtime context resolution,
  - current fallback/default local posture until runtime identity implementation exists.
Manual verify:
- Confirm docs clearly distinguish future runtime identity from current single-user/local runtime.
- Confirm workspace runtime identity purpose is explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime workspace identity implementation yet.

### Step 2 — Project-context runtime binding model
Intended behavior:
- Define how future runtime may bind requests to project context inside workspace, including:
  - current conceptual-only project context reality,
  - future runtime project-context binding under active workspace identity,
  - purpose for project-aware context selection and scoped KB/memory/config loading,
  - current fallback/default generic request handling until runtime binding implementation exists.
Manual verify:
- Confirm docs clearly distinguish conceptual project context from runtime-bound context.
- Confirm purpose of project-context runtime binding is explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime project-context binding implementation yet.

### Step 3 — Scoped context resolution + response/meta readiness
Intended behavior:
- Define how future runtime may resolve scoped KB/memory/config and how metadata evolution must stay contract-safe, explicitly separating:
  - current local/global context + unchanged response/meta reality,
  - future workspace/project-aware scoped context resolution,
  - future additive metadata-readiness model with strict compatibility constraints,
  - current fallback/default behavior until runtime implementation exists.
Manual verify:
- Confirm docs clearly state planning-only scope and no runtime implementation yet.
- Confirm docs clearly define future scoped context resolution semantics without claiming implementation.
- Confirm docs clearly define response/meta readiness as future additive evolution with contract safety.

### Step 4 — DoD closeout + docs sync
Manual verify:
- Confirm Phase 40 verification is logged in `REZ_AI_UI_PROGRESS.md`.

---

# 🚀 PHASE 41 — Collaboration Layer (Current Stack)

Goal: Define how future shared workspace collaboration will fit into REZ-AI without breaking the current local-first/runtime foundation.

Architecture guardrails for Phase 41:
- Reuse current flow only: UI -> backend (`/api/chat`) -> assistant (spawn) -> providers.
- No new endpoints/pages/services/storage layers in this phase.
- Keep `/api/chat` request/response shape unchanged and backward-compatible.
- Keep this phase planning-only and implementation-safe; do not imply runtime collaboration implementation before scoped delivery.

## 41.1 Scope (Collaboration Layer)

### Item A — Membership collaboration model
Future intent:
- Multiple users can belong to a workspace.
- Collaboration follows workspace role boundaries.
Purpose:
- Enable multiple users to collaborate inside one workspace.
- Support role-based boundaries (`owner` / `member` / `viewer`) for future collaboration safety.
- Enable future shared workspace operations under clear membership boundaries.
Current reality:
- Runtime remains single-user/local.
- No active multi-user membership runtime exists yet.
Future membership semantics:
- **Workspace membership set (planned):** workspace can contain multiple users.
- **Role-attached membership (planned):** each membership binds a user to a role (`owner`, `member`, `viewer`).
- **Membership boundary scope (planned):** membership boundaries define who can participate in workspace collaboration surfaces.
- **Fallback/default posture (current system):** local/single-user runtime posture remains active until membership runtime implementation exists.
Relationship model:
- **User -> Workspace membership -> Role boundary -> Collaboration scope** remains conceptual in this phase and defines future runtime mapping intent only.
Explicit note:
- Runtime membership collaboration is not implemented yet.

### Item B — Shared workspace context
Future intent:
- Workspace members can later share project context, KB context, and collaboration surfaces safely.
Purpose:
- Enable aligned collaboration on the same project context inside one workspace.
- Allow future shared KB/context usage within workspace boundaries.
- Reduce fragmented context across collaborators.
Current reality:
- Context remains local/global and single-user in runtime.
Future shared-context semantics:
- **Shared workspace context (planned):** shared context exists inside workspace boundary for eligible members.
- **Nested project context (planned):** project context remains nested inside workspace context.
- **Role-bound access (planned):** access to shared context later follows role boundaries (`owner` / `member` / `viewer`).
- **Fallback/default posture (current system):** local/global single-user context behavior remains active until shared-context runtime implementation exists.
Relationship model:
- **Workspace membership -> Shared workspace context -> Nested project context -> Role-bound access** remains conceptual in this phase and defines future runtime mapping intent only.
Explicit note:
- Runtime shared workspace context is not implemented yet.

### Item C — Collaboration-safe actions
Future intent:
- Future collaboration actions must respect owner/member/viewer role boundaries.
- Shared changes must later be reviewable and permission-aware.
Purpose:
- Keep future workspace collaboration actions permission-aware and safe.
- Ensure shared actions can later be reviewed before/after impact.
- Prepare for reversible shared actions under role boundaries.
Current reality:
- Current helper/actions remain single-user/local.
- No multi-user collaboration action enforcement exists yet.
Future collaboration-safe action semantics:
- **Role-bound action checks (planned):** shared actions later respect workspace role boundaries (`owner` / `member` / `viewer`).
- **Permission-aware shared actions (planned):** shared actions later require permission-aware handling before apply.
- **Reviewable/reversible posture (planned):** shared actions should later be reviewable and reversible.
- **Fallback/default posture (current system):** current helper/action behavior remains single-user/local until collaboration enforcement is implemented.
Explicit note:
- Runtime collaboration-safe action enforcement is not implemented yet.

### Item D — Auditability / activity readiness
Future intent:
- Future collaboration may require activity visibility, auditability, and shared change awareness.
- Docs must prepare for this without claiming runtime activity logs now.
Purpose:
- Prepare future collaboration for traceable shared actions and change awareness.
- Enable future visibility into collaboration activity without changing current runtime behavior.
- Keep activity readiness additive and contract-safe.
Current reality:
- No multi-user collaboration activity layer exists yet.
- No runtime audit/activity logging layer exists for workspace collaboration.
Future auditability/activity semantics:
- **Activity visibility (planned):** future collaboration may expose activity visibility inside workspace boundaries.
- **Traceable shared changes (planned):** shared changes may later require traceability for collaboration trust and reviewability.
- **Contract-safe additive posture (planned):** activity awareness must remain additive and not break existing `/api/chat` contract compatibility.
- **Fallback/default posture (current system):** runtime remains without collaboration audit/activity layer until scoped implementation exists.
Explicit note:
- Runtime collaboration audit/activity features are not implemented yet.

## 41.2 Phase 41 Acceptance Criteria (DoD)

Phase 41 is DONE only if all pass:
- [x] Membership collaboration model is documented.
- [x] Shared workspace context model is documented.
- [x] Collaboration-safe action model is documented.
- [x] Auditability/activity readiness is documented.
- [x] Docs clearly distinguish current runtime vs future collaboration model.
- [x] No runtime collaboration implementation claims exist.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: `PHASE 41 DoD — PASS`

## 41.3 Minimal Step Plan (1-4)

### Step 1 — Membership collaboration model
Intended behavior:
- Define future membership collaboration semantics inside workspace, including:
  - current single-user/local runtime reality,
  - conceptual future multi-user workspace membership model,
  - relationship between user, membership, role boundary, and collaboration scope,
  - current fallback/default local posture until membership runtime implementation exists.
Manual verify:
- Confirm docs clearly distinguish current single-user runtime from future membership model.
- Confirm purpose of membership collaboration is explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime membership collaboration implementation yet.

### Step 2 — Shared workspace context model
Intended behavior:
- Define how shared project/KB/context collaboration should later work conceptually, including:
  - current local/global single-user context reality,
  - future shared workspace context model,
  - nested project context semantics inside workspace boundary,
  - role-bound future access semantics,
  - current fallback/default local posture until runtime shared-context implementation exists.
Manual verify:
- Confirm docs clearly distinguish current local context from future shared workspace context.
- Confirm purpose of shared workspace context is explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime shared context implementation yet.

### Step 3 — Collaboration-safe actions + auditability readiness
Intended behavior:
- Define future permission-aware actions and activity/audit readiness conceptually, including:
  - current single-user/local helper-action reality,
  - no current multi-user action enforcement,
  - future role-bound, permission-aware, reviewable/reversible shared action intent,
  - future activity visibility and traceability readiness intent,
  - additive/contract-safe posture and current fallback/default behavior.
Manual verify:
- Confirm docs clearly define current single-user helper/actions vs future collaboration-safe action model.
- Confirm auditability/activity readiness is documented without implementation claims.
- Confirm docs clearly state planning-only scope and no runtime collaboration enforcement/activity layer yet.

### Step 4 — DoD closeout + docs sync
Intended behavior:
- Verify Phase 41 Step 1-3 documentation is complete, planning-only, and implementation-safe.
- Confirm no runtime collaboration enforcement/activity implementation claims exist.
- Confirm `/api/chat` contract wording remains unchanged and compatibility is preserved.
Manual verify:
- Confirm Phase 41 verification is logged in `REZ_AI_UI_PROGRESS.md`.
- Confirm `PHASE 41 DoD — PASS` is recorded in plan/progress/context docs.

---

# PHASE 42 — Hosted / Cloud Mode Foundation (Current Stack)

Objective:
- Prepare REZ-AI for future hosted/cloud operation and SaaS deployment posture while preserving current local-first behavior.
- Keep this phase planning-only and implementation-safe; do not imply runtime hosted/cloud implementation before scoped delivery.

## 42.1 Scope (Hosted / Cloud Mode Foundation)

### Item A — Hosted deployment posture
Future intent:
- Local-first mode remains supported as a core operating posture.
- Hosted/cloud mode becomes a future deployment option.
- Hosted mode must preserve API/contract stability across deployment modes.
Purpose:
- Enable future SaaS deployment posture without breaking current local-first foundation.
- Preserve local mode as a supported operating path.
- Preserve API/contract stability across local and hosted deployment modes.
Current reality:
- Runtime operates in current local-first posture.
- No hosted/cloud runtime mode exists yet.
Future hosted deployment semantics:
- **Deployment-mode parity (planned):** local and hosted are deployment modes, not different product contracts.
- **Additive/non-breaking hosted posture (planned):** hosted mode must remain additive and non-breaking.
- **Fallback/default posture (current system):** local-first runtime remains the active default until hosted runtime implementation exists.
Explicit note:
- Runtime hosted/cloud deployment mode is not implemented yet.

### Item B — Service boundary model
Future intent:
- Define future hosted/runtime service boundaries conceptually for:
  - UI,
  - backend/API,
  - assistant runtime,
  - providers,
  - persistence/context layer.
- Keep boundaries explicit so future hosted architecture remains modular and contract-safe.
Purpose:
- Keep future hosted architecture modular and maintain clear layer ownership.
- Preserve contract safety between client and API boundaries.
- Support staged migration from local deployment posture toward hosted operation.
Current reality:
- Current stack runs in existing local deployment assumptions.
- No hosted service boundary enforcement exists yet.
- No hosted runtime separation across layers is implemented yet.
Future service-boundary semantics:
- **UI boundary (planned):** UI remains the client interaction surface.
- **Backend/API boundary (planned):** backend/API remains the contract gateway.
- **Assistant runtime boundary (planned):** assistant runtime remains the execution layer.
- **Provider boundary (planned):** providers remain model connectors under one inference-runtime abstraction; local runtimes and future hosted/cloud/hybrid runtimes plug into this layer without contract drift.
- **Persistence/context boundary (planned):** persistence/context layer becomes future hosted state/context boundary.
- **Fallback/default posture (current system):** current local deployment assumptions remain active until hosted boundary implementation exists.
Explicit note:
- Service boundary model in this phase is planning groundwork only.

### Item C — Workspace persistence readiness
Future intent:
- Define future persistence/readiness model for:
  - workspace state,
  - project context,
  - scoped KB/memory/config.
- Prepare future hosted readiness for workspace-scoped persistence without changing current runtime behavior.
Purpose:
- Prepare future hosted operation for durable workspace/project context continuity.
- Keep persistence boundaries aligned with workspace/project scope and context isolation intent.
- Preserve current contract/runtime behavior while readiness is being defined.
Current reality:
- Runtime persistence model remains current local/global posture.
- No hosted/workspace persistence runtime changes are implemented yet.
 - No hosted persistence model exists yet.
Future workspace persistence readiness semantics:
- **Hosted persistence targets (planned):** hosted mode may later require persistence for workspace state, project context, and scoped KB/memory/config.
- **Boundary alignment (planned):** persistence readiness should follow workspace/project boundaries.
- **Fallback/default posture (current system):** current local/global persistence posture remains active until hosted persistence implementation exists.
Explicit note:
- Workspace persistence changes in this phase are conceptual only.

### Item D — Hosted safety / rollout readiness
Future intent:
- Define future hosted rollout expectations for:
  - staged rollout,
  - contract stability,
  - migration safety,
  - local mode continuity.
- Ensure future hosted progression remains additive and non-breaking.
Purpose:
- Define a safe hosted rollout posture that avoids contract regressions.
- Preserve local mode continuity while hosted capabilities are introduced incrementally.
- Prepare migration-safe hosted adoption from current local-first operation.
Current reality:
- No hosted rollout or migration runtime layer exists yet.
- No hosted persistence/rollout runtime implementation exists yet.
Future hosted rollout readiness semantics:
- **Staged rollout (planned):** hosted introduction should proceed in staged increments.
- **Contract stability preservation (planned):** hosted progression must preserve existing API/contract behavior.
- **Migration safety (planned):** hosted adoption should include migration-safe continuity from local assumptions.
- **Local mode continuity (planned):** local mode remains a supported path during hosted rollout.
- **Additive/non-breaking introduction (planned):** hosted capabilities must remain additive and non-breaking.
- **Fallback/default posture (current system):** current local-first posture remains active until hosted rollout implementation exists.
Explicit note:
- Hosted safety/rollout model is planning-only and not active in runtime.

## 42.2 Phase 42 Acceptance Criteria (DoD)

Phase 42 is DONE only if all pass:
- [x] Hosted deployment model is documented.
- [x] Service boundary model is documented.
- [x] Workspace persistence/readiness model is documented.
- [x] Hosted safety/rollout readiness model is documented.
- [x] Docs clearly distinguish current runtime vs future hosted/cloud model.
- [x] No runtime hosted/cloud implementation claims exist.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: `PHASE 42 DoD — PASS`

## 42.3 Minimal Step Plan (1-4)

### Step 1 — Hosted deployment model
Intended behavior:
- Define future hosted deployment posture conceptually, including:
  - current local-first runtime reality,
  - future hosted/cloud deployment option,
  - local-first continuity as a preserved operating mode,
  - deployment-mode parity (shared contract across local/hosted),
  - additive/non-breaking hosted posture with current local-first fallback.
Manual verify:
- Confirm docs clearly distinguish current local-first runtime from future hosted deployment option.
- Confirm purpose of hosted deployment model is explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime hosted/cloud deployment implementation yet.

### Step 2 — Service boundary model
Intended behavior:
- Define conceptual boundaries between UI, backend/API, assistant runtime, providers, and persistence/context layer for future hosted operation, including:
  - current local deployment assumptions and no hosted runtime separation,
  - future role of each service boundary layer,
  - modular and contract-safe boundary purpose,
  - fallback/default posture until runtime implementation exists.
Manual verify:
- Confirm docs clearly define current local deployment reality vs future hosted service boundary model.
- Confirm service boundary purpose is explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no hosted service-boundary implementation yet.

### Step 3 — Workspace persistence + rollout readiness
Intended behavior:
- Define conceptual readiness for workspace/project/scoped-context persistence and hosted rollout safety/migration continuity, including:
  - current local/global persistence posture and no hosted persistence model,
  - no hosted rollout/migration runtime layer in current reality,
  - future hosted persistence targets and workspace/project boundary alignment,
  - future staged rollout, contract stability, migration safety, local continuity, and additive/non-breaking hosted introduction,
  - fallback/default local-first posture until runtime implementation exists.
Manual verify:
- Confirm docs clearly define current persistence/rollout reality vs future hosted readiness model.
- Confirm workspace persistence purpose is explicit and non-ambiguous.
- Confirm hosted rollout safety is explicit and non-ambiguous.
- Confirm wording clearly states planning-only scope and no runtime hosted persistence/rollout implementation yet.

### Step 4 — DoD closeout + docs sync
Intended behavior:
- Verify Phase 42 Step 1-3 documentation is complete, planning-only, and implementation-safe.
- Confirm no runtime hosted/cloud, hosted persistence, hosted service-boundary, or hosted rollout implementation claims exist.
- Confirm `/api/chat` contract wording remains unchanged and compatibility is preserved.
Manual verify:
- Confirm Phase 42 verification is logged in `REZ_AI_UI_PROGRESS.md`.
- Confirm `PHASE 42 DoD — PASS` is recorded in plan/progress/context docs.

---

# PHASE 43 — Workspace Persistence Runtime Foundation (Current Stack)

Objective:
- Prepare REZ-AI for future runtime persistence across workspace/project/scoped context domains.
- Keep this phase planning-only and implementation-safe; do not imply runtime persistence implementation before scoped delivery.

## 43.1 Scope (Workspace Persistence Runtime Foundation)

### Item A — Workspace state persistence model
Future intent:
- Define future runtime persistence concept for:
  - workspace state,
  - workspace settings/ownership context.
Purpose:
- Preserve workspace-level continuity across runtime sessions.
- Support future hosted/workspace-aware runtime behavior with stable workspace state.
- Provide stable workspace ownership/settings context for future persistence-aware collaboration boundaries.
Current reality:
- Runtime remains in current local/global persistence posture.
- No runtime workspace-state persistence model exists yet.
Future workspace-state persistence semantics:
- **Independent workspace-state persistence (planned):** workspace state may later persist independently of local session state.
- **Settings/ownership runtime continuity (planned):** workspace settings/ownership context may later persist as part of runtime state.
- **Fallback/default posture (current system):** current local/global persistence posture remains active until workspace-state persistence implementation exists.
Explicit note:
- Workspace state persistence in this phase is conceptual only.

### Item B — Project context persistence model
Future intent:
- Define future runtime persistence concept for:
  - project context state,
  - project-scoped assistant context continuity.
Purpose:
- Preserve project-level assistant continuity across runtime sessions.
- Support future project-aware workspace runtime behavior.
- Reduce unrelated context carryover across projects.
Current reality:
- No runtime project-context persistence model exists yet.
- Runtime remains in current local/global persistence posture.
Future project-context persistence semantics:
- **Workspace-bound project persistence (planned):** project context may later persist inside workspace boundary.
- **Project-scoped assistant continuity (planned):** project-scoped assistant continuity may later persist across runtime sessions.
- **Fallback/default posture (current system):** current local/global persistence posture remains active until project-context persistence implementation exists.
Explicit note:
- Project context persistence in this phase is planning groundwork only.

### Item C — Scoped context persistence model
Future intent:
- Define future runtime persistence concept for:
  - scoped KB,
  - scoped memory,
  - scoped config.
Purpose:
- Prepare durable scoped context continuity for future workspace/project-aware runtime.
- Keep scoped context persistence aligned with workspace/project isolation boundaries.
- Preserve contract/runtime stability while scoped persistence readiness is defined.
Current reality:
- Scoped context persistence runtime is not implemented yet.
- Persistence posture remains current local/global model.
Future scoped-context persistence semantics:
- **Scoped KB persistence (planned):** scoped KB may later persist by workspace/project boundary.
- **Scoped memory persistence (planned):** scoped memory may later persist by workspace/project boundary.
- **Scoped config persistence (planned):** scoped config may later persist by workspace/project boundary.
- **Boundary alignment (planned):** persistence boundaries should align with workspace/project isolation model.
- **Fallback/default posture (current system):** current local/global persistence posture remains active until scoped persistence implementation exists.
Explicit note:
- Scoped KB/memory/config persistence is conceptual in this phase.

### Item D — Persistence safety / migration readiness
Future intent:
- Define future persistence safety expectations for:
  - staged persistence rollout,
  - migration safety,
  - backward compatibility,
  - contract stability.
Purpose:
- Prepare persistence introduction that remains migration-safe and non-disruptive.
- Preserve backward compatibility and local continuity during transition.
- Keep persistence rollout additive/non-breaking against existing contracts.
Current reality:
- No persistence migration/runtime safety layer exists yet.
- No migration/runtime persistence rollout implementation exists yet.
Future persistence migration-readiness semantics:
- **Staged persistence rollout (planned):** persistence introduction should proceed in staged increments.
- **Migration safety (planned):** persistence transition should preserve continuity across existing usage.
- **Backward compatibility (planned):** persistence rollout should retain backward-compatible behavior.
- **Local continuity (planned):** local mode continuity remains supported during transition.
- **Additive/non-breaking introduction (planned):** persistence capabilities should remain additive and non-breaking.
- **Fallback/default posture (current system):** current local/global persistence posture remains active until migration/rollout implementation exists.
Explicit note:
- Persistence safety/migration readiness is planning-only and not active in runtime.

## 43.2 Phase 43 Acceptance Criteria (DoD)

Phase 43 is DONE only if all pass:
- [x] Workspace persistence model is documented.
- [x] Project context persistence model is documented.
- [x] Scoped context persistence model is documented.
- [x] Persistence migration/safety model is documented.
- [x] No runtime persistence implementation claims exist.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: `PHASE 43 DoD — PASS`

## 43.3 Minimal Step Plan (1-4)

### Step 1 — Workspace state persistence model
Intended behavior:
- Define conceptual runtime persistence model for workspace state and workspace settings/ownership context, including:
  - current local/global persistence reality,
  - future runtime workspace-state persistence intent,
  - workspace settings/ownership continuity semantics,
  - fallback/default local/global persistence posture until implementation exists.
Manual verify:
- Confirm docs clearly distinguish current persistence reality from future workspace-state persistence model.
- Confirm purpose of workspace-state persistence is explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime workspace persistence implementation yet.

### Step 2 — Project context persistence model
Intended behavior:
- Define conceptual runtime persistence model for project context state and project-scoped assistant context continuity, including:
  - current no-runtime project-context persistence reality,
  - future runtime project-context persistence intent,
  - project-scoped assistant continuity semantics,
  - fallback/default local/global persistence posture until implementation exists.
Manual verify:
- Confirm docs clearly define current persistence reality vs future project-context persistence model.
- Confirm purpose of project-context persistence is explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime project-context persistence implementation yet.

### Step 3 — Scoped context persistence + migration readiness
Intended behavior:
- Define conceptual runtime persistence model for scoped KB/memory/config and persistence safety/migration readiness, including:
  - current no-runtime scoped persistence reality and local/global persistence posture,
  - future scoped KB/memory/config persistence intent by workspace/project boundary,
  - persistence boundary alignment with workspace/project isolation model,
  - future staged rollout, migration safety, backward compatibility, local continuity, and additive/non-breaking persistence introduction,
  - fallback/default local/global persistence posture until runtime implementation exists.
Manual verify:
- Confirm docs clearly define current persistence reality vs future scoped KB/memory/config persistence model.
- Confirm docs clearly define migration readiness without implementation claims.
- Confirm wording clearly states planning-only scope and no runtime scoped persistence/migration implementation yet.

### Step 4 — DoD closeout + docs sync
Intended behavior:
- Verify Phase 43 Step 1-3 documentation is complete, planning-only, and implementation-safe.
- Confirm no runtime workspace/project/scoped persistence or persistence migration/rollout implementation claims exist.
- Confirm `/api/chat` contract wording remains unchanged and compatibility is preserved.
Manual verify:
- Confirm Phase 43 verification is logged in `REZ_AI_UI_PROGRESS.md`.
- Confirm `PHASE 43 DoD — PASS` is recorded in plan/progress/context docs.

---

# PHASE 44 — Multi-User Runtime Foundation (Current Stack)

Objective:
- Prepare REZ-AI for future runtime multi-user behavior while preserving current architecture safety.
- Keep this phase planning-only and implementation-safe; do not imply runtime multi-user implementation before scoped delivery.

## 44.1 Scope (Multi-User Runtime Foundation)

### Item A — Runtime membership resolution
Future intent:
- Define future runtime concept for:
  - active user membership resolution,
  - workspace membership lookup,
  - role-aware runtime identity.
Purpose:
- Identify active membership inside workspace boundary during future multi-user runtime flows.
- Support role-aware runtime behavior (`owner` / `member` / `viewer`) after membership resolution.
- Provide a future basis for collaboration-safe access decisions.
Current reality:
- Runtime remains current single-user/local posture.
- No runtime membership resolution layer exists yet.
Future membership-resolution semantics:
- **Active membership resolution (planned):** runtime may later resolve active user membership.
- **Workspace role binding (planned):** membership lookup may later bind user to workspace role.
- **Contract boundary guardrail (planned):** role-aware identity is runtime-internal and not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current single-user/local runtime posture remains active until membership-resolution implementation exists.
Explicit note:
- Runtime membership resolution in this phase is conceptual only.

### Item B — Multi-user context access model
Future intent:
- Define future runtime concept for:
  - shared workspace context access,
  - project-context access inside workspace,
  - role-bound access boundaries.
Purpose:
- Allow future shared workspace/project context access under clear role boundaries.
- Preserve role-bound access boundaries for collaboration safety.
- Support collaboration without cross-context leakage.
Current reality:
- Multi-user context access runtime model is not implemented yet.
- Runtime remains current single-user/local posture for context access.
Future multi-user context access semantics:
- **Role-bound shared workspace access (planned):** workspace members may later access shared workspace context under role boundaries.
- **Nested project-context access (planned):** project-context access may later be nested inside workspace boundary.
- **Contract boundary guardrail (planned):** access semantics are runtime-internal and not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current single-user/local posture remains active until multi-user context access implementation exists.
Explicit note:
- Multi-user context access model in this phase is planning groundwork only.

### Item C — Runtime permission enforcement readiness
Future intent:
- Define future runtime concept for:
  - owner/member/viewer-aware access decisions,
  - safe permission checks,
  - collaboration-safe runtime behavior.
Purpose:
- Prepare safe, role-aware runtime enforcement for future multi-user collaboration.
- Ensure permission checks can support collaboration-safe behavior across shared contexts.
- Provide a stable basis for future policy-driven access decisions.
Current reality:
- No runtime permission enforcement layer for multi-user collaboration exists yet.
- Runtime remains current single-user/local posture for enforcement behavior.
Future permission-enforcement semantics:
- **Role-aware access decisions (planned):** runtime may later apply owner/member/viewer-aware access decisions.
- **Safe permission checks (planned):** runtime may later enforce safe permission checks before protected actions.
- **Collaboration-safe behavior (planned):** runtime behavior may later be permission-aware to prevent unsafe collaboration actions.
- **Contract boundary guardrail (planned):** permission decisions remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current single-user/local posture remains active until permission-enforcement implementation exists.
Explicit note:
- Permission enforcement readiness is planning-only and not active in runtime.

### Item D — Session / access continuity readiness
Future intent:
- Define future runtime concept for:
  - membership continuity across sessions,
  - access continuity,
  - safe transition from current single-user/local posture.
Purpose:
- Preserve reliable multi-user membership/access continuity across runtime sessions.
- Support safe transition from current single-user/local posture toward future multi-user runtime.
- Keep continuity posture additive and non-breaking during future rollout.
Current reality:
- No multi-user session/access continuity runtime layer exists yet.
- Runtime remains current single-user/local posture for session/access behavior.
Future session/access continuity semantics:
- **Membership continuity (planned):** membership context may later persist consistently across sessions.
- **Access continuity (planned):** access context may later remain stable across runtime sessions.
- **Safe transition posture (planned):** transition from single-user/local to multi-user runtime should remain safe and incremental.
- **Fallback/default posture (current system):** current single-user/local posture remains active until session/access continuity implementation exists.
Explicit note:
- Session/access continuity readiness is conceptual in this phase.

## 44.2 Phase 44 Acceptance Criteria (DoD)

Phase 44 is DONE only if all pass:
- [x] Runtime membership model is documented.
- [x] Multi-user context access model is documented.
- [x] Permission enforcement readiness is documented.
- [x] Session/access readiness is documented.
- [x] No runtime multi-user implementation claims exist.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: `PHASE 44 DoD — PASS`

## 44.3 Minimal Step Plan (1-4)

### Step 1 — Runtime membership resolution model
Intended behavior:
- Define conceptual runtime model for active membership resolution, workspace membership lookup, and role-aware runtime identity, including:
  - current single-user/local runtime reality,
  - future active membership resolution intent,
  - workspace membership lookup + role binding semantics,
  - runtime-internal role-aware identity contract guardrail,
  - fallback/default single-user/local posture until implementation exists.
Manual verify:
- Confirm docs clearly distinguish current single-user posture from future runtime membership resolution model.
- Confirm purpose of membership resolution is explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime membership resolution implementation yet.

### Step 2 — Multi-user context access model
Intended behavior:
- Define conceptual runtime model for shared workspace context access, project-context access, and role-bound access boundaries, including:
  - current no-runtime multi-user context access reality,
  - future shared workspace/project context access intent,
  - role-bound access boundary semantics,
  - runtime-internal access semantics contract guardrail,
  - fallback/default single-user/local posture until implementation exists.
Manual verify:
- Confirm docs clearly distinguish current context access posture from future multi-user context access model.
- Confirm purpose of multi-user context access is explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime multi-user context access implementation yet.

### Step 3 — Permission enforcement + session/access readiness
Intended behavior:
- Define conceptual runtime model for permission enforcement readiness and session/access continuity readiness, including:
  - current no-runtime permission-enforcement/session-continuity reality,
  - future owner/member/viewer-aware access decisions and safe permission checks,
  - future membership/access continuity semantics across sessions,
  - runtime-internal contract guardrails and safe-transition posture,
  - fallback/default single-user/local posture until implementation exists.
Manual verify:
- Confirm docs clearly define current runtime reality vs future permission enforcement/session continuity model.
- Confirm permission/session readiness purpose is explicit and non-ambiguous.
- Confirm wording clearly states planning-only scope and no runtime permission enforcement or session/access continuity implementation yet.

### Step 4 — DoD closeout + docs sync
Intended behavior:
- Verify Phase 44 Step 1-3 documentation is complete, planning-only, and implementation-safe.
- Confirm no runtime membership resolution, multi-user context access, permission enforcement, or session/access continuity implementation claims exist.
- Confirm `/api/chat` contract wording remains unchanged and compatibility is preserved.
Manual verify:
- Confirm Phase 44 verification is logged in `REZ_AI_UI_PROGRESS.md`.
- Confirm `PHASE 44 DoD — PASS` is recorded in plan/progress/context docs.

---

# PHASE 45 — Workspace Context Isolation Runtime Foundation (Current Stack)

Objective:
- Prepare REZ-AI for future runtime-enforced workspace/project context isolation across KB, memory, and config domains.
- Keep this phase planning-only and implementation-safe; do not imply runtime isolation implementation before scoped delivery.

## 45.1 Scope (Workspace Context Isolation Runtime Foundation)

### Item A — Runtime KB isolation enforcement model
Future intent:
- Define future runtime concept for:
  - workspace-scoped KB resolution,
  - optional project-scoped KB resolution,
  - isolation-safe KB access boundaries.
Purpose:
- Prevent cross-workspace KB leakage during future multi-user/workspace-aware runtime flows.
- Prevent unrelated project KB mixing inside the same workspace.
- Support future collaboration-safe and workspace-aware context loading.
Current reality:
- Runtime KB isolation enforcement is not implemented yet.
- Runtime remains in current non-isolated KB posture.
Future KB-isolation enforcement semantics:
- **Workspace-scoped KB resolution (planned):** runtime may later resolve KB by active workspace boundary.
- **Project-scoped KB narrowing (planned):** runtime may later narrow KB further by active project context.
- **Contract boundary guardrail (planned):** KB access boundaries are runtime-internal and not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-isolated KB posture remains active until KB-isolation enforcement implementation exists.
Explicit note:
- KB isolation enforcement model in this phase is conceptual only.

### Item B — Runtime memory isolation enforcement model
Future intent:
- Define future runtime concept for:
  - workspace-scoped memory resolution,
  - optional project-scoped memory resolution,
  - isolation-safe memory continuity boundaries.
Purpose:
- Prevent cross-workspace conversation/task memory leakage in future multi-user/workspace-aware runtime.
- Prevent unrelated project memory carryover inside the same workspace.
- Support future collaboration-safe and workspace-aware memory continuity.
Current reality:
- Runtime memory isolation enforcement is not implemented yet.
- Runtime remains in current non-isolated memory posture.
Future memory-isolation enforcement semantics:
- **Workspace-scoped memory resolution (planned):** runtime may later resolve memory by active workspace boundary.
- **Project-scoped memory narrowing (planned):** runtime may later narrow memory further by active project context.
- **Contract boundary guardrail (planned):** memory continuity boundaries are runtime-internal and not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-isolated memory posture remains active until memory-isolation enforcement implementation exists.
Explicit note:
- Memory isolation enforcement model in this phase is planning groundwork only.

### Item C — Runtime config isolation enforcement model
Future intent:
- Define future runtime concept for:
  - workspace-scoped config resolution,
  - optional project-scoped config resolution,
  - isolation-safe config ownership boundaries.
Purpose:
- Prevent cross-workspace config leakage in future workspace-aware runtime flows.
- Prevent unrelated project config carryover/mixing inside the same workspace.
- Support collaboration-safe config ownership boundaries for future multi-user behavior.
Current reality:
- Runtime config isolation enforcement is not implemented yet.
- Runtime remains in current non-isolated config posture.
Future config-isolation enforcement semantics:
- **Workspace-scoped config resolution (planned):** runtime may later resolve config by active workspace boundary.
- **Project-scoped config narrowing (planned):** runtime may later narrow config by active project context.
- **Contract boundary guardrail (planned):** config ownership boundaries are runtime-internal and not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-isolated config posture remains active until config-isolation enforcement implementation exists.
Explicit note:
- Config isolation enforcement model in this phase is conceptual only.

### Item D — Isolation enforcement safety / fallback model
Future intent:
- Define future runtime concept for:
  - safe isolation enforcement,
  - fallback/default behavior,
  - migration-safe isolation rollout,
  - contract stability during isolation adoption.
Purpose:
- Prepare safe runtime isolation adoption without disrupting current behavior.
- Keep fallback/default behavior explicit while isolation is introduced.
- Preserve migration safety and contract stability during isolation rollout.
Current reality:
- No runtime isolation enforcement safety/fallback layer exists yet.
- Runtime remains in current non-isolated/local-global posture.
Future isolation safety/fallback semantics:
- **Safe isolation enforcement (planned):** isolation should be enforced safely across runtime boundaries.
- **Fallback/default behavior (planned):** runtime should preserve deterministic fallback behavior when isolation context is unavailable.
- **Migration-safe rollout (planned):** isolation rollout should proceed in migration-safe stages.
- **Contract stability (planned):** isolation adoption should preserve existing API/contract behavior.
- **Additive/non-breaking introduction (planned):** isolation capabilities should remain additive and non-breaking.
- **Fallback/default posture (current system):** current non-isolated/local-global posture remains active until isolation safety/fallback implementation exists.
Explicit note:
- Isolation safety/fallback model is planning-only and not active in runtime.

## 45.2 Phase 45 Acceptance Criteria (DoD)

Phase 45 is DONE only if all pass:
- [x] Runtime KB isolation model is documented.
- [x] Runtime memory isolation model is documented.
- [x] Runtime config isolation model is documented.
- [x] Isolation safety/fallback model is documented.
- [x] No runtime isolation implementation claims exist.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: `PHASE 45 DoD — PASS`

## 45.3 Minimal Step Plan (1-4)

### Step 1 — Runtime KB isolation enforcement model
Intended behavior:
- Define conceptual runtime model for workspace/project-scoped KB resolution and isolation-safe KB access boundaries, including:
  - current no-runtime KB isolation enforcement reality,
  - future workspace-scoped KB resolution intent,
  - optional project-scoped KB narrowing intent,
  - runtime-internal KB boundary contract guardrail,
  - fallback/default non-isolated posture until implementation exists.
Manual verify:
- Confirm docs clearly distinguish current KB posture from future runtime KB isolation enforcement model.
- Confirm purpose of KB isolation enforcement is explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime KB isolation enforcement implementation yet.

### Step 2 — Runtime memory isolation enforcement model
Intended behavior:
- Define conceptual runtime model for workspace/project-scoped memory resolution and isolation-safe memory continuity boundaries, including:
  - current no-runtime memory isolation enforcement reality,
  - future workspace-scoped memory resolution intent,
  - optional project-scoped memory narrowing intent,
  - runtime-internal memory boundary contract guardrail,
  - fallback/default non-isolated memory posture until implementation exists.
Manual verify:
- Confirm docs clearly distinguish current memory posture from future runtime memory isolation enforcement model.
- Confirm purpose of memory isolation enforcement is explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime memory isolation enforcement implementation yet.

### Step 3 — Runtime config isolation + enforcement safety/fallback
Intended behavior:
- Define conceptual runtime model for workspace/project-scoped config resolution plus isolation safety/fallback and migration-safe rollout, including:
  - current no-runtime config isolation/safety-fallback reality,
  - future workspace/project-scoped config resolution intent,
  - runtime-internal config ownership boundary contract guardrail,
  - future safe enforcement, fallback behavior, migration-safe rollout, contract stability, and additive/non-breaking adoption,
  - fallback/default non-isolated/local-global posture until implementation exists.
Manual verify:
- Confirm docs clearly define current runtime reality vs future config isolation enforcement model.
- Confirm docs clearly define isolation safety/fallback behavior without implementation claims.
- Confirm wording clearly states planning-only scope and no runtime config isolation enforcement/safety fallback implementation yet.

### Step 4 — DoD closeout + docs sync
Intended behavior:
- Verify Phase 45 Step 1-3 documentation is complete, planning-only, and implementation-safe.
- Confirm no runtime KB/memory/config isolation enforcement or isolation safety/fallback implementation claims exist.
- Confirm `/api/chat` contract wording remains unchanged and compatibility is preserved.
Manual verify:
- Confirm Phase 45 verification is logged in `REZ_AI_UI_PROGRESS.md`.
- Confirm `PHASE 45 DoD — PASS` is recorded in plan/progress/context docs.

---

# PHASE 46 — Agent / Task Runtime Foundation (Current Stack)

Objective:
- Prepare REZ-AI for future task/agent-style runtime behavior using implementation-safe planning language.
- Keep this phase docs-only and planning-only; do not imply active runtime task/agent execution before scoped delivery.

## 46.1 Scope (Agent / Task Runtime Foundation)

### Item A — Task lifecycle model
Future intent:
- Define future runtime concept for:
  - task creation,
  - task state progression,
  - task completion/failure states.
Purpose:
- Establish clear future lifecycle semantics for bounded task execution in runtime.
- Support future task visibility and controlled execution flow through explicit state transitions.
- Provide stable state semantics for future agent/task behavior across runtime boundaries.
Current reality:
- Runtime task lifecycle model is not implemented yet.
- Runtime remains in current request/response chat posture without task-state runtime orchestration.
Future task-lifecycle semantics:
- **Task creation (planned):** runtime may later create bounded tasks from assistant/user intent.
- **State progression (planned):** tasks may later transition through deterministic lifecycle stages.
- **Completion/failure outcomes (planned):** tasks may later end in explicit success/failure terminal states.
- **Contract boundary guardrail (planned):** lifecycle semantics remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-task chat execution remains active until task-lifecycle implementation exists.
Explicit note:
- Task lifecycle model in this phase is planning groundwork only.

### Item B — Agent execution posture
Future intent:
- Define future runtime concept for:
  - assistant acting on bounded tasks,
  - scoped execution behavior,
  - non-destructive/default-safe operation.
Purpose:
- Prepare future agent/task runtime behavior that stays bounded, scoped, and execution-safe.
- Preserve safe default behavior so future agent/task execution remains non-destructive by default.
- Prepare future agent/task runtime without destabilizing current chat-response behavior.
Current reality:
- Runtime agent execution posture for bounded tasks is not implemented yet.
- Assistant remains in current chat-response posture without active task-agent runtime execution.
Future agent-execution semantics:
- **Bounded task execution (planned):** assistant may later execute within explicit task boundaries.
- **Scoped execution behavior (planned):** agent execution may later be constrained by task/workspace/project scope.
- **Non-destructive/default-safe posture (planned):** future execution should default to safe, non-destructive behavior.
- **Contract boundary guardrail (planned):** execution posture semantics remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-agent chat execution remains active until implementation exists.
Explicit note:
- Agent execution posture in this phase is conceptual only.

### Item C — Tool/action invocation model
Future intent:
- Define future runtime concept for:
  - tool/action selection,
  - safe invocation boundaries,
  - review-first execution posture.
Purpose:
- Prepare future tool/action invocation semantics with safe boundaries and review-first behavior.
- Keep future tool/action invocation bounded and scope-aware under explicit runtime constraints.
- Reduce risk during future agent/task rollout by keeping invocation posture explicit, conservative, and review-first.
Current reality:
- Runtime task-agent tool/action orchestration layer is not implemented yet.
- Runtime remains in current non-agent/non-task chat execution posture.
Future tool/action invocation semantics:
- **Tool/action selection (planned):** runtime may later select tools/actions based on bounded task intent.
- **Safe invocation boundaries (planned):** invocations may later follow explicit safety and scope boundaries.
- **Review-first posture (planned):** runtime may later prefer review-first action posture before high-impact execution.
- **Contract boundary guardrail (planned):** tool/action invocation semantics remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-agent/non-task invocation posture remains active until implementation exists.
Explicit note:
- Tool/action invocation model in this phase is planning-only and not active in runtime.

### Item D — Safety / approval / fallback model
Future intent:
- Define future runtime concept for:
  - approval gates,
  - fallback/default behavior,
  - failure-safe handling,
  - contract stability during agent/task evolution.
Purpose:
- Prepare safe future agent/task rollout with explicit approval, deterministic fallback, and failure-safe handling semantics.
- Preserve contract stability and implementation safety while agent/task capabilities evolve.
Current reality:
- Runtime approval-gate/fallback model for task-agent execution is not implemented yet.
- Runtime remains in current non-agent/non-task chat execution posture.
Future safety/approval/fallback semantics:
- **Approval gates (planned):** runtime may later introduce explicit approval points for higher-impact actions.
- **Fallback/default behavior (planned):** runtime should preserve deterministic fallback behavior when execution context is incomplete/unsafe.
- **Failure-safe handling (planned):** runtime should later preserve safe failure behavior without destructive side effects.
- **Contract stability (planned):** agent/task evolution should preserve existing API/contract behavior.
- **Additive/non-breaking introduction (planned):** agent/task capabilities should remain additive and non-breaking.
- **Fallback/default posture (current system):** current non-agent/non-task posture remains active until safety/approval/fallback implementation exists.
Explicit note:
- Safety/approval/fallback model is planning-only and not active in runtime.

## 46.2 Phase 46 Acceptance Criteria (DoD)

Phase 46 is DONE only if all pass:
- [x] Task lifecycle model is documented.
- [x] Agent execution posture is documented.
- [x] Tool/action invocation model is documented.
- [x] Safety/approval/fallback model is documented.
- [x] No runtime agent/task implementation claims exist.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: `PHASE 46 DoD — PASS`

## 46.3 Minimal Step Plan (1-4)

### Step 1 — Task lifecycle model
Intended behavior:
- Define conceptual runtime model for task creation, state progression, and completion/failure terminal states, including:
  - current no-runtime task lifecycle orchestration reality,
  - future bounded task creation and deterministic state progression intent,
  - explicit completion/failure terminal-state intent,
  - purpose alignment for bounded-task semantics, task visibility, and controlled execution flow,
  - runtime-internal lifecycle boundary contract guardrail,
  - fallback/default non-task posture until implementation exists.
Manual verify:
- Confirm docs clearly distinguish current chat posture from future task lifecycle model.
- Confirm purpose and lifecycle state semantics are explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime task lifecycle implementation yet.

### Step 2 — Agent execution posture
Intended behavior:
- Define conceptual runtime model for bounded agent execution, scoped execution behavior, and non-destructive/default-safe operation, including:
  - current no-runtime bounded agent execution reality,
  - future bounded/scoped agent execution intent,
  - default-safe/non-destructive execution posture intent,
  - purpose alignment for bounded/scope-aware execution and safe defaults without chat-flow destabilization,
  - runtime-internal execution boundary contract guardrail,
  - fallback/default non-agent posture until implementation exists.
Manual verify:
- Confirm docs clearly distinguish current runtime posture from future agent execution posture.
- Confirm purpose and bounded/scoped/default-safe semantics are explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime agent execution implementation yet.

### Step 3 — Tool/action invocation + safety/approval/fallback
Intended behavior:
- Define conceptual runtime model for task-agent tool/action invocation plus safety/approval/fallback semantics, including:
  - current no-runtime task-agent invocation/safety layer reality,
  - future tool/action selection and safe invocation boundary intent,
  - future review-first posture, approval gates, deterministic fallback, and failure-safe handling intent,
  - purpose alignment for bounded/scope-aware invocation posture and explicit safety controls,
  - contract stability and additive/non-breaking evolution guardrail,
  - fallback/default non-agent/non-task posture until implementation exists.
Manual verify:
- Confirm docs clearly define current runtime reality vs future tool/action invocation and safety/approval/fallback models.
- Confirm tool/action invocation purpose is explicit and non-ambiguous.
- Confirm approval/fallback/failure-safe wording is explicit without implementation claims.
- Confirm docs clearly state planning-only scope and no runtime task-agent invocation or approval/fallback implementation yet.

### Step 4 — DoD closeout + docs sync
Intended behavior:
- Verify Phase 46 Step 1-3 documentation is complete, planning-only, and implementation-safe.
- Confirm no runtime task lifecycle orchestration, agent execution, tool/action invocation, or approval/fallback implementation claims exist.
- Confirm `/api/chat` contract wording remains unchanged and compatibility is preserved.
Manual verify:
- Confirm Phase 46 verification is logged in `REZ_AI_UI_PROGRESS.md`.
- Confirm `PHASE 46 DoD — PASS` is recorded in plan/progress/context docs.

---

# PHASE 47 — Tool / Execution Runtime Foundation (Current Stack)

Objective:
- Prepare REZ-AI for future bounded tool/action execution runtime behavior with implementation-safe planning semantics.
- Keep this phase docs-only and planning-only; do not imply active runtime tool/action execution before scoped delivery.

## 47.1 Scope (Tool / Execution Runtime Foundation)

### Item A — Execution unit model
Future intent:
- Define future runtime concept for:
  - execution unit creation,
  - execution scope,
  - execution result/failure states.
Purpose:
- Establish clear future execution-unit semantics for bounded runtime execution flow.
- Support future execution visibility and control through explicit scope and state semantics.
- Provide stable execution-state semantics for future runtime behavior.
Current reality:
- Runtime execution-unit orchestration model is not implemented yet.
- Runtime remains in current non-execution chat posture without execution-unit lifecycle handling.
Future execution-unit semantics:
- **Execution unit creation (planned):** runtime may later create bounded execution units from task/action intent.
- **Execution scope (planned):** execution units may later run within explicit task/workspace/project scope boundaries.
- **Result/failure states (planned):** execution units may later end in explicit success/failure outcome states.
- **Contract boundary guardrail (planned):** execution-unit semantics remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-execution chat posture remains active until execution-unit implementation exists.
Explicit note:
- Execution unit model in this phase is planning groundwork only.

### Item B — Tool capability boundary model
Future intent:
- Define future runtime concept for:
  - allowed tool categories,
  - scope-aware tool boundaries,
  - non-destructive/default-safe tool posture.
Purpose:
- Keep future tool execution bounded and conservative through explicit capability boundaries.
- Support scope-aware tool execution limits across task/workspace/project context.
- Preserve non-destructive/default-safe behavior as the default tool posture.
Current reality:
- Runtime tool capability boundary model is not implemented yet.
- Runtime remains in current non-execution posture with no active tool-boundary enforcement layer.
Future tool-capability boundary semantics:
- **Allowed tool categories (planned):** runtime may later constrain execution to explicit allowed tool categories.
- **Scope-aware boundaries (planned):** tool use may later be constrained by task/workspace/project execution scope.
- **Default-safe posture (planned):** tool execution should default to non-destructive behavior.
- **Contract boundary guardrail (planned):** tool-boundary semantics remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-execution/non-tool posture remains active until implementation exists.
Explicit note:
- Tool capability boundary model in this phase is conceptual only.

### Item C — Review / approval execution flow
Future intent:
- Define future runtime concept for:
  - review-first execution flow,
  - approval checkpoints,
  - high-impact action gating.
Purpose:
- Prepare future execution flow that remains review-first, approval-aware, and implementation-safe.
- Preserve safe execution behavior by gating higher-impact actions behind explicit approval checkpoints.
Current reality:
- Runtime review/approval execution flow model is not implemented yet.
- Runtime remains in current non-execution chat posture with no approval-checkpoint/gating layer.
Future review/approval flow semantics:
- **Review-first flow (planned):** runtime may later prioritize review-first flow before execution.
- **Approval checkpoints (planned):** runtime may later require approval checkpoints before selected execution steps.
- **High-impact gating (planned):** higher-impact actions may later be gated behind explicit approval controls.
- **Contract boundary guardrail (planned):** review/approval flow semantics remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-execution posture remains active until review/approval implementation exists.
Explicit note:
- Review/approval execution flow model is planning-only and not active in runtime.

### Item D — Execution safety / result handling model
Future intent:
- Define future runtime concept for:
  - safe result handling,
  - deterministic fallback behavior,
  - failure-safe execution outcomes,
  - contract stability during execution evolution.
Purpose:
- Prepare safe future execution rollout with explicit safe-result handling, deterministic fallback, and failure-safe semantics.
- Preserve contract stability and implementation safety while execution capabilities evolve.
Current reality:
- Runtime execution safety/result handling model is not implemented yet.
- Runtime remains in current non-execution chat posture without active execution fallback/failure-safe handling layer.
Future safety/result handling semantics:
- **Safe result handling (planned):** runtime should later handle execution results safely and predictably.
- **Deterministic fallback (planned):** runtime should preserve deterministic fallback behavior when execution context is incomplete/unsafe.
- **Failure-safe outcomes (planned):** runtime should later preserve failure-safe outcomes without destructive side effects.
- **Contract stability (planned):** execution evolution should preserve existing API/contract behavior.
- **Additive/non-breaking introduction (planned):** execution capabilities should remain additive and non-breaking.
- **Fallback/default posture (current system):** current non-execution posture remains active until execution safety/result handling implementation exists.
Explicit note:
- Execution safety/result handling model is planning-only and not active in runtime.

## 47.2 Phase 47 Acceptance Criteria (DoD)

Phase 47 is DONE only if all pass:
- [x] Execution unit model is documented.
- [x] Tool capability boundary model is documented.
- [x] Review/approval execution flow is documented.
- [x] Execution safety/result handling model is documented.
- [x] No runtime execution implementation claims exist.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: `PHASE 47 DoD — PASS`

## 47.3 Minimal Step Plan (1-4)

### Step 1 — Execution unit model
Intended behavior:
- Define conceptual runtime model for execution unit creation, execution scope, and execution result/failure states, including:
  - current no-runtime execution-unit orchestration reality,
  - future bounded execution-unit creation intent,
  - future scope-aware execution-unit boundary intent,
  - explicit result/failure outcome-state intent,
  - purpose alignment for bounded execution semantics, execution visibility/control, and stable execution-state behavior,
  - runtime-internal execution-unit contract guardrail,
  - fallback/default non-execution posture until implementation exists.
Manual verify:
- Confirm docs clearly distinguish current chat posture from future execution-unit model.
- Confirm purpose and execution-unit scope/outcome semantics are explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime execution-unit implementation yet.

### Step 2 — Tool capability boundary model
Intended behavior:
- Define conceptual runtime model for allowed tool categories, scope-aware tool boundaries, and default-safe tool posture, including:
  - current no-runtime tool-boundary enforcement reality,
  - future allowed tool-category boundary intent,
  - future scope-aware tool constraint intent,
  - default-safe/non-destructive tool posture intent,
  - purpose alignment for bounded/conservative tool execution and scope-aware limits,
  - runtime-internal tool-boundary contract guardrail,
  - fallback/default non-execution posture until implementation exists.
Manual verify:
- Confirm docs clearly distinguish current runtime posture from future tool capability boundary model.
- Confirm purpose and allowed-category/scope-aware/default-safe semantics are explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime tool-boundary implementation yet.

### Step 3 — Review/approval flow + execution safety/result handling
Intended behavior:
- Define conceptual runtime model for review/approval execution flow plus execution safety/result handling semantics, including:
  - current no-runtime review/approval/execution-safety layer reality,
  - future review-first flow, approval checkpoints, and high-impact gating intent,
  - future safe result handling, deterministic fallback, and failure-safe outcome intent,
  - purpose alignment for explicit review/approval controls and safety-first result behavior,
  - contract stability and additive/non-breaking evolution guardrail,
  - fallback/default non-execution posture until implementation exists.
Manual verify:
- Confirm docs clearly define current runtime reality vs future review/approval and execution safety/result handling models.
- Confirm review/approval purpose is explicit and non-ambiguous.
- Confirm approval/gating/fallback/failure-safe wording is explicit without implementation claims.
- Confirm docs clearly state planning-only scope and no runtime review/approval or execution safety/result handling implementation yet.

### Step 4 — DoD closeout + docs sync
Manual verify:
- Confirm Phase 47 verification is logged in `REZ_AI_UI_PROGRESS.md`.

---

# PHASE 48 — Activity / Audit Runtime Foundation (Current Stack)

Objective:
- Prepare REZ-AI for future runtime activity visibility, execution traceability, and audit-safe behavior with implementation-safe planning semantics.
- Keep this phase docs-only and planning-only; do not imply active runtime activity/audit implementation before scoped delivery.

## 48.1 Scope (Activity / Audit Runtime Foundation)

### Item A — Activity event model
Future intent:
- Define future runtime concept for:
  - activity event creation,
  - event categories,
  - execution/task/action event visibility.
Purpose:
- Establish clear future activity-event semantics for bounded runtime visibility.
- Support future execution/task/action trace visibility through explicit event modeling.
- Provide stable event semantics for future activity-aware runtime behavior.
Current reality:
- Runtime activity-event model is not implemented yet.
- Runtime remains in current non-activity posture with no activity-event creation/visibility layer.
Future activity-event semantics:
- **Activity event creation (planned):** runtime may later create bounded activity events from execution/task/action intent.
- **Event categories (planned):** activity events may later be grouped into explicit runtime categories.
- **Execution/task/action visibility (planned):** activity events may later expose bounded runtime visibility for execution/task/action activity.
- **Contract boundary guardrail (planned):** activity-event semantics remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-activity chat posture remains active until activity-event implementation exists.
Explicit note:
- Activity event model in this phase is planning groundwork only.

### Item B — Audit trail model
Future intent:
- Define future runtime concept for:
  - traceable changes,
  - execution history,
  - review/debug audit continuity.
Purpose:
- Prepare future audit trail semantics for traceable runtime change history.
- Support future execution-history continuity through explicit audit semantics.
- Improve future review/debug confidence through explicit audit-trail semantics.
Current reality:
- Runtime audit trail model is not implemented yet.
- Runtime remains in current non-audit posture with no traceable audit-history continuity layer.
Future audit-trail semantics:
- **Traceable changes (planned):** runtime may later expose traceable change events across execution flows.
- **Execution history (planned):** runtime may later preserve bounded execution history semantics.
- **Review/debug continuity (planned):** runtime may later support review/debug continuity through audit trail semantics.
- **Contract boundary guardrail (planned):** audit-trail semantics remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-audit posture remains active until audit-trail implementation exists.
Explicit note:
- Audit trail model in this phase is conceptual only.

### Item C — Visibility / review surface model
Future intent:
- Define future runtime concept for:
  - future operator visibility,
  - reviewable execution history,
  - safe read/inspection posture.
Purpose:
- Prepare future visibility/review surfaces that remain reviewable, read-safe, and inspection-oriented.
- Preserve safe review posture while enabling bounded operator visibility into activity/audit outcomes.
Current reality:
- Runtime visibility/review surface model is not implemented yet.
- Runtime remains in current non-activity/non-audit posture with no visibility/review surface for execution history.
Future visibility/review semantics:
- **Operator visibility (planned):** runtime may later provide bounded operator visibility into activity/audit outcomes.
- **Reviewable history (planned):** runtime may later provide reviewable execution history surfaces.
- **Safe read/inspection posture (planned):** visibility surfaces should remain read/inspection-first and non-destructive.
- **Contract boundary guardrail (planned):** visibility/review semantics remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-visibility posture remains active until implementation exists.
Explicit note:
- Visibility/review surface model is planning-only and not active in runtime.

### Item D — Audit safety / retention / fallback model
Future intent:
- Define future runtime concept for:
  - audit-safe logging posture,
  - retention/readback readiness,
  - deterministic fallback/default behavior,
  - contract stability during audit/runtime evolution.
Purpose:
- Prepare safe future audit/runtime rollout with explicit audit safety, retention-readiness, and fallback semantics.
- Preserve contract stability and implementation safety while activity/audit capabilities evolve.
Current reality:
- Runtime audit safety/retention/fallback model is not implemented yet.
- Runtime remains in current non-activity/non-audit posture without active safety/retention/fallback layer for audit activity.
Future audit safety/retention/fallback semantics:
- **Audit-safe logging posture (planned):** runtime should later preserve safe, bounded logging semantics for audit activity.
- **Retention/readback readiness (planned):** runtime may later support retention/readback readiness for audit history.
- **Deterministic fallback/default (planned):** runtime should preserve deterministic fallback behavior when audit context is incomplete/unavailable.
- **Contract stability (planned):** activity/audit evolution should preserve existing API/contract behavior.
- **Additive/non-breaking introduction (planned):** activity/audit capabilities should remain additive and non-breaking.
- **Fallback/default posture (current system):** current non-audit posture remains active until audit safety/retention/fallback implementation exists.
Explicit note:
- Audit safety/retention/fallback model is planning-only and not active in runtime.

## 48.2 Phase 48 Acceptance Criteria (DoD)

Phase 48 is DONE only if all pass:
- [x] Activity event model is documented.
- [x] Audit trail model is documented.
- [x] Visibility/review model is documented.
- [x] Audit safety/retention/fallback model is documented.
- [x] No runtime audit/activity implementation claims exist.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: `PHASE 48 DoD — PASS`

## 48.3 Minimal Step Plan (1-4)

### Step 1 — Activity event model
Intended behavior:
- Define conceptual runtime model for activity event creation, event categories, and execution/task/action event visibility, including:
  - current no-runtime activity-event layer reality,
  - future bounded event creation intent,
  - future event-category semantics intent,
  - future execution/task/action visibility intent,
  - purpose alignment for bounded visibility semantics and stable activity-event behavior,
  - runtime-internal activity-event contract guardrail,
  - fallback/default non-activity posture until implementation exists.
Manual verify:
- Confirm docs clearly distinguish current runtime posture from future activity-event model.
- Confirm purpose and activity-event visibility/category semantics are explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime activity-event implementation yet.

### Step 2 — Audit trail model
Intended behavior:
- Define conceptual runtime model for traceable changes, execution history, and review/debug audit continuity, including:
  - current no-runtime audit-trail layer reality,
  - future traceable-change and execution-history intent,
  - future review/debug audit-continuity intent,
  - purpose alignment for traceability, execution-history continuity, and review/debug confidence,
  - runtime-internal audit-trail contract guardrail,
  - fallback/default non-audit posture until implementation exists.
Manual verify:
- Confirm docs clearly distinguish current runtime posture from future audit-trail model.
- Confirm purpose and traceability/history/continuity semantics are explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime audit-trail implementation yet.

### Step 3 — Visibility/review surface + audit safety/retention/fallback
Intended behavior:
- Define conceptual runtime model for visibility/review surfaces plus audit safety/retention/fallback semantics, including:
  - current no-runtime visibility/review and audit-safety layer reality,
  - future operator visibility, reviewable history, and safe read/inspection intent,
  - future audit-safe posture, retention/readback readiness, deterministic fallback, and contract stability intent,
  - purpose alignment for explicit review visibility and retention/fallback-safe audit behavior,
  - additive/non-breaking evolution guardrail,
  - fallback/default non-activity/non-audit posture until implementation exists.
Manual verify:
- Confirm docs clearly define current runtime reality vs future visibility/review and audit safety/retention/fallback models.
- Confirm visibility/review purpose is explicit and non-ambiguous.
- Confirm audit safety/retention/fallback wording is explicit without implementation claims.
- Confirm docs clearly state planning-only scope and no runtime visibility/review or audit safety/retention/fallback implementation yet.

### Step 4 — DoD closeout + docs sync
Intended behavior:
- Verify Phase 48 Step 1-3 documentation is complete, planning-only, and implementation-safe.
- Confirm no runtime activity event, audit trail, visibility/review, or audit safety/retention/fallback implementation claims exist.
- Confirm `/api/chat` contract wording remains unchanged and compatibility is preserved.
Manual verify:
- Confirm Phase 48 verification is logged in `REZ_AI_UI_PROGRESS.md`.
- Confirm `PHASE 48 DoD — PASS` is recorded in plan/progress/context docs.

---

# PHASE 49 — Automation / Workflow Runtime Foundation (Current Stack)

Objective:
- Prepare REZ-AI for future bounded automation/workflow runtime behavior with implementation-safe planning semantics.
- Keep this phase docs-only and planning-only; do not imply active runtime automation/workflow implementation before scoped delivery.

## 49.1 Scope (Automation / Workflow Runtime Foundation)

### Item A — Workflow unit model
Future intent:
- Define future runtime concept for:
  - workflow creation,
  - multi-step workflow structure,
  - workflow outcome/failure states.
Purpose:
- Establish bounded multi-step workflow semantics for future automation/workflow behavior.
- Support future workflow visibility and control through explicit workflow-unit boundaries.
- Provide stable workflow state semantics for future automation behavior.
Current reality:
- Runtime workflow-unit orchestration layer is not implemented yet.
- Runtime remains in current non-workflow posture with no workflow-creation/lifecycle layer.
Future workflow-unit semantics:
- **Workflow creation (planned):** runtime may later create bounded workflow units from automation/workflow intent.
- **Multi-step structure (planned):** workflow units may later follow explicit multi-step structure semantics.
- **Outcome/failure states (planned):** workflow units may later end in explicit success/failure outcome states.
- **Contract boundary guardrail (planned):** workflow-unit semantics remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-workflow chat posture remains active until workflow-unit implementation exists.
Explicit note:
- Workflow unit model in this phase is planning groundwork only.

### Item B — Step orchestration model
Future intent:
- Define future runtime concept for:
  - ordered step execution,
  - dependency-aware step flow,
  - bounded progression through workflow steps.
Purpose:
- Preserve predictable workflow step order during future multi-step execution.
- Support dependency-aware workflow flow through explicit step constraints.
- Keep workflow progression bounded and controlled across orchestration flow.
Current reality:
- Runtime step-orchestration layer is not implemented yet.
- Runtime remains in current non-workflow posture with no ordered/dependency-aware step orchestration layer.
Future step-orchestration semantics:
- **Ordered execution (planned):** runtime may later execute workflow steps in explicit ordered sequences.
- **Dependency-aware flow (planned):** step progression may later respect dependency-aware flow constraints.
- **Bounded progression (planned):** runtime may later enforce bounded progression across workflow steps.
- **Contract boundary guardrail (planned):** step-orchestration semantics remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-workflow posture remains active until orchestration implementation exists.
Explicit note:
- Step orchestration model in this phase is conceptual only.

### Item C — Automation control model
Future intent:
- Define future runtime concept for:
  - approval-aware automation,
  - retry/continue/stop behavior,
  - safe bounded automation posture.
Purpose:
- Keep future automation behavior approval-aware and explicitly controllable.
- Preserve safe bounded automation posture with explicit retry/continue/stop controls.
- Provide stable control semantics for future workflow automation evolution.
Current reality:
- Runtime automation-control layer is not implemented yet.
- Runtime remains in current non-automation posture with no automation-control layer.
Future automation-control semantics:
- **Approval-aware automation (planned):** runtime may later apply approval-aware controls during automation flow.
- **Retry/continue/stop behavior (planned):** runtime may later support explicit retry/continue/stop control semantics.
- **Safe bounded posture (planned):** automation should remain safe and bounded by default.
- **Contract boundary guardrail (planned):** automation-control semantics remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-automation posture remains active until automation-control implementation exists.
Explicit note:
- Automation control model is planning-only and not active in runtime.

### Item D — Workflow safety / recovery / fallback model
Future intent:
- Define future runtime concept for:
  - failure-safe recovery,
  - deterministic fallback/default behavior,
  - workflow stability during partial failure,
  - contract stability during automation evolution.
Purpose:
- Prepare safe future workflow rollout with explicit recovery/fallback semantics.
- Preserve contract stability and implementation safety during automation capability evolution.
Current reality:
- Runtime workflow safety/recovery/fallback layer is not implemented yet.
- Runtime remains in current non-workflow posture without active recovery/fallback layer for partial failure.
Future workflow safety/recovery/fallback semantics:
- **Failure-safe recovery (planned):** runtime should later preserve failure-safe recovery behavior for interrupted/failed flows.
- **Deterministic fallback/default (planned):** runtime should preserve deterministic fallback behavior when workflow context is incomplete/unavailable.
- **Partial-failure stability (planned):** runtime should later preserve workflow stability during partial failure conditions.
- **Contract stability (planned):** automation evolution should preserve existing API/contract behavior.
- **Additive/non-breaking introduction (planned):** automation/workflow capabilities should remain additive and non-breaking.
- **Fallback/default posture (current system):** current non-workflow posture remains active until workflow safety/recovery/fallback implementation exists.
Explicit note:
- Workflow safety/recovery/fallback model is planning-only and not active in runtime.

## 49.2 Phase 49 Acceptance Criteria (DoD)

Phase 49 is DONE only if all pass:
- [x] Workflow unit model is documented.
- [x] Step orchestration model is documented.
- [x] Automation control model is documented.
- [x] Workflow safety/recovery/fallback model is documented.
- [x] No runtime automation/workflow implementation claims exist.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: PHASE 49 DoD — PASS

## 49.3 Minimal Step Plan (1-4)

### Step 1 — Workflow unit model
Intended behavior:
- Define conceptual runtime model for workflow creation, multi-step workflow structure, and workflow outcome/failure states, including:
  - current no-runtime workflow-unit layer reality,
  - future bounded workflow creation intent,
  - future multi-step structure semantics intent,
  - explicit workflow outcome/failure-state intent,
  - runtime-internal workflow-unit contract guardrail,
  - fallback/default non-workflow posture until implementation exists.
Manual verify:
- Confirm docs clearly distinguish current runtime posture from future workflow-unit model.
- Confirm purpose of workflow-unit modeling is explicit and non-ambiguous.
- Confirm workflow structure/outcome semantics are explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime workflow-unit implementation yet.

### Step 2 — Step orchestration model
Intended behavior:
- Define conceptual runtime model for ordered execution, dependency-aware flow, and bounded step progression, including:
  - current no-runtime step-orchestration layer reality,
  - future ordered step execution intent,
  - future dependency-aware flow intent,
  - future bounded progression intent,
  - runtime-internal orchestration contract guardrail,
  - fallback/default non-workflow posture until implementation exists.
Manual verify:
- Confirm docs clearly distinguish current runtime posture from future step-orchestration model.
- Confirm purpose of step-orchestration modeling is explicit and non-ambiguous.
- Confirm ordering/dependency/bounded-progression semantics are explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime orchestration implementation yet.

### Step 3 — Automation control + safety/recovery/fallback
Intended behavior:
- Define conceptual runtime model for automation-control semantics plus workflow safety/recovery/fallback behavior, including:
  - current no-runtime automation-control/safety layer reality,
  - future approval-aware control and retry/continue/stop intent,
  - future failure-safe recovery, deterministic fallback, and partial-failure stability intent,
  - contract stability and additive/non-breaking evolution guardrail,
  - fallback/default non-workflow posture until implementation exists.
Manual verify:
- Confirm docs clearly define current runtime reality vs future automation-control and workflow safety/recovery/fallback models.
- Confirm automation-control purpose is explicit and non-ambiguous.
- Confirm recovery/fallback/partial-failure wording is explicit without implementation claims.
- Confirm docs clearly state planning-only scope and no runtime automation/workflow implementation yet.

### Step 4 — DoD closeout + docs sync
Intended behavior:
- Verify Phase 49 Step 1-3 documentation is complete, planning-only, and implementation-safe.
- Confirm no runtime workflow-unit, step-orchestration, automation-control, or workflow safety/recovery/fallback implementation claims exist.
- Confirm `/api/chat` contract wording remains unchanged and compatibility is preserved.
Manual verify:
- Confirm Phase 49 verification is logged in `REZ_AI_UI_PROGRESS.md`.
- Confirm `PHASE 49 DoD — PASS` is recorded in plan/progress/context docs.

---

# PHASE 50 — Platform Integration / Productization Foundation (Current Stack)

Objective:
- Prepare REZ-AI for future platform-level integration and productization across already-defined foundations.
- Keep this phase docs-only and planning-only; do not imply active integrated platform runtime implementation before scoped delivery.

## 50.1 Scope (Platform Integration / Productization Foundation)

### Item A — Platform integration model
Future intent:
- Define future platform concept for:
  - how workspace, context, agent/task, execution, audit, and workflow foundations fit together,
  - unified platform boundary model,
  - product-level integration posture.
Purpose:
- Unify previously defined foundations into a single conceptual platform-integration model.
- Keep platform runtime boundaries explicit and non-ambiguous across integration domains.
- Support future implementation-safe integration without changing current runtime behavior.
Current reality:
- Runtime has no integrated platform runtime layer.
- Individual foundations exist only as conceptual documentation.
- Runtime posture remains non-integrated.
Future platform-integration semantics:
- **Foundation fit model (planned):** platform runtime may later organize foundations as explicit domains:
  - workspace domain,
  - context-isolation domain,
  - agent/task domain,
  - execution domain,
  - audit/activity domain,
  - workflow/automation domain.
- **Unified boundary model (planned):** platform integration may later enforce explicit boundaries:
  - user context boundary,
  - execution context boundary,
  - auditability boundary,
  - workflow orchestration boundary,
  - workspace scope boundary.
- **Product-level posture (planned):** integration may later align foundations into a product-ready platform posture.
- **Contract boundary guardrail (planned):** platform-integration semantics remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-integrated foundation posture remains active until platform integration implementation exists.
Explicit note:
- Platform integration model in this phase is planning groundwork only.

### Item B — User/operator surface model
Future intent:
- Define future platform concept for:
  - user-facing interaction surface,
  - operator/admin/review surface,
  - safe separation of normal usage vs advanced control surfaces.
Purpose:
- Keep user-facing interaction simple, clear, and safe for normal usage flows.
- Isolate advanced controls and operator/admin/review capabilities from default user workflows.
- Support product-safe separation between normal usage surfaces and operator workflows.
Current reality:
- Runtime has no integrated user/operator surface-separation layer.
- Runtime remains in current non-integrated surface posture with no separated user/operator runtime surfaces.
Future user/operator surface semantics:
- **User-facing surface (planned):** platform may later expose user-facing interaction surfaces for normal usage flows.
- **Operator/admin/review surface (planned):** platform may later expose bounded operator/admin/review surfaces for advanced control workflows.
- **Safe separation model (planned):** normal usage and advanced controls should remain explicitly separated by default.
- **Contract boundary guardrail (planned):** surface-separation semantics remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-integrated surface posture remains active until platform surface implementation exists.
Explicit note:
- User/operator surface model in this phase is conceptual only.

### Item C — Productization readiness model
Future intent:
- Define future platform concept for:
  - product-ready capability packaging,
  - rollout readiness,
  - environment/deployment/product posture alignment.
Purpose:
- Prepare productization semantics that package capabilities in a product-ready posture.
- Support rollout readiness and environment/deployment alignment without contract disruption.
Current reality:
- Runtime productization-readiness layer is not implemented yet.
- Runtime remains in current non-productized posture with no productization-readiness layer.
Future productization-readiness semantics:
- **Capability packaging (planned):** platform capabilities may later be packaged in bounded product-ready units.
- **Rollout readiness (planned):** platform may later adopt staged rollout-readiness posture.
- **Environment/deployment alignment (planned):** platform may later align environment and deployment posture with product expectations.
- **Contract boundary guardrail (planned):** productization-readiness semantics remain runtime-internal and are not part of current `/api/chat` contract.
- **Fallback/default posture (current system):** current non-productized posture remains active until productization-readiness implementation exists.
Explicit note:
- Productization readiness model is planning-only and not active in runtime.

### Item D — Platform safety / contract / rollout model
Future intent:
- Define future platform concept for:
  - contract-stable integration,
  - additive/non-breaking rollout,
  - safe fallback/default posture,
  - implementation-safe product evolution.
Purpose:
- Keep future platform integration contract-stable and rollout-safe.
- Preserve additive/non-breaking evolution with explicit safe fallback/default behavior.
Current reality:
- Runtime platform safety/contract/rollout layer is not implemented yet.
- Runtime remains in current non-platform posture without active integrated platform safety/rollout layer.
Future platform safety/contract/rollout semantics:
- **Contract-stable integration (planned):** platform integration should preserve contract stability.
- **Additive/non-breaking rollout (planned):** platform capabilities should roll out additively without breaking existing behavior.
- **Safe fallback/default posture (planned):** platform should preserve deterministic fallback/default behavior when integrated context is incomplete/unavailable.
- **Implementation-safe evolution (planned):** product evolution should remain bounded, reviewable, and implementation-safe.
- **Fallback/default posture (current system):** current non-platform posture remains active until platform safety/rollout implementation exists.
Explicit note:
- Platform safety/contract/rollout model is planning-only and not active in runtime.

## 50.2 Phase 50 Acceptance Criteria (DoD)

Phase 50 is DONE only if all pass:
- [x] Platform integration model is documented.
- [x] User/operator surface model is documented.
- [x] Productization readiness model is documented.
- [x] Platform safety/contract/rollout model is documented.
- [x] No runtime/platform implementation claims exist.
- [x] `/api/chat` contract remains unchanged and compatibility is preserved.

Status: PHASE 50 DoD — PASS

## 50.3 Minimal Step Plan (1-4)

### Step 1 — Platform integration model
Intended behavior:
- Define conceptual platform integration model for how existing foundations fit together, including:
  - current no-runtime platform-integration layer reality,
  - future foundation-fit integration intent,
  - future explicit platform domain fit across workspace/context-isolation/agent-task/execution/audit-activity/workflow-automation,
  - future unified platform-boundary intent,
  - future product-level integration posture intent,
  - runtime-internal integration contract guardrail,
  - fallback/default non-integrated posture until implementation exists.
Manual verify:
- Confirm docs clearly distinguish current runtime posture from future platform-integration model.
- Confirm integration-boundary semantics are explicit and non-ambiguous.
- Confirm foundation-fit domain mapping is explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime platform-integration implementation yet.

### Step 2 — User/operator surface model
Intended behavior:
- Define conceptual platform surface model for user/operator interaction boundaries, including:
  - current no-runtime integrated surface layer reality,
  - future user-facing interaction surface intent,
  - future operator/admin/review surface intent,
  - explicit safe separation of normal usage vs advanced control surfaces,
  - runtime-internal surface contract guardrail,
  - fallback/default non-integrated posture until implementation exists.
Manual verify:
- Confirm docs clearly distinguish current runtime posture from future user/operator surface model.
- Confirm purpose of user/operator surface modeling is explicit and non-ambiguous.
- Confirm user/operator separation semantics are explicit and non-ambiguous.
- Confirm docs clearly state planning-only scope and no runtime integrated-surface implementation yet.

### Step 3 — Productization readiness + platform safety/contract/rollout
Intended behavior:
- Define conceptual model for productization readiness and platform safety/contract/rollout behavior, including:
  - current no-runtime productization-readiness layer reality,
  - current no-runtime platform safety/contract/rollout layer reality,
  - future product-ready packaging and rollout-readiness intent,
  - future environment/deployment/product posture alignment intent,
  - future contract-stable, additive/non-breaking rollout intent,
  - future safe fallback/default and implementation-safe product evolution intent,
  - runtime-internal productization/safety contract guardrail,
  - fallback/default non-productized and non-platform posture until implementation exists.
Manual verify:
- Confirm docs clearly define current runtime reality vs future productization-readiness and platform safety/contract/rollout models.
- Confirm productization-readiness purpose is explicit and non-ambiguous.
- Confirm rollout/fallback/additive-non-breaking wording is explicit without implementation claims.
- Confirm docs clearly state planning-only scope and no runtime platform/productization implementation yet.

### Step 4 — DoD closeout + docs sync
Intended behavior:
- Verify Phase 50 Step 1-3 documentation is complete, planning-only, and implementation-safe.
- Confirm no runtime platform integration, user/operator surface separation, productization-readiness, or platform safety/contract/rollout implementation claims exist.
- Confirm `/api/chat` contract wording remains unchanged and compatibility is preserved.
Manual verify:
- Confirm Phase 50 verification is logged in `REZ_AI_UI_PROGRESS.md`.
- Confirm `PHASE 50 DoD — PASS` is recorded in plan/progress/context docs.

---

# PHASE 51 — Workspace-Scoped Runtime Core (First Implementation)

Objective:
- Implement the smallest safe runtime core slice after Phase 50 closeout.
- Add internal runtime scope resolution and backend-to-assistant scope wiring while keeping `/api/chat` contract unchanged.

## 51.1 Scope (Workspace-Scoped Runtime Core, First Slice)

### Item A — Internal runtime scope object
Future intent:
- Establish an internal runtime scope object that can later support workspace/project-scoped runtime behavior.
First-slice implementation:
- Add internal runtime scope resolver in backend.
- First-slice default scope object:
  - `mode: "local"`
  - `workspaceId: null`
  - `projectId: null`
  - `source: "default_local"`
Current reality:
- Runtime remains local/non-workspace in active behavior.
- Scope object exists for internal readiness only.
Guardrail:
- Scope remains internal-only in this slice and is not part of public API contracts.

### Item B — Server-side scope resolution + safe fallback
Future intent:
- Resolve runtime scope per chat request and keep resolution deterministic/safe.
First-slice implementation:
- Resolve runtime scope exactly once per `/api/chat` request.
- Do not read new request body keys for scope in this slice.
- Always fallback safely to local default scope when no scoped context exists.
Current reality:
- Runtime behavior stays non-integrated/local by design in first slice.
Guardrail:
- Request validation and `/api/chat` request shape remain unchanged.

### Item C — Backend -> assistant scope wiring (non-breaking)
Future intent:
- Wire runtime scope through backend -> assistant path as internal runtime context.
First-slice implementation:
- Pass scope via internal env var (`REZ_RUNTIME_SCOPE`) as JSON.
- Parse scope in assistant with try/catch and safe local fallback.
- Keep provider/chat/KB behavior functionally unchanged.
Current reality:
- Scope is wired for internal readiness and does not power workspace behavior yet.
Guardrail:
- No new endpoint and no new request body field are introduced.

### Item D — First-slice runtime guardrails
First-slice non-goals:
- No workflow engine implementation.
- No permissions engine implementation.
- No audit persistence implementation.
- No billing implementation.
- No workspace DB/persistence implementation.
- No public scope debug surface in response `meta`.
Contract boundary:
- `/api/chat` keys remain unchanged:
  - `message`, `systemPrompt`, `useKB`, `provider`, `model`, `planMode`.

## 51.2 Phase 51 Acceptance Criteria (DoD)

Phase 51 is DONE only if all pass:
- [x] Internal runtime scope resolver implemented.
- [x] Deterministic local fallback implemented.
- [x] Backend -> assistant scope wiring implemented.
- [x] Scope-aware runtime hooks implemented.
- [x] Minimal execution boundary implemented.
- [x] Non-local scope safely falls back to local behavior.
- [x] Scope remains internal-only (no public exposure).
- [x] `/api/chat` contract unchanged and compatible.

Status: PHASE 51 DoD — PASS

## 51.3 Minimal Step Plan (1-4)

### Step 1 — Implement first runtime-core slice
Intended behavior:
- Add internal runtime scope resolver in backend with deterministic local fallback.
- Resolve scope once per `/api/chat` request without changing request keys.
- Wire scope backend -> assistant via internal env var only.
- Parse scope in assistant with try/catch + deterministic local fallback.
- Keep scope internal-only; do not expose it in response `meta`.
- Keep provider/chat/KB behavior functionally unchanged.
Implementation status:
- Implemented in this slice.
Manual verify:
- Confirm baseline chat still returns `ok/reply/meta` as before.
- Confirm current UI payload works unchanged with existing `/api/chat` keys only.
- Confirm assistant still works when runtime scope env is missing/invalid (safe fallback).
- Confirm `useKB` on/off behavior remains unchanged.
- Confirm no new endpoint/body key/UI dependency was introduced.

### Step 2 — Runtime hardening checks (first-slice safety)
Intended behavior:
- Validate that scope fallback behavior remains deterministic under invalid scope input.
- Validate internal wiring does not leak scope into public response shape.
- Validate no regressions in provider/KB paths after internal scope wiring.
 - Refine assistant-side scope-aware runtime hooks so future guard points are explicit while local behavior remains unchanged.
Implementation status:
- Implemented in this slice.
Manual verify:
- Confirm parse-failure fallback always returns local-safe scope behavior.
- Confirm no public `meta.scope` or equivalent field exists.
- Confirm provider and KB paths remain stable with scope wiring enabled.
- Confirm scope-aware hook points are present internally without exposing new public API fields.

### Step 3 — Minimal scope-aware execution boundary (internal-only)
Intended behavior:
- Add one explicit internal scope-aware execution-boundary decision path.
- Keep current local mode as the only active normal behavior path.
- Ensure unknown/non-local scope inputs fail safe to local-safe behavior without crash.
- Keep boundary internal-only with no public response/meta exposure.
Implementation status:
- Implemented in this slice.
Manual verify:
- Confirm local mode behavior remains unchanged.
- Confirm unknown/non-local scope input follows safe local fallback behavior.
- Confirm no `meta.scope` or similar public scope field appears.
- Confirm `/api/chat` contract unchanged wording remains explicit.

### Step 4 — DoD closeout + docs sync
Intended behavior:
- Verify Step 1-3 runtime-core implementation coverage.
- Confirm scope remains internal-only.
- Confirm no `/api/chat` contract changes.
- Confirm runtime behavior remains stable.

Manual verify:
- Confirm Phase 51 verification entry exists in `REZ_AI_UI_PROGRESS.md`.
- Confirm Phase 51 DoD checklist is fully `[x]`.
- Confirm no public scope exposure exists.
- Confirm `/api/chat` contract keys remain unchanged.

---

# PHASE 52 — Task / Execution Runtime Engine (First Active Runtime)

Objective:
- Define the smallest safe active runtime phase on top of Phase 51 internal runtime-scope core.
- Introduce internal task/execution lifecycle behavior while keeping `/api/chat` backward-compatible.

## 52.1 Scope (Task / Execution Runtime Engine, First Active Slice)

### Item A — Internal task unit model
Future intent:
- Introduce an internal task unit model that can represent one bounded execution attempt.
First-slice implementation (Step 1):
- Define a minimal internal task unit envelope (runtime-internal only) with stable identifiers and state markers.
- Keep task model fully internal; do not expose task fields via public `/api/chat` response contract.
Current reality:
- Internal task unit envelope exists for each bounded execution attempt in active request handling.
- Envelope remains runtime-internal and non-persistent.
Guardrail:
- No new request keys and no public `meta.task` fields in this phase.

### Item B — Internal execution state lifecycle
Future intent:
- Add explicit internal lifecycle states for task execution progression.
First-slice implementation (Step 2):
- Define deterministic internal lifecycle states for first active runtime slice:
  - `created`
  - `running`
  - `succeeded`
  - `failed`
- Apply bounded transitions for current request flow while keeping lifecycle runtime-internal and non-persistent.
Current reality:
- Internal lifecycle transitions exist for current request flow and remain internal-only.
Guardrail:
- `/api/chat` request/response contract remains unchanged (`ok/reply/meta` response posture preserved).

### Item C — Bounded single-step execution + deterministic failure handling
Future intent:
- Add one bounded single-step execution path with deterministic failure behavior.
Planned first implementation target:
- Keep execution limited to one active bounded step in this phase.
- Normalize failure handling to deterministic, local-safe outcomes without crash or contract drift.
- Preserve existing provider/chat/KB behavior semantics unless explicitly guarded by internal runtime rules.
Current reality:
- Active runtime behavior now includes bounded single-step execution (`maxSteps: 1`) with deterministic bounded failure handling.
Guardrail:
- No workflow engine, permissions engine, audit persistence, billing, or workspace DB/persistence implementation in this phase.

### Item D — Backward-compatible response posture + strict non-goals
Contract boundary:
- `/api/chat` request keys remain unchanged:
  - `message`, `systemPrompt`, `useKB`, `provider`, `model`, `planMode`.
- `/api/chat` success response posture remains unchanged:
  - `ok`, `reply`, `meta`.
Strict non-goals in this phase:
- No full workflow engine.
- No permissions engine.
- No audit persistence.
- No billing.
- No workspace DB/persistence.
- No public scope exposure.
- No UI contract changes.

## 52.2 Phase 52 Acceptance Criteria (DoD)

Phase 52 is DONE only if all pass:
- [x] Internal task unit model is implemented as runtime-internal only.
- [x] Internal execution state lifecycle is implemented with deterministic transitions.
- [x] Bounded single-step execution path is implemented.
- [x] Deterministic failure handling is implemented without contract drift.
- [x] Local-safe fallback behavior is preserved for unsupported/non-local runtime conditions.
- [x] `/api/chat` request keys remain unchanged (`message`, `systemPrompt`, `useKB`, `provider`, `model`, `planMode`).
- [x] `/api/chat` response posture remains backward-compatible (`ok`, `reply`, `meta`).
- [x] No public scope/task/execution fields are exposed in response `meta`.
- [x] No new endpoints/services/storage layers are introduced in this phase.
- [x] Live `/api/chat` end-to-end verification passed with unchanged public response shape (`ok`, `reply`, `meta`) and no `meta.task`/`meta.state`.
- [x] UI smoke verification passed (chat load/send/reply) with no Step 3-driven layout/control contract change.
- [x] Failure-path sanity verification passed (bounded error response + runtime remains stable).

Status: PHASE 52 DoD — PASS

## 52.3 Minimal Step Plan (1-4)

### Step 1 — Define internal task unit model boundary
Intended behavior:
- Define first active runtime task unit envelope as internal-only model.
- Keep task identifiers/state markers internal and non-public.
- Preserve current `/api/chat` request/response contract unchanged.
Implementation status:
- Implemented in this slice.
Manual verify:
- Confirm normal chat still works unchanged.
- Confirm `/api/chat` request keys remain unchanged.
- Confirm response remains `ok`, `reply`, `meta`.
- Confirm no public task field is exposed.
- Confirm no persistence/storage path was introduced for task units.

### Step 2 — Define execution lifecycle transitions (internal-only)
Intended behavior:
- Define deterministic internal lifecycle transitions for bounded execution state flow.
- Keep lifecycle non-persistent and internal-only in this first active slice.
- Preserve provider/chat/KB compatibility posture.
Implementation status:
- Implemented in this slice.
Manual verify:
- Confirm internal lifecycle states exist: `created`, `running`, `succeeded`, `failed`.
- Confirm active execution transitions to `running` and reaches `succeeded` on success path.
- Confirm bounded failure path reaches `failed` safely without crash.
- Confirm no public lifecycle/task fields are exposed in `/api/chat` response `meta`.
- Confirm `/api/chat` request/response contract remains unchanged.

### Step 3 — Define bounded single-step execution + failure policy
Intended behavior:
- Define one bounded single-step execution policy for first active runtime behavior.
- Define deterministic failure handling and local-safe fallback posture.
- Keep all behavior internal-only and backward-compatible.
Implementation status:
- Implemented in this slice.
Manual verify:
- Confirm active execution boundary is explicit single-step only (`maxSteps: 1`) with no chained execution.
- Confirm unsupported/invalid execution boundary conditions fail deterministically to bounded failure handling.
- Confirm internal execution preparation failures and provider/runtime failures map to bounded failure semantics.
- Confirm no public task/lifecycle fields are exposed in `/api/chat` response.
- Confirm provider/chat/KB behavior remains functionally unchanged for normal success path.

### Step 4 — DoD closeout + docs sync
Intended behavior:
- Verify Phase 52 Step 1-3 plan wording is implementation-safe and internally scoped.
- Confirm strict non-goals and `/api/chat` compatibility guardrails remain explicit.
- Confirm roadmap/context/progress docs remain synchronized.
Implementation status:
- Implemented in this slice.
Manual verify:
- Confirm Phase 52 roadmap entry exists in `REZ_AI_UI_PROGRESS.md`.
- Confirm Phase 52 DoD checklist is present and reflects actual step progress.
- Confirm `REZ_AI_CONTEXT.md` reflects Phase 52 closeout status and updated next-step wording.
- Confirm `CURRENT NEXT STEP` is advanced from Step 4 to post-closeout planning state.

---

# PHASE 53 — Multi-Step Execution Model (Planning Layer)

Objective:
- Define the next internal planning boundary after Phase 52 single-step runtime foundation.
- Document conceptual multi-step execution semantics without changing current runtime behavior.
- Keep `/api/chat` contract strictly unchanged and runtime untouched in this phase.

## 53.1 Scope (Planning Layer, Docs-Only)

### Item A — Internal multi-step execution unit model (planning)
Current reality:
- Runtime supports only bounded single-step execution.
Target intent:
- Define conceptual model for future multi-step execution units.
Model concepts:
- execution unit
- step list
- step ordering
- step boundaries
Guardrail:
- No runtime implementation in this phase.
Fallback/default posture:
- Current single-step runtime remains the only active behavior.

### Item B — Step outcome semantics (planning)
Current reality:
- Only task-level lifecycle currently exists.
Target intent:
- Define conceptual step-level outcomes:
  - `continue`
  - `stop`
  - `fail`
  - `needs_review`
Guardrail:
- No API exposure in this phase.
Fallback/default posture:
- Existing Phase 52 bounded failure behavior remains unchanged.

### Item C — Review / approval readiness boundary (planning)
Current reality:
- No approval/review runtime exists.
Target intent:
- Document where review checkpoints could exist in a future runtime.
Guardrail:
- No approval engine implementation in this phase.
Fallback/default posture:
- Execution remains fully automatic single-step behavior.

### Item D — Contract and non-goals guardrails (planning)
Contract boundary:
- `/api/chat` request keys remain unchanged:
  - `message`, `systemPrompt`, `useKB`, `provider`, `model`, `planMode`.
- `/api/chat` response posture remains unchanged:
  - `ok`, `reply`, `meta`.
Strict non-goals in this phase:
- No runtime implementation changes.
- No `/api/chat` contract changes.
- No new endpoints.
- No new public response fields.
- No public task/meta exposure.

## 53.2 Phase 53 Acceptance Criteria (DoD)

Phase 53 is DONE only if all pass:
- [x] Step 1 planning definition documents internal multi-step unit model concepts (planning layer only).
- [x] Step 2 planning definition documents step outcome semantics (`continue/stop/fail/needs_review`).
- [x] Step 3 planning definition documents review/approval readiness boundary semantics.
- [x] Explicit non-goals are documented and consistent.
- [x] `/api/chat` contract is explicitly unchanged.
- [x] Runtime is explicitly unchanged (docs-only phase).

Status: PHASE 53 DoD — PASS

## 53.3 Minimal Step Plan (1-4)

### Step 1 — Define internal multi-step unit model (planning)
Current reality:
- Runtime supports only single-step execution.
Target intent:
- Define conceptual model for future internal multi-step execution units.
- Keep semantics implementation-safe and runtime-internal.
Model concepts (planning terminology only):
- parent execution intent
- execution unit
- ordered internal steps (step list + step ordering)
- bounded step count concept
- terminal boundary concept
Guardrail:
- No runtime implementation.
Fallback/default posture:
- Single-step runtime remains the only active behavior.
Step 1 non-goals:
- No runtime multi-step orchestration.
- No step executor.
- No loop/chaining activation.
- No approval engine.
- No audit persistence.
- No public task visibility.
- No `/api/chat` contract changes.
Implementation status:
- Implemented in this slice (docs-only planning definition).
Manual verify:
- Confirm wording is conceptual/planning-only and does not claim active runtime multi-step behavior.
- Confirm non-goals remain explicit and implementation-safe.
- Confirm no `/api/chat` contract/endpoint/public-field changes are introduced by this step.

### Step 2 — Define step outcome semantics (planning)
Current reality:
- Only task-level lifecycle exists; real step-level execution runtime is not implemented.
Target intent:
- Define conceptual internal step-level outcomes for future multi-step flow:
  - `continue`: current conceptual step may hand off to the next ordered conceptual step.
  - `stop`: current conceptual step may terminate flow without failure.
  - `fail`: current conceptual step may terminate flow through bounded failure semantics.
  - `needs_review`: current conceptual step may pause at a future review checkpoint before any continuation.
- Keep semantics internal-only and planning-safe; do not imply an active step engine.
Guardrail:
- No API exposure.
Fallback/default posture:
- Existing Phase 52 bounded failure behavior remains unchanged.
Step 2 non-goals:
- No runtime step engine.
- No step scheduler.
- No automatic continue loop.
- No review system activation.
- No approval workflow engine.
- No audit persistence.
- No public step/task state exposure.
- No `/api/chat` contract changes.
Implementation status:
- Implemented in this slice (docs-only planning definition).
Manual verify:
- Confirm each conceptual outcome state is documented with conservative wording (`continue`, `stop`, `fail`, `needs_review`).
- Confirm wording does not claim active step-level runtime execution or existing step engine/scheduler.
- Confirm semantics are documented as internal-only and contract-safe.

### Step 3 — Define review / approval readiness boundary (planning)
Current reality:
- No review/approval runtime exists; no active review system, operator queue, or approval gates are implemented.
Target intent:
- Define conceptual review/approval readiness boundary for future internal multi-step execution.
- Document where future review checkpoints could exist (planning-only), for example:
  - before a future higher-impact conceptual step executes,
  - after a conceptual `needs_review` step outcome,
  - before a conceptual finalization step that would require explicit confirmation.
- Clarify which conceptual outcomes may require review handoff (`needs_review` primary, optional `fail` escalation in future policy).
- Keep approval readiness as an internal boundary model that future higher-impact execution may depend on.
Guardrail:
- No approval engine and no active gating enforcement in this phase.
Fallback/default posture:
- All real behavior remains on Phase 52 single-step runtime safeguards.
Step 3 non-goals:
- No approval engine.
- No operator UI.
- No review queue.
- No workflow runtime.
- No gating enforcement.
- No audit persistence.
- No public approval status exposure.
- No `/api/chat` contract changes.
Implementation status:
- Implemented in this slice (docs-only planning definition).
Manual verify:
- Confirm wording is conceptual/readiness-only and does not claim active review/approval runtime.
- Confirm future checkpoint placement is described as optional planning boundary, not active flow.
- Confirm non-goals and contract guardrails remain explicit and unchanged.

### Step 4 — DoD closeout + docs sync
Current reality:
- Phase 53 is planning-only.
Target intent:
- Close out planning docs and verify all guardrails remain explicit.
Guardrail:
- Docs updated only; no runtime changes.
Fallback/default posture:
- Existing runtime behavior remains unchanged.
Implementation status:
- Implemented in this slice (docs-only closeout).
Manual verify:
- Confirm Step 1-3 wording remains conceptual/planning-only with no active runtime claims.
- Confirm explicit non-goals are documented and consistent across plan/context/progress docs.
- Confirm `/api/chat` contract posture remains unchanged in all Phase 53 guardrails.
- Confirm no public task/state/review exposure is claimed.
- Confirm `PHASE 53 DoD — PASS` is recorded and synchronized.

---

# PHASE 54 — Bounded Multi-Step Runtime Activation (Internal-Only First Slice)

Objective:
- Define implementation-safe planning scope for the first internal-only runtime evolution beyond Phase 52 single-step behavior.
- Keep activation bounded, deterministic, and contract-safe while preserving current default behavior.
- Preserve strict guardrails: no `/api/chat` contract changes, no new endpoints/fields, and no public task/state/review exposure.

## 54.1 Scope (Bounded Internal Activation, First Slice)

### Item A — Internal execution loop boundary
Current reality:
- Runtime remains bounded single-step by default.
Target intent:
- Define conceptual internal loop-boundary model with explicit max-step cap and deterministic terminal exits.
Guardrail:
- Boundary remains internal-only and must not alter public API shape.
Fallback/default posture:
- Single-step remains active default unless explicit internal continuation rule is met.

### Item B — Internal step transition handler
Current reality:
- Step outcomes are documented conceptually but no runtime transition handler exists yet.
Target intent:
- Define planning model for internal transition handling across conceptual step outcomes (`continue`, `stop`, `fail`, `needs_review`).
Guardrail:
- No active runtime claim for step engine/scheduler in this planning phase.
Fallback/default posture:
- Single-step remains active default unless explicit internal continuation rule is met.

### Item C — Safe cancellation / timeout semantics
Current reality:
- Existing runtime has bounded failure/timeout handling for single-step execution path.
Target intent:
- Define conceptual cancellation/timeout semantics for bounded multi-step evolution without changing contract posture.
Guardrail:
- No public cancellation API or response-field expansion in this phase.
Fallback/default posture:
- Single-step remains active default unless explicit internal continuation rule is met.

### Item D — Internal observability breadcrumbs
Current reality:
- Existing observability is focused on current request/runtime behavior.
Target intent:
- Define minimal internal breadcrumb model for future step progression visibility (internal logs/signals only).
Guardrail:
- No public observability surface additions in this phase.
Fallback/default posture:
- Single-step remains active default unless explicit internal continuation rule is met.

### Item E — Explicit out-of-scope (must remain unchanged)
Strict non-goals in this phase:
- No approval engine.
- No operator UI.
- No public task visibility.
- No workflow platform activation.
- No audit persistence.
- No `/api/chat` request/response contract changes.
- No new endpoints/request/response fields.

## 54.2 Phase 54 Acceptance Criteria (DoD Draft)

Phase 54 is DONE only if all pass:
- [x] Step 1 planning definition documents internal execution loop boundary model with bounded cap and deterministic exits.
- [x] Step 2 planning definition documents internal step transition handler model for `continue/stop/fail/needs_review`.
- [x] Step 3 planning definition documents safe cancellation/timeout semantics for bounded evolution.
- [x] Step 4 planning definition documents internal observability breadcrumb model with internal-only posture.
- [x] Explicit out-of-scope/non-goals are documented and consistent.
- [x] `/api/chat` contract is explicitly unchanged.
- [x] Public API/UI surface is explicitly unchanged.
- [x] Regression verification requirements are explicitly documented.

Status: PHASE 54 DoD — PASS

## 54.3 Minimal Step Plan (1-5)

### Step 1 — Define internal execution loop boundary (planning)
Current reality:
- Runtime is single-step by active behavior.
Target intent:
- Define internal bounded loop model with max-step cap and deterministic terminal exit rules.
Guardrail:
- No runtime activation in this step.
Fallback/default posture:
- Single-step remains active default unless explicit internal continuation rule is met.
Step 1 non-goals:
- No runtime loop activation.
- No scheduler/engine implementation.
- No approval system.
- No public exposure.
Implementation status:
- Implemented in this slice (docs-only planning definition).
Manual verify:
- Confirm loop boundary wording is conceptual/planning-only and not active runtime behavior.
- Confirm hard max step-cap concept is explicit.
- Confirm deterministic terminal exits are explicit and contract-safe.
- Confirm no `/api/chat` contract/endpoint/public-field changes are introduced by this step.

### Step 2 — Define internal step transition handler (planning)
Current reality:
- Step outcomes exist as conceptual semantics only; no runtime transition handler is active.
Target intent:
- Define conceptual internal next-action mapping for future bounded flow:
  - `continue` -> conceptual next action may advance to the next ordered internal step when continuation conditions are met.
  - `stop` -> conceptual next action may terminate as non-failure terminal completion within bounded loop rules.
  - `fail` -> conceptual next action may terminate via deterministic failure exit in bounded loop rules.
  - `needs_review` -> conceptual next action may route to internal review-ready boundary state (planning-only; no active approval flow).
- Keep transition semantics internal-only and implementation-safe with deterministic mapping intent.
Guardrail:
- No step scheduler/engine implementation in this step.
Fallback/default posture:
- Single-step remains active default unless explicit internal continuation rule is met.
Step 2 non-goals:
- No step scheduler.
- No runtime execution loop activation.
- No approval workflow.
- No public state exposure.
Implementation status:
- Implemented in this slice (docs-only planning definition).
Manual verify:
- Confirm outcome-to-next-action mapping is documented for `continue/stop/fail/needs_review`.
- Confirm mapping is explicitly conceptual/internal-only and not described as active runtime behavior.
- Confirm no `/api/chat` contract/endpoint/public-field changes are introduced by this step.

### Step 3 — Define safe cancellation / timeout semantics (planning)
Current reality:
- Single-step timeout/failure safeguards are active in current runtime; no multi-step cancellation runtime is active.
Target intent:
- Define conceptual safe cancellation/timeout semantics for future bounded multi-step evolution, including:
  - step-level timeout concept (per-step bounded time budget),
  - whole-execution timeout budget concept (total bounded execution window),
  - safe cancellation/abort boundary concept (internal stop boundary without unsafe side effects),
  - deterministic timeout/cancel terminal handling concept (bounded terminal outcomes for timeout/abort).
- Keep semantics internal-only and planning-safe with deterministic handling intent.
Guardrail:
- No public cancel API and no contract expansion in this step.
Fallback/default posture:
- Single-step remains active default unless explicit internal continuation rule is met.
Step 3 non-goals:
- No public cancel API.
- No runtime cancellation implementation.
- No timeout UI.
- No public state exposure.
Implementation status:
- Implemented in this slice (docs-only planning definition).
Manual verify:
- Confirm step-level and whole-execution timeout budget concepts are explicitly documented.
- Confirm safe cancellation/abort boundary and deterministic timeout/cancel terminal handling are explicitly documented.
- Confirm wording is conceptual/planning-only and does not claim active cancellation runtime behavior.
- Confirm no `/api/chat` contract/endpoint/public-field changes are introduced by this step.

### Step 4 — Define internal observability breadcrumbs (planning)
Current reality:
- No dedicated step-level breadcrumb model is defined for future multi-step runtime.
Target intent:
- Define conceptual internal observability breadcrumbs for future runtime readiness, including:
  - internal step progression trace concept,
  - step start / step end trace points,
  - failure trace concept,
  - timeout / cancel trace concept,
  - minimal internal diagnostic breadcrumb model.
- Keep breadcrumbs internal-only and implementation-safe; no public observability surface.
Guardrail:
- No public observability exposure in this step.
Fallback/default posture:
- Single-step remains active default unless explicit internal continuation rule is met.
Step 4 non-goals:
- No public observability API.
- No UI logs.
- No telemetry pipeline.
- No audit persistence.
- No public state exposure.
Implementation status:
- Implemented in this slice (docs-only planning definition).
Manual verify:
- Confirm Step 4 wording is conceptual/planning-only and does not claim active runtime tracing implementation.
- Confirm trace concepts include progression, start/end points, failure, and timeout/cancel coverage.
- Confirm non-goals and contract guardrails remain explicit and unchanged.

### Step 5 — DoD closeout + docs sync
Current reality:
- Phase 54 is planning-only.
Target intent:
- Close planning docs with explicit DoD status and guardrail consistency checks.
Guardrail:
- Docs-only closeout; runtime remains untouched.
Fallback/default posture:
- Single-step remains active default unless explicit internal continuation rule is met.
Implementation status:
- Implemented in this slice (docs-only closeout).
Manual verify:
- Confirm Step 1-4 wording remains planning-only and implementation-safe.
- Confirm out-of-scope/non-goals remain explicit and consistent.
- Confirm `/api/chat` contract wording remains unchanged.
- Confirm no public task/state/review/observability exposure claims are introduced.
- Confirm `PHASE 54 DoD — PASS` is recorded and synchronized across plan/context/progress docs.

---

# PHASE 55 — Guarded Internal Multi-Step Runtime (Minimal First Activation)

Objective:
- Start the first minimal runtime implementation slice for internal multi-step evolution with strict safety boundaries.
- Keep runtime activation internal-only, bounded, deterministic, and fail-safe.
- Preserve guardrails: `/api/chat` contract unchanged, no new public endpoints/fields, no public task/state exposure, UI unchanged, and single-step as default behavior.

## 55.1 Scope (Minimal Runtime Activation, Internal-Only)

### Item A — Internal continuation gate (default OFF behavior by policy)
Current reality:
- Runtime is active single-step by default.
Target intent:
- Add explicit internal continuation-decision boundary so continuation can occur only when strict internal conditions are met.
Guardrail:
- No public toggle/switch and no request/response field changes.
Fallback/default posture:
- Single-step remains active default when continuation conditions are not met.

### Item B — Bounded loop activation for guarded path
Current reality:
- Loop boundary is documented, but multi-step loop runtime is not active.
Target intent:
- Activate minimal bounded internal loop behavior only for guarded continuation path, with hard cap and deterministic terminal exits.
Guardrail:
- Activation remains internal-only and must not alter `/api/chat` response shape.
Fallback/default posture:
- Any invalid/unsupported continuation state falls back to existing bounded single-step behavior.

### Item C — Step transition + timeout/cancel handling in active path
Current reality:
- Transition and timeout/cancel semantics are documented, but not active as multi-step runtime behavior.
Target intent:
- Implement minimal runtime transition handling for `continue/stop/fail/needs_review` and bounded timeout/cancel terminal handling in guarded internal flow.
Guardrail:
- No public cancel API, no review UI/workflow, and no public state exposure.
Fallback/default posture:
- Ambiguous transition/cancellation states terminate safely with deterministic bounded failure handling.

### Item D — Minimal internal observability breadcrumbs in runtime
Current reality:
- Breadcrumb semantics are planning-defined only.
Target intent:
- Add minimal internal diagnostic breadcrumbs for guarded runtime path (step progression/start/end/failure/timeout-cancel).
Guardrail:
- Internal logging only; no public observability APIs/fields/UI changes.
Fallback/default posture:
- If breadcrumb capture fails, execution remains contract-safe and bounded.

### Item E — Explicit out-of-scope (must remain unchanged)
Must remain unchanged in Phase 55:
- `/api/chat` request/response contract.
- Public endpoint surface (no new endpoints).
- Public task/state/review/observability exposure.
- Existing UI flow/layout/controls.
- Single-step default behavior posture.
- Provider/chat/KB baseline behavior on default single-step path.

## 55.2 Phase 55 Acceptance Criteria (DoD Draft)

Phase 55 is DONE only if all pass:
- [x] Internal continuation gate exists with default single-step-preserving posture.
- [x] Guarded multi-step runtime path is bounded by explicit hard cap and deterministic terminal exits.
- [x] Active transition handling covers `continue/stop/fail/needs_review` with deterministic bounded behavior.
- [x] Timeout/cancel handling is active only as internal bounded semantics (no public cancel API).
- [x] Minimal internal breadcrumb diagnostics exist for guarded path without public exposure.
- [x] `/api/chat` contract and endpoint surface remain unchanged.
- [x] No public task/state/review/observability fields are exposed.
- [x] UI flow remains unchanged.
- [x] Regression verification covers default single-step path and guarded internal path safety.

Status: PHASE 55 DoD — PASS

## 55.3 Minimal Implementation Step Plan (1-4)

### Step 1 — Implement internal continuation gate (minimal, default-safe)
Current reality:
- No active runtime continuation gate exists; runtime behavior is effectively single-step.
Target intent:
- Introduce explicit internal continuation decision function with strict allow/deny rules.
Guardrail:
- No API contract or endpoint changes.
Fallback/default posture:
- Deny-by-default continuation; single-step remains active baseline.
Implementation status:
- Implemented in this slice (runtime + docs sync).
Manual verify:
- Confirm server generates internal continuation-gate payload and passes it via assistant env only.
- Confirm gate is deny-by-default when explicit internal allow signal is absent.
- Confirm gate remains internal-only (no API response/meta expansion, no UI change).
- Confirm default `/api/chat` success path remains stable and single-step boundary remains active.

### Step 2 — Activate bounded guarded loop path
Current reality:
- Loop boundary and gate wiring now include minimal active guarded-loop runtime path under internal-only allow conditions.
Target intent:
- Execute continuation only through guarded bounded loop path with hard cap and deterministic exits.
Guardrail:
- No public task/state visibility and no UI behavior changes.
Fallback/default posture:
- On invalid state/transition, terminate safely using existing bounded failure posture.
Implementation status:
- Implemented in this slice (runtime + docs sync).
Manual verify:
- Confirm guarded loop mode activates only when internal continuation gate allow is explicit and preconditions pass.
- Confirm hard cap is enforced in runtime boundary validation (`maxSteps: 2`) with deterministic stop at cap.
- Confirm deterministic bounded failure handling remains active for provider/runtime failures in guarded path.
- Confirm default path remains single-step when continuation gate is absent/deny (no public behavior change).
- Confirm `/api/chat` response shape and endpoint surface remain unchanged.

### Step 3 — Wire transition + timeout/cancel + internal breadcrumbs
Current reality:
- Transition, timeout/cancel, and breadcrumb semantics now include minimal active guarded-mode runtime handling.
Target intent:
- Implement minimal internal runtime handling for step transitions and timeout/cancel outcomes with diagnostic breadcrumbs.
Guardrail:
- No public cancel/review/observability surfaces.
Fallback/default posture:
- Deterministic safe terminal handling on unexpected states; default path remains single-step.
Implementation status:
- Implemented in this slice (runtime + docs sync).
Manual verify:
- Confirm guarded mode transition handling is runtime-active for internal outcomes `continue/stop/fail/needs_review`.
- Confirm guarded-mode timeout and cancel signals resolve through deterministic bounded fail-terminal handling.
- Confirm internal `needs_review` terminal is mapped to public-safe bounded failure code/message with no review-semantic public error exposure.
- Confirm breadcrumbs remain internal-only and are not exposed via `/api/chat` response fields.
- Confirm default single-step path remains unchanged when continuation gate is deny/default.
- Confirm no endpoint/public-field/UI contract expansion occurred.

### Step 4 — Regression verification + DoD closeout + docs sync
Current reality:
- Phase 55 runtime verification evidence now exists for default and guarded paths under current internal-only scope.
Target intent:
- Verify guardrails and close docs with explicit PASS/NOT FULLY VERIFIED outcome based on evidence.
Guardrail:
- No scope expansion beyond minimal internal slice.
Fallback/default posture:
- If verification is partial, keep status not fully closed and preserve default single-step behavior.
Implementation status:
- Implemented in this slice (verification + docs closeout sync).
Manual verify:
- Confirm Step 1 gate behavior: default deny remains single-step and guarded path only activates with explicit internal allow + local/running preconditions.
- Confirm Step 2 bounded behavior: guarded path remains hard-capped (`maxSteps: 2`) with deterministic terminal stop.
- Confirm Step 3 stability behavior: timeout/cancel/internal-needs-review terminate deterministically, and public-safe error mapping remains review-semantic free.
- Confirm `/api/chat` request/response contract is unchanged and endpoint surface is unchanged.
- Confirm no public task/state/review/observability exposure and no UI changes.
- Record `PHASE 55 DoD — PASS` after successful regression verification and docs synchronization.

---

# PHASE 56 — Internal Guarded Transition Policy Hardening

Objective:
- Harden guarded-runtime transition policy semantics with strict internal-only deterministic behavior.
- Preserve all public guardrails: `/api/chat` contract unchanged, no new endpoints, no public task/state/review exposure, no UI changes.
- Keep telemetry strictly internal-only and bounded.

## 56.1 Scope (Stepwise Internal Hardening)

### Item A — Strict guarded-mode-only transition policy resolver
Current reality:
- Guarded runtime transitions are active but require stricter policy centralization.
Target intent:
- Enforce a single guarded-mode-only transition policy resolver with explicit action outputs.
Guardrail:
- Single-step default path remains unchanged and does not use guarded transition policy resolver.
Fallback/default posture:
- Any undefined policy branch resolves to deterministic bounded fail-terminal behavior.

### Item B — Deterministic precedence ordering
Current reality:
- Deterministic behavior exists but precedence ordering should be explicitly hardened.
Target intent:
- Enforce deterministic precedence order across internal guarded transition decisions.
Guardrail:
- No public behavior/field expansion from precedence hardening.
Fallback/default posture:
- If conflict exists between transition signals, highest-priority deterministic terminal wins.

### Item C — Bounded fallback mapping for unknown/invalid outcomes
Current reality:
- Unknown transition outcomes should terminate safely without ambiguity.
Target intent:
- Map unknown/invalid outcomes to bounded fail-terminal action deterministically.
Guardrail:
- No review semantics leaked publicly from fallback handling.
Fallback/default posture:
- Unknown transition outcomes always terminate with public-safe bounded failure semantics.

### Item D — Internal-only transition decision breadcrumb alignment
Current reality:
- Breadcrumbs exist; transition decision payload alignment requires stricter internal policy semantics.
Target intent:
- Emit transition decision breadcrumbs with explicit internal action/terminal/policy version alignment.
Guardrail:
- Breadcrumbs remain internal-only (no API/meta/UI exposure).
Fallback/default posture:
- Breadcrumb write failure remains non-fatal and contract-safe.

### Item E — Explicit unchanged surfaces
Must remain unchanged in Phase 56:
- `/api/chat` request/response contract.
- Public endpoint surface (no new endpoints).
- Public task/state/review/observability exposure.
- UI behavior and layout.
- Single-step default execution posture.

## 56.2 Phase 56 Acceptance Criteria (DoD Draft)

Phase 56 is DONE only if all pass:
- [x] Guarded-mode-only strict transition policy resolver is active.
- [x] Deterministic precedence ordering is active in guarded transition policy path.
- [x] Unknown/invalid transition outcomes map to bounded fail-terminal behavior deterministically.
- [x] Transition decision breadcrumbs are aligned and remain internal-only.
- [x] Guarded timeout/cancel resilience checkpoints enforce deterministic precedence and block continuation under cancel/budget exhaustion.
- [x] Guarded-only internal telemetry baseline schema is active with versioned event types and deterministic detail normalization.
- [x] `/api/chat` contract and endpoint surface remain unchanged.
- [x] No public task/state/review/observability exposure exists.
- [x] UI flow remains unchanged.
- [x] Regression verification covers default single-step and guarded internal path safety.

Status: PHASE 56 DoD — PASS

## 56.3 Minimal Implementation Step Plan (1-4)

### Step 1 — Implement internal transition policy hardening
Current reality:
- Guarded transitions exist but required stricter policy centralization and deterministic fallback mapping.
Target intent:
- Implement strict guarded-mode-only resolver, precedence ordering, bounded invalid-outcome fallback, and breadcrumb alignment.
Guardrail:
- No public API contract changes, no endpoint additions, and no UI changes.
Fallback/default posture:
- Single-step remains default baseline; guarded path remains internal-only and bounded.
Implementation status:
- Implemented in this slice (runtime + docs sync).
Manual verify:
- Confirm guarded transition policy emits explicit deterministic action (`continue_step`, `stop_terminal`, `fail_terminal`, `needs_review_terminal`).
- Confirm precedence ordering remains deterministic under conflicting/internal override conditions.
- Confirm unknown forced transition outcome deterministically maps to bounded fail-terminal behavior.
- Confirm transition decision breadcrumbs remain internal-only and include aligned action/terminal/policy metadata.
- Confirm no review semantics appear in public error code/message.

### Step 2 — Timeout/cancel resilience hardening
Current reality:
- Guarded transition policy hardening is active; timeout/cancel checkpoints required stricter resilience enforcement.
Target intent:
- Harden guarded-only timeout/cancel precedence checkpoints and continuation blocking under cancel/budget exhaustion.
Guardrail:
- No public API contract changes, no endpoint additions, no UI changes, and no public review semantics in error code/message.
Fallback/default posture:
- Timeout/cancel paths remain deterministic bounded fail terminals and guarded continuation is denied when checkpoint rules fail.
Implementation status:
- Implemented in this slice (runtime + docs sync).
Manual verify:
- Confirm deterministic checkpoint ordering in guarded mode: cancel precedence before budget checks.
- Confirm checkpoint coverage at `pre_step_start`, `post_step_response`, and `pre_continuation_handoff`.
- Confirm guarded continuation is blocked when cancel is asserted or execution budget is exhausted.
- Confirm timeout/cancel terminal mapping remains stable (`execution_timeout`, `execution_cancelled`) and public-safe.
- Confirm no review-semantic public error code/message leakage and no public contract/endpoint/UI expansion.

### Step 3 — Internal transition diagnostics polish
Current reality:
- Internal transition breadcrumbs are active with baseline policy alignment and timeout/cancel checkpoint coverage.
Target intent:
- Implement guarded-only internal telemetry schema baseline with deterministic event typing/detail normalization (internal-only).
Guardrail:
- No public observability exposure.
Fallback/default posture:
- If diagnostic enrichment fails, runtime behavior remains deterministic and contract-safe.
Implementation status:
- Implemented in this slice (runtime + docs sync).
Manual verify:
- Confirm guarded telemetry envelope includes `schemaVersion`, canonical event `type`, and deterministic whitelisted `detail`.
- Confirm guarded events align to schema: execution start/end, step start/end, resilience checkpoints, and transition decision.
- Confirm telemetry remains best-effort/non-fatal and internal-only (`REZ_RUNTIME_PRINT_BREADCRUMBS=1` prints internal stderr logs only).
- Confirm no `/api/chat` contract/endpoint/UI changes and no public review-semantic error exposure.

### Step 4 — Regression verification + DoD closeout + docs sync
Current reality:
- Phase 56 Step 1-3 implementation evidence is complete and validated against guardrails.
Target intent:
- Close phase with explicit PASS status after full regression verification and docs consistency cleanup.
Guardrail:
- No scope expansion beyond Phase 56 internal hardening boundaries.
Fallback/default posture:
- If evidence is partial, keep phase open and preserve current safe defaults.
Implementation status:
- Implemented in this slice (verification + docs closeout sync).
Manual verify:
- Confirm backend health and provider health surfaces are reachable/contract-safe.
- Confirm `/api/chat` success and failure contract remain unchanged (`ok/reply/meta` and `ok/error/meta`).
- Confirm guarded default deny remains single-step and explicit internal allow remains bounded (`maxSteps: 2` hard cap).
- Confirm deterministic terminal behavior for timeout/cancel/invalid transition outcomes.
- Confirm internal `needs_review` terminal remains mapped to public-safe bounded failure semantics.
- Confirm KB hybrid retrieval and lexical fallback both execute without contract drift.
- Confirm UI send/receive, refresh persistence, and KB append/manual rebuild flow work with no visual contract changes.
- Confirm no public task/state/review exposure and no endpoint expansion.

### Phase 59 — REZ-AI operator mode definition and UX surface clarity (implemented)
Current reality:
- REZ-AI copy surface had practical capability but first impression was still generic assistant-like in key UI regions.
Target intent:
- Clarify UX identity so users immediately understand operator-style flow (task breakdown, context-aware planning, local/private posture).
Guardrail:
- No runtime behavior changes, no provider/KB algorithm changes, and no `/api/chat` public contract changes.
Implementation status:
- Implemented in this slice (UI copy/surface clarity + docs sync).
Manual verify:
- Confirm welcome/header/composer/workflow text now reflects practical operator usage.
- Confirm preset labels/descriptions are operator-oriented while preset IDs/runtime wiring remain unchanged.
- Confirm UI layout remains stable (copy-level polish only).
- Confirm `/api/chat` request/response shape and endpoints remain unchanged.

### Phase 60 — Developer/project operator workflow surface (implemented)
Current reality:
- Operator identity clarity exists, but developer/project workflow routing still needed stronger explicit quick paths and recommended sequence guidance.
Target intent:
- Make developer/project operator workflows the default practical usage surface (feature planning, bug breakdown, next-step selection, checklist extraction, Cursor-ready prompt drafting, KB-assisted reasoning).
Guardrail:
- No runtime behavior changes, no provider/KB algorithm changes, and no `/api/chat` public contract changes.
Implementation status:
- Implemented in this slice (workflow copy/surface shaping + docs sync).
Manual verify:
- Confirm OPERATOR TOOLS includes explicit developer/project quick flows (`Feature plan`, `Bug breakdown`).
- Confirm workflow helper text presents concrete recommended sequence (`feature/bug -> next step -> checklist -> Cursor prompt`).
- Confirm welcome/preset/composer wording now emphasizes developer/project execution guidance.
- Confirm UI layout remains stable and `/api/chat` request/response shape remains unchanged.

### Phase 61 — Operator response structure for developer/project workflows (implemented)
Current reality:
- Operator workflow UI guidance exists, but assistant response shape was not consistently biased to operator-style structured outputs for developer/project asks.
Target intent:
- Prefer lightweight structured operator responses for developer/project requests without changing API contract or runtime architecture.
Guardrail:
- No runtime architecture expansion, no `/api/chat` schema changes, no provider/KB algorithm changes, no new APIs/endpoints.
Implementation status:
- Implemented in this slice (assistant guidance hardening + docs sync).
Manual verify:
- Confirm assistant system guidance now conditionally adds soft structure preference for developer/project intent classes.
- Confirm structured preference includes: `Goal`, `Context / assumptions`, `Step-by-step plan`, `Next step`, `Cursor prompt (if relevant)`, `Verification checklist`.
- Confirm Phase 60 workflow tools remain aligned (`Feature plan`, `Bug breakdown`, `Pick next step`, `Extract checklist`, `Create Cursor prompt`).
- Confirm `/api/chat` request/response shape and endpoint surface remain unchanged.

### Phase 62 — Operator output examples and workflow consistency audit (implemented)
Current reality:
- Phase 61 introduced soft structure guidance; consistency across intent classes required targeted verification.
Target intent:
- Validate operator response-structure behavior across representative developer/project prompts and apply only minimal safe tuning if needed.
Guardrail:
- Evaluation-first phase: no runtime architecture changes, no `/api/chat` schema changes, no provider/KB algorithm changes, no UI layout changes.
Implementation status:
- Implemented in this slice (audit + minimal precedence tuning + docs sync).
Manual verify:
- Probe 5-7 representative prompts (feature, bug, architecture, implementation, next-step, code-writing, generic non-dev).
- Confirm structure guidance appears for expected developer/project prompts and stays off for generic non-dev prompt.
- Confirm structure preference fields remain: `Goal`, `Context / assumptions`, `Step-by-step plan`, `Next step`, `Cursor prompt (if relevant)`, `Verification checklist`.
- Confirm next-step intents are not incorrectly bucketed into architecture when phrasing includes refactor terms.
- Confirm `/api/chat` request/response shape and endpoint surface remain unchanged.

### Phase 62.1 — Provider abstraction clarification in documentation (implemented)
Current reality:
- Provider status is documented, but wording can be read as tool-specific unless abstraction boundaries are explicit.
Target intent:
- Clarify that providers are inference runtimes, not hard-coupled tools, and keep deployment strategy alignment explicit (`local-first -> hosted/cloud option -> hybrid`).
Guardrail:
- Documentation clarification only; no runtime/provider/UI/API contract changes.
Implementation status:
- Implemented in this slice (docs wording clarification + consistency sync).
Manual verify:
- Confirm docs explicitly state current local runtimes (`lmstudio`, `ollama`) are interchangeable provider-layer implementations.
- Confirm docs explicitly state future hosted/cloud/hybrid runtimes should connect through the same provider abstraction.
- Confirm docs explicitly state `remote_openai` is a compatibility stub, not production cloud integration.
- Confirm `/api/chat` contract stability language remains unchanged.

### Phase 63 — Project brain usefulness audit (implemented)
Current reality:
- REZ-AI has operator workflow surfaces and KB plumbing, but project-brain usefulness needed evidence-based validation across KB/context probes.
Target intent:
- Measure practical project-brain value for developer/project workflows (planning, next-step guidance, implementation help, memory reuse) and apply only minimal safe tuning if clearly justified.
Guardrail:
- Audit-first phase; no runtime architecture/provider/deployment changes and no `/api/chat` contract changes.
Implementation status:
- Implemented in this slice (runtime/UI/docs audit + seven probes + minimal safe prompt-shaping tuning + docs sync).
Manual verify:
- Run 5-7 probes with KB ON/OFF and project-context asks; confirm KB context reaches runtime in KB ON and is absent in KB OFF.
- Confirm operator-structure guidance appears for project-brain asks (including phase-continuation and Cursor-prompt requests) and remains off for generic non-dev asks.
- Confirm provider regression checks pass and `/api/chat` response shape remains unchanged.
- Confirm no provider-layer or deployment-architecture behavior changes were introduced.

### Phase 64 — KB explainability surface (implemented)
Current reality:
- Assistant runtime already computes KB explainability signals (`mode`, hit counts, citations), but backend/UI surfaced only a narrow subset.
Target intent:
- Improve user-visible KB explainability using additive `meta.kb` pass-through and small UI clarity additions while keeping contract/runtime/provider/deployment stability.
Guardrail:
- No breaking `/api/chat` schema changes, no provider-layer changes, no deployment-architecture changes, no auth/billing/cloud rollout.
Implementation status:
- Implemented in this slice (safe backend pass-through + small UI explainability rows + docs sync).
Manual verify:
- Confirm `/api/chat` `meta.kb` still includes existing fields and now optionally includes additive explainability fields (`mode`, `sourceCount`, `influenced`, limited `citations`).
- Confirm UI shows clearer KB explainability (`KB influenced answer`, `Last retrieval mode`, `Last source refs`) and still works if fields are absent.
- Confirm no sensitive internals are exposed (no vectors/scores/raw context blocks in public payload).
- Confirm provider regression checks and existing contract shape remain stable.

### Phase 65 — KB relevance tightening (implemented)
Current reality:
- KB retrieval was always attempted when `useKB=true`, so generic/non-project prompts could still pull noisy KB chunks.
Target intent:
- Tighten KB relevance so project/dev prompts keep KB assistance while generic prompts avoid unnecessary retrieval noise.
Guardrail:
- No `/api/chat` breaking schema changes, no provider/inference runtime changes, no deployment architecture changes, no new APIs.
Implementation status:
- Implemented in this slice (deterministic retrieval gating heuristics + verification probes + docs sync).
Manual verify:
- Confirm project/dev prompts (`project`, `phase`, `code`, `architecture`, `bug`, `feature`, `implementation`, `REZ-AI`) still retrieve KB context normally.
- Confirm generic prompts (greetings/simple math/open-domain generic asks) skip KB retrieval (`topK:0`, `hits:0`, `influenced:false`).
- Confirm Phase 64 explainability fields remain stable and safe (`mode`, `sourceCount`, `influenced`, limited citations).
- Confirm `/api/chat` contract remains backward-compatible and provider regression checks still pass.

### Phase 66 — KB relevance calibration (implemented)
Current reality:
- Phase 65 reduced generic KB noise but had narrow project/dev coverage risk for borderline prompts.
Target intent:
- Calibrate heuristic signal coverage to reduce false negatives for project-like prompts while preserving generic skip safety.
Guardrail:
- Keep heuristic model simple/deterministic; no provider/runtime architecture changes; no `/api/chat` breaking changes; no new endpoints.
Implementation status:
- Implemented in this slice (small signal-regex calibration + prompt-matrix verification + docs sync).
Manual verify:
- Confirm class A (definite project/dev) prompts still retrieve.
- Confirm class B (definite generic) prompts still skip.
- Confirm class C (borderline project-like: regression/migration/failing tests/refactor/worker) now retrieves.
- Confirm class D (generic technical non-project) still skips.
- Confirm `/api/chat` contract and `meta.kb` backward compatibility remain unchanged.

---

# ⚠ TECHNICAL DEBT TRACKER

Current Known Issues:
- Approx token counter
- KB semantic retrieval currently uses deterministic local vectors (heuristic), not provider embedding APIs.
- KB refresh workflow is manual (`/api/kb/append` then `npm run kb:build`); no auto-rebuild trigger.

---

# 📈 LONG TERM VISION

REZ-AI becomes:

- AI Workspace
- AI Dev Assistant
- Knowledge Brain
- Automation Layer
- Optional Cloud AI

Modular architecture.
Local-first.
Business-ready later.

---

# 🎯 CURRENT NEXT STEP

→ Define the next narrow KB/project-brain trust slice for retrieval confidence scoring and low-risk relevance telemetry.

---

# 🧩 EXECUTION PLAN (Step-by-step)

This section is the operational checklist. Each step should be completed with:
- code change
- manual test
- short note in docs/REZ_AI_UI_PROGRESS.md

---

## ✅ Milestone M0 — Baseline Confirmed (Already Done)
Status: DONE

Checklist:
- UI running (5173/5174)
- Backend running (3001)
- LM Studio running (1234)
- /health returns ok
- Multi-chat works
- Per-chat system prompt works
- Timeout + retry works
- Markdown-lite render works
- LocalStorage persistence works

---

## 🚧 Milestone M1 — KB/RAG v1 (Keyword + Build Pipeline)
Goal: "Use KB" becomes REAL.

### M1.1 Create KB source folder
- Ensure folder exists: data/kb/
- Add at least 3 test KB files:
  - data/kb/intro.md
  - data/kb/faq.md
  - data/kb/notes.txt

Acceptance:
- Files are readable and included in build.

### M1.2 Build Script
Create: scripts/kb_build.js

Does:
- reads data/kb/**/*.{md,txt}
- chunks (700 chars, overlap 120)
- writes data/cache/kb.json (versioned)

Command:
- npm run kb:build

Acceptance:
- Build prints number of files + chunks
- data/cache/kb.json created

### M1.3 Wiring: UI → Backend → Assistant
UI:
- POST body includes { useKB }

Backend:
- passes env REZ_USE_KB "1"/"0"

Assistant:
- loads KB and injects context ONLY when REZ_USE_KB=1

Acceptance:
- With Use KB ON: answers clearly use KB text
- With Use KB OFF: answers do not include KB context

### M1.4 KB Retrieval Quality (Minimal)
- top-k default 4
- limit context size (max ~2500 chars)
- include source names

Acceptance:
- Debug log shows chosen KB chunks
- No huge RAM spikes

---

## 🚧 Milestone M2 — Backend Hardening (Stability P0)
Goal: No stuck requests, safe contracts, safer resource usage.

### M2.1 Child Kill Timeout + Abort Handling
Backend:
- kill assistant after 25s
- kill on req close/abort

Acceptance:
- Hanging LM Studio does not freeze server
- No zombie child processes

### M2.2 Concurrency Limit (Queue)
Backend:
- maxActiveRequests = 2
- if over limit → 429 { ok:false, error:"busy" }

Acceptance:
- spam sends do not crash backend
- UI shows graceful error message

### M2.3 JSON Output Contract (No brittle stdout)
Assistant:
- add flag --print-json → outputs ONLY JSON to stdout:
  { ok, reply, model, usage?, latencyMs }

Backend:
- parses JSON only
- returns { ok, reply, model, usage, latencyMs, error? }

UI:
- uses reply directly (parser can remain as fallback)

Acceptance:
- No "Saved/Model/---" cleanup needed
- API response is stable

### M2.4 Real LM Studio Health Endpoint
Backend:
- GET /health/lm checks LM Studio reachable:
  - call /v1/models (or lightweight endpoint)
- returns { ok:true, models:[...], activeModel?:... }

UI:
- status pill reflects REAL state:
  - Connected / Disconnected

Acceptance:
- stopping LM Studio changes UI status within 5–10s (manual refresh ok for v1)

---

## 🚧 Milestone M3 — Telemetry (Real Stats)
Goal: Real measurements.

Backend:
- measure latencyMs per request
- include response usage if provided by LM Studio

UI:
- show latencyMs
- show real tokens if usage exists, fallback to approx

Acceptance:
- user can see latency + tokens reliably

---

## 🚧 Milestone M4 — UX Improvements
Goal: Product-level chat experience.

- Chat rename
- Chat delete
- Reorder chats
- Better markdown (optional library later)
- Export chat as markdown
- Import chat JSON

Acceptance:
- chats manageable without localStorage resets

---

## 🚧 Milestone M5 — Presets & Workflows (Free Power)
Goal: Make REZ-AI "project brain".

- Preset selector (Khronika / PlayNexa / General)
- Per-preset system prompt template
- Task mode: "Plan" → "Do 1 step" loop
- Lightweight repo search (safe read-only)

Acceptance:
- faster dev workflows + repeatable outputs

---

# 🗂 FILE MAP (Key Components)

Backend:
- server.js

Assistant:
- apps/assistant/rez-ai.js

UI:
- apps/ui/src/App.jsx
- apps/ui/src/App.css

Data:
- data/kb/ (source docs)
- data/cache/kb.json (index)
- data/cache/last_answer.txt
- data/cache/last_response.json

Scripts:
- scripts/kb_build.js

Docs:
- docs/REZ_AI_MASTER_PLAN.md (this file)
- docs/REZ_AI_UI_PROGRESS.md (progress log)

---

# 🧪 MANUAL TEST SCRIPTS (Quick)
1) Backend:
- open http://localhost:3001/health

2) UI:
- send message, verify reply, copy, markdown block

3) Multi-chat:
- New chat, different prompt, verify separation

4) Use KB:
- ON: ask KB question
- OFF: ask same question

5) Timeout:
- stop LM Studio, send message → expect timeout toast

---

# 🏷 RELEASE TAGS (Local)
- v0.1: UI chat + backend + assistant working
- v0.2: multi-chat + per-chat prompt
- v0.3: KB v1 (keyword) + build pipeline
- v0.4: backend hardening + JSON contract
- v0.5: telemetry + health/lm + status UI

---

# 🧯 SCOPE RULES (Guardrails)

These rules prevent scope creep and keep progress fast.

## Scope Principles
- Prefer simple, stable solutions first.
- Keep features modular (UI / Backend / Assistant / Scripts).
- Avoid adding dependencies unless they remove real complexity.
- Every new feature must include:
  - manual test steps
  - minimal docs note

## Non-Goals (For Now)
- No public deployment (cloud) until local system is stable.
- No paid features / auth / billing in Free phase.
- No arbitrary file write/execute tools (security risk) until later.
- No full Markdown spec-compliance yet (lite renderer is enough).
- No multi-user support yet.

## Security Baseline (Local phase)
- Treat all inputs as untrusted.
- Keep assistant in read-only mode (no system commands).
- Do not expose stack traces to UI in production later.

---

# ✅ DEFINITION OF DONE (DoD)

A milestone is "DONE" only if:
- Feature works in UI
- Backend returns stable output
- No critical console errors
- Manual test checklist passes
- docs/REZ_AI_UI_PROGRESS.md updated (short note)

## DoD Examples
- KB v1 DONE when:
  - npm run kb:build generates kb.json
  - Use KB toggle changes behavior in answers
  - KB context size is capped
  - no freezes/timeouts in normal use

- Backend hardening DONE when:
  - stuck LM Studio doesn't hang server
  - child processes are killed on timeout/abort
  - concurrency limit prevents overload
  - JSON contract replaces brittle stdout parsing

---

# 🛠 TROUBLESHOOTING PLAYBOOK (Fast Fix)

## 1) UI works but no replies
Check:
- Backend running?
  - http://localhost:3001/health → { ok:true }
- Network tab: /api/chat status (200/500/pending)
- Backend terminal: errors?

Fix:
- Start backend from repo root:
  - cd C:\Projects\rez-ai
  - node server.js

## 2) Backend ok but LM Studio not responding
Check:
- LM Studio server enabled?
- Endpoint reachable:
  - http://127.0.0.1:1234/v1/models (if supported)
Fix:
- Restart LM Studio server
- Reload model

## 3) Requests hang / delayed replies
Likely:
- no kill timeout / LM slow
Fix:
- Ensure backend kill-timeout milestone M2.1 implemented
- UI timeout is not enough alone

## 4) Use KB ON but no KB effect
Check:
- Was kb index built?
  - data/cache/kb.json exists
- Backend passes REZ_USE_KB
- Assistant reads REZ_USE_KB

Fix:
- npm run kb:build
- restart backend

## 5) LocalStorage weirdness (missing chats)
Check:
- localStorage key rez-ai-chats-v1
Fix:
- export chats, then clear key manually if needed

---

# ⚠ RISK REGISTER

This section tracks known architectural and future risks.

---

## R1 — Child Process Overload
Risk:
- Each /api/chat spawns new Node process.
- High concurrency may cause CPU pressure.

Impact:
- Server freeze
- Zombie processes

Mitigation:
- Implement kill timeout (M2.1)
- Add concurrency limit (M2.2)

---

## R2 — LM Studio Dependency
Risk:
- System fully depends on LM Studio availability.

Impact:
- No fallback if LM fails.
- User confusion (UI says Connected but backend not).

Mitigation:
- Add /health/lm endpoint
- Reflect real status in UI

---

## R3 — Brittle Stdout Parsing
Risk:
- Text-based parsing breaks if assistant output changes.

Impact:
- UI misreads responses.

Mitigation:
- Implement strict JSON contract (--print-json)

---

## R4 — KB Scale Performance
Risk:
- KB grows large.
- Retrieval becomes slow.

Impact:
- Increased latency.
- Memory usage spike.

Mitigation:
- Build pipeline separate from runtime
- Later move to embeddings + vector search

---

## R5 — Security Exposure (Future Cloud Phase)
Risk:
- CORS open
- No auth
- No rate limiting

Impact:
- Abuse, cost explosion

Mitigation:
- Lock CORS by origin
- Add rate limit
- Add auth layer before public deployment

---

## R6 — Token Miscalculation
Risk:
- Approx token counter inaccurate.

Impact:
- Wrong user expectations in business phase.

Mitigation:
- Capture real usage from LM Studio
- Fallback only if missing

---

## R7 — Memory Growth
Risk:
- Large stdout/stderr accumulation.

Impact:
- RAM spikes.

Mitigation:
- Enforce max output size
- Move to JSON-only contract

---

# 🧠 ARCHITECTURE DECISION LOG

This log records why major decisions were made.

---

## ADR-001 — Local-First Strategy

Decision:
Build REZ-AI as Local-first system before cloud deployment.

Reason:
- Zero GPU cost
- Faster iteration
- No billing complexity
- No abuse risk

Tradeoff:
- Not publicly accessible yet.

Future:
Cloud layer will be added only after stability.

---

## ADR-002 — Spawn Assistant as Child Process

Decision:
server.js spawns rez-ai.js instead of direct LM call.

Reason:
- Separation of concerns
- Assistant layer reusable independently
- Safer environment isolation

Tradeoff:
- Process overhead per request.

Future:
May refactor into module import for performance.

---

## ADR-003 — Per-Chat System Prompt

Decision:
Each chat stores its own systemPrompt.

Reason:
- Context isolation
- Project-specific behavior
- Future preset support

Tradeoff:
- Slightly larger localStorage footprint.

---

## ADR-004 — KB Injected as System Context

Decision:
KB retrieval appended to system prompt instead of user message.

Reason:
- Keeps user message clean
- Clear separation of knowledge vs question

Tradeoff:
- Larger system prompt size.

Future:
Will migrate to structured RAG prompt template.

---

## ADR-005 — AbortController on UI Side

Decision:
UI enforces 15s timeout.

Reason:
- Prevent infinite wait
- Better UX

Tradeoff:
- Backend may still run unless killed server-side.

Future:
Add backend kill-timeout (M2.1).

---

## ADR-006 — JSON Contract (Planned)

Decision:
Assistant will move to strict JSON output.

Reason:
- Stability
- Remove brittle cleanup logic
- Clear API boundary

Status:
Planned in M2 milestone.

---

# 🎯 STRATEGIC DIRECTION

## Official Project Direction
REZ-AI is defined as:

> Modular AI Platform (Local-first foundation → Future Cloud product)

This means:

- Not just a personal assistant
- Not only a developer tool
- But a modular AI system that can evolve into a product ecosystem

---

## Phase Strategy Model

Phase 1 — Local Foundation
- Single-user
- LM Studio based
- KB + RAG
- Stable backend contract
- Modular architecture

Phase 2 — Power Tools
- Presets
- Workflows
- Structured project memory
- Better markdown + export
- Telemetry & optimization

Phase 3 — Productization Layer
- Auth
- Rate limit
- Token tracking (real)
- Billing logic
- Cloud model hosting

Phase 4 — Platform Mode
- Plugin system
- Modular features (KB module, Dev module, Automation module)
- Multi-user support
- Cloud + local hybrid mode

---

## Core Architectural Principle

REZ-AI must always:

- Keep modules loosely coupled
- Keep UI / Backend / Assistant separable
- Maintain JSON contract boundaries
- Avoid hard dependencies between modules

---

## Identity Statement

REZ-AI is:

A modular, extensible AI operating layer
starting local-first,
designed to evolve into a scalable AI platform.
