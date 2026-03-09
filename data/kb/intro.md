# REZ-AI Intro

- REZ-AI is a local-first AI assistant platform.
- The UI runs in `apps/ui` and talks to backend `/api/chat`.
- The backend spawns `apps/assistant/rez-ai.js` per request.
- LM Studio is used via OpenAI-compatible `/v1/chat/completions`.
- Chats are persisted locally in browser localStorage.
- Each chat can have its own system prompt.
- REZ-AI supports optional KB context injection.
- Project goal is stability first, then platform growth.
