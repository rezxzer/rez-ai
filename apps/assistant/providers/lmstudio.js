"use strict";

function toErrorPayload(error, code = "provider_failed") {
    return {
        ok: false,
        error: error?.code || code,
        message: error?.message || "Provider request failed",
    };
}

async function chat({ model, messages, temperature, max_tokens, baseUrl }) {
    const safeBase = (baseUrl || "http://127.0.0.1:1234/v1").replace(/\/$/, "");
    const url = `${safeBase}/chat/completions`;
    const payload = {
        model,
        messages: Array.isArray(messages) ? messages : [],
        temperature,
        max_tokens,
    };

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Accept-Charset": "utf-8",
            },
            body: JSON.stringify(payload),
        });

        const ab = await res.arrayBuffer();
        const raw = new TextDecoder("utf-8").decode(new Uint8Array(ab));

        if (!res.ok) {
            const e = new Error(`HTTP ${res.status}: ${raw}`);
            e.code = "lm_http_error";
            return toErrorPayload(e, "lm_http_error");
        }

        let out;
        try {
            out = JSON.parse(raw);
        } catch {
            const e = new Error(`Bad JSON: ${raw.slice(0, 200)}`);
            e.code = "lm_bad_json";
            return toErrorPayload(e, "lm_bad_json");
        }

        const reply = out?.choices?.[0]?.message?.content ?? "";
        return {
            ok: true,
            reply: typeof reply === "string" ? reply : String(reply ?? ""),
            model: out?.model_instance_id || out?.model || model || null,
            usage: out?.usage || null,
            raw: out,
        };
    } catch (e) {
        return toErrorPayload(e, "lm_request_failed");
    }
}

module.exports = { chat };
