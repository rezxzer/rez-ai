"use strict";

const CHAT_URL = "http://127.0.0.1:3001/api/chat";

async function postChat(payload) {
  try {
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { transportOk: true, status: res.status, data };
  } catch (error) {
    return { transportOk: false, status: null, data: null, error };
  }
}

function printResult(name, pass, detail = "") {
  const suffix = detail ? ` (${detail})` : "";
  console.log(`${name}: ${pass ? "PASS" : "FAIL"}${suffix}`);
}

async function run() {
  let allPass = true;

  const lmstudio = await postChat({
    message: "phase57.1 provider regression lmstudio check",
    provider: "lmstudio",
    model: "fake-local-model",
  });
  const lmstudioPass = Boolean(
    lmstudio.transportOk
      && lmstudio.data
      && lmstudio.data.ok === true
      && typeof lmstudio.data.reply === "string"
  );
  allPass = allPass && lmstudioPass;
  printResult(
    "LMSTUDIO",
    lmstudioPass,
    lmstudioPass ? "" : (lmstudio.error?.message || `status=${lmstudio.status}`)
  );

  const remoteOpenai = await postChat({
    message: "phase57.1 provider regression remote_openai stub check",
    provider: "remote_openai",
    model: "gpt-4o-mini",
  });
  const remoteOpenaiPass = Boolean(
    remoteOpenai.transportOk
      && remoteOpenai.data
      && remoteOpenai.data.ok === false
      && String(remoteOpenai.data?.error?.code || "") === "provider_not_implemented"
  );
  allPass = allPass && remoteOpenaiPass;
  printResult(
    "REMOTE_OPENAI_STUB",
    remoteOpenaiPass,
    remoteOpenaiPass ? "" : (remoteOpenai.error?.message || `status=${remoteOpenai.status}`)
  );

  const unknownProvider = await postChat({
    message: "phase57.1 provider regression unknown fallback check",
    provider: "unknown_provider",
    model: "fake-local-model",
  });
  const unknownProviderPass = Boolean(
    unknownProvider.transportOk
      && unknownProvider.data
      && unknownProvider.data.ok === true
      && typeof unknownProvider.data.reply === "string"
  );
  allPass = allPass && unknownProviderPass;
  printResult(
    "UNKNOWN_PROVIDER_FALLBACK",
    unknownProviderPass,
    unknownProviderPass ? "" : (unknownProvider.error?.message || `status=${unknownProvider.status}`)
  );

  if (!allPass) {
    process.exitCode = 1;
  }
}

run();
