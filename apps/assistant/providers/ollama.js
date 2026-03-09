"use strict";

async function chat({ model, messages, baseUrl }) {
    const safeBaseUrl = (
        baseUrl
        || process.env.REZ_PROVIDER_OLLAMA_BASE_URL
        || process.env.REZ_OLLAMA_BASE
        || process.env.OLLAMA_BASE
        || "http://127.0.0.1:11434"
    ).replace(/\/$/, "");
    const modelName = model || process.env.OLLAMA_MODEL || "llama3.2:latest";
    const url = `${safeBaseUrl}/api/chat`;

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=utf-8",
            },
            body: JSON.stringify({
                model: modelName,
                messages: Array.isArray(messages) ? messages : [],
                stream: false,
            }),
        });

        const rawText = await res.text();
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${rawText}`);
        }

        let out = {};
        try {
            out = rawText ? JSON.parse(rawText) : {};
        } catch {
            throw new Error(`Bad JSON from Ollama: ${rawText.slice(0, 200)}`);
        }

        const reply = out?.message?.content || "";
        return {
            ok: true,
            reply: typeof reply === "string" ? reply : String(reply ?? ""),
            model: out?.model || modelName,
            usage: null,
            raw: out,
        };
    } catch (err) {
        return {
            ok: false,
            error: "ollama_failed",
            message: err?.message || "Ollama request failed",
        };
    }
}

module.exports = { chat };
