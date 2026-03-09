"use strict";

const DEFAULTS = {
  port: 3001,
  requestBodyLimit: "64kb",
  maxMessageChars: 8000,
  lmstudioBaseUrl: "http://127.0.0.1:1234/v1",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  supabaseUrl: "",
  supabaseAnonKey: "",
};

const parseCsv = (value) =>
  String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const parseFeatureFlags = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return { flags: {} };
  const flags = {};
  const tokens = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  for (const token of tokens) {
    if (!token) continue;
    if (token.startsWith("!")) {
      const name = token.slice(1).trim();
      if (name) flags[name] = false;
      continue;
    }
    const eqIdx = token.indexOf("=");
    if (eqIdx >= 0) {
      const name = token.slice(0, eqIdx).trim();
      const valRaw = token.slice(eqIdx + 1).trim().toLowerCase();
      if (!name) continue;
      flags[name] = ["1", "true", "yes", "on"].includes(valRaw);
      continue;
    }
    flags[token] = true;
  }
  return { flags };
};

const parsePositiveInt = (value, { key, fallback }) => {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(String(value).trim())) {
    throw new Error(`${key} must be a positive integer (got "${value}")`);
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${key} must be > 0 (got "${value}")`);
  }
  return parsed;
};

const parseBodyLimit = (value, { key, fallback }) => {
  if (!value) return fallback;
  const normalized = String(value).trim().toLowerCase();
  // Accept formats supported by Express/body-parser bytes parser.
  if (!/^\d+\s*(b|kb|mb|gb)?$/.test(normalized)) {
    throw new Error(`${key} must look like "64kb" or "1mb" (got "${value}")`);
  }
  return normalized.replace(/\s+/g, "");
};

const parseUrl = (value, { key, fallback }) => {
  const raw = String(value || fallback).trim();
  if (!raw) return fallback;
  try {
    // Validate URL shape, keep original value for behavior parity.
    // eslint-disable-next-line no-new
    new URL(raw);
    return raw;
  } catch {
    throw new Error(`${key} must be a valid URL (got "${value}")`);
  }
};

const loadBackendConfig = (env = process.env) => ({
  PORT: parsePositiveInt(env.REZ_BACKEND_PORT, {
    key: "REZ_BACKEND_PORT",
    fallback: DEFAULTS.port,
  }),
  REQUEST_BODY_LIMIT: parseBodyLimit(env.REZ_REQUEST_BODY_LIMIT, {
    key: "REZ_REQUEST_BODY_LIMIT",
    fallback: DEFAULTS.requestBodyLimit,
  }),
  MAX_MESSAGE_CHARS: parsePositiveInt(env.REZ_MAX_MESSAGE_CHARS, {
    key: "REZ_MAX_MESSAGE_CHARS",
    fallback: DEFAULTS.maxMessageChars,
  }),
  CORS_ALLOWLIST: parseCsv(env.REZ_CORS_ALLOWLIST || env.CORS_ALLOWLIST || ""),
  LMSTUDIO_BASE_URL: parseUrl(
    env.REZ_PROVIDER_LMSTUDIO_BASE_URL || env.REZ_LMSTUDIO_BASE || env.LMSTUDIO_BASE,
    { key: "REZ_PROVIDER_LMSTUDIO_BASE_URL", fallback: DEFAULTS.lmstudioBaseUrl }
  ),
  OLLAMA_BASE_URL: parseUrl(
    env.REZ_PROVIDER_OLLAMA_BASE_URL || env.REZ_OLLAMA_BASE || env.OLLAMA_BASE,
    { key: "REZ_PROVIDER_OLLAMA_BASE_URL", fallback: DEFAULTS.ollamaBaseUrl }
  ),
  FEATURE_FLAGS: parseFeatureFlags(env.REZ_FEATURE_FLAGS),
  SUPABASE_URL: String(env.SUPABASE_URL || DEFAULTS.supabaseUrl).trim(),
  SUPABASE_ANON_KEY: String(env.SUPABASE_ANON_KEY || DEFAULTS.supabaseAnonKey).trim(),
});

module.exports = {
  DEFAULTS,
  loadBackendConfig,
};
