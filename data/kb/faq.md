# REZ-AI FAQ

Q: Where is backend health endpoint?  
A: `GET http://localhost:3001/health`

Q: Where is LM Studio base URL configured?  
A: `LMSTUDIO_BASE` env or default `http://127.0.0.1:1234/v1`.

Q: How is system prompt passed?  
A: UI sends `systemPrompt`, backend forwards via `REZ_SYSTEM_PROMPT`.

Q: How does KB toggle work?  
A: UI sends `useKB`; backend maps it to `REZ_USE_KB`.

Q: Where are assistant outputs cached?  
A: `data/cache/last_answer.txt` and `data/cache/last_response.json`.
