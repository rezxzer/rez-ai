# REZ-AI (Local)

Local AI assistant running on your PC (LM Studio / local LLM).
Focus: coding help + project knowledge (RAG) + safe automation later.

## Run locally

1. Install dependencies
   - `npm install`
   - `cd apps/ui && npm install`
2. Create env files from examples
   - root: copy `.env.example` -> `.env`
   - UI: copy `apps/ui/.env.example` -> `apps/ui/.env.local`
3. Start backend
   - `npm run backend`
4. Start UI
   - `npm run ui`

Backend: `http://localhost:3001`  
UI: `http://localhost:5173`

## Environment

### Backend (`.env`)
- `REZ_BACKEND_PORT` backend port (default: `3001`)
- `REZ_REQUEST_BODY_LIMIT` JSON payload limit (default: `64kb`)
- `REZ_MAX_MESSAGE_CHARS` max chars for one chat request (`/api/chat`, default: `8000`)
- `REZ_CORS_ALLOWLIST` comma-separated origins (default: empty = allow all)
- `REZ_PROVIDER_LMSTUDIO_BASE_URL` LM Studio base URL (default: `http://127.0.0.1:1234/v1`)
- `REZ_PROVIDER_OLLAMA_BASE_URL` Ollama base URL (default: `http://127.0.0.1:11434`)
- `REZ_PROVIDER`, `REZ_MODEL`, `LMSTUDIO_MODEL`, `OLLAMA_MODEL` provider/model defaults
- `REZ_FEATURE_FLAGS` optional comma-separated local feature toggles (e.g. `flag_a,flag_b=false,!legacy_mode`)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` optional auth scaffold keys for `GET /api/auth/me`

### UI (`apps/ui/.env.local`)
- `VITE_BACKEND_BASE_URL` backend base URL used by UI
- `VITE_MAX_MESSAGE_CHARS` UI input max length (must match backend)
- `VITE_REQUEST_TIMEOUT_MS` fetch timeout for chat request

## Structure
- apps/          runnable assistant + tools
- docs/          documentation
- prompts/       system prompts + templates
- scripts/       helper scripts
- data/kb/       knowledge base inputs
- data/cache/    local caches (ignored)
- configs/local/ local config + secrets (ignored)
- models/        local model files (optional)