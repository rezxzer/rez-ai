# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

REZ-AI is a local AI coding assistant with an Express backend (`server.js`, port 3001) and a React/Vite frontend (`apps/ui`, port 5173). See `README.md` for full environment variable reference.

### Running services

- **Backend**: `npm run backend` (Express on port 3001)
- **UI**: `npm run ui` (Vite dev server on port 5173)

Both require `.env` (root) and `apps/ui/.env.local` to exist. Copy from `.env.example` / `apps/ui/.env.example` if missing.

### Lint / Build / Test

- **Lint**: `cd apps/ui && npx eslint .` — there is one pre-existing `no-empty` error in `src/lib/persist.js` plus 4 react-hooks warnings; these are in the existing codebase.
- **Build**: `cd apps/ui && npx vite build`
- No automated test suite exists in this repo.

### Caveats

- The chat feature (`POST /api/chat`) requires a running LLM provider (LM Studio or Ollama) on the local network. In cloud environments without an LLM provider, the backend starts fine and all non-chat endpoints work, but chat requests will return `"fetch failed"`. This is expected.
- The root package and `apps/ui` have independent `node_modules`; both require separate `npm install`.
- The backend uses CommonJS (`require`); the UI uses ESM (`import`). No TypeScript.
- Supabase is optional — the backend handles `null` Supabase client gracefully.
