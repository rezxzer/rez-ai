// scripts/test_lmstudio_rest.js
// Quick test for LM Studio REST API v1 (server running on http://127.0.0.1:1234)

const BASE = "http://127.0.0.1:1234/api/v1";
const MODEL = "qwen2.5-coder-14b-instruct";

async function main() {
    // 1) Check server models endpoint
    const modelsRes = await fetch(`${BASE}/models`);
    if (!modelsRes.ok) {
        throw new Error(`models failed: ${modelsRes.status} ${await modelsRes.text()}`);
    }
    const modelsJson = await modelsRes.json();
    console.log("✅ /models ok");
    console.log("models keys:", Object.keys(modelsJson));

    // 2) Chat request (REST API v1 uses `input`, not `messages`)
    const chatRes = await fetch(`${BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: MODEL,
            system_prompt: "You are REZ-AI, a helpful coding assistant.",
            input: "Say hello in Georgian in one short sentence.",
            temperature: 0.2,
            max_output_tokens: 80
        })
    });

    if (!chatRes.ok) {
        throw new Error(`chat failed: ${chatRes.status} ${await chatRes.text()}`);
    }

    const chatJson = await chatRes.json();
    console.log("✅ /chat ok");
    console.log(JSON.stringify(chatJson, null, 2));
}

main().catch((e) => {
    console.error("❌ Test failed:", e.message);
    process.exit(1);
});