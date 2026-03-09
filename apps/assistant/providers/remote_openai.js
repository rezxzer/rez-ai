"use strict";

async function chat() {
    return {
        ok: false,
        error: "provider_not_implemented",
        message: "Remote OpenAI provider is not implemented yet.",
    };
}

module.exports = { chat };
