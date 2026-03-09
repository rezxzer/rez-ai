const fs = require("fs");
const path = require("path");

const KB_DIR = path.join(process.cwd(), "data", "kb");
const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const OUT_FILE = path.join(CACHE_DIR, "kb.json");
const OUT_VECTORS_FILE = path.join(CACHE_DIR, "kb_vectors.json");

const CHUNK_TARGET = 700;
const CHUNK_OVERLAP = 120;
const EXT_OK = new Set([".md", ".txt"]);
const VECTOR_DIM = 64;
const EMBED_PROVIDER = process.env.REZ_EMBED_PROVIDER || "lmstudio";
const EMBED_MODEL = process.env.REZ_EMBED_MODEL || "local-placeholder-embedding";

function walkFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    const list = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of list) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
            out.push(...walkFiles(full));
            continue;
        }
        const ext = path.extname(item.name).toLowerCase();
        if (EXT_OK.has(ext)) out.push(full);
    }
    return out;
}

function chunkText(text, target = CHUNK_TARGET, overlap = CHUNK_OVERLAP) {
    const clean = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!clean) return [];
    const chunks = [];
    let start = 0;
    while (start < clean.length) {
        const end = Math.min(start + target, clean.length);
        const chunk = clean.slice(start, end).trim();
        if (chunk) chunks.push(chunk);
        if (end >= clean.length) break;
        start = Math.max(0, end - overlap);
    }
    return chunks;
}

function makeDeterministicVector(text, dim = VECTOR_DIM) {
    const vec = new Array(dim).fill(0);
    const src = String(text || "");
    if (!src) return vec;

    for (let i = 0; i < src.length; i++) {
        const code = src.charCodeAt(i);
        const idx = (code + i) % dim;
        vec[idx] += 1;
    }

    const norm = Math.sqrt(vec.reduce((acc, v) => acc + (v * v), 0)) || 1;
    for (let i = 0; i < vec.length; i++) {
        vec[i] = Number((vec[i] / norm).toFixed(6));
    }
    return vec;
}

function main() {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const files = walkFiles(KB_DIR);

    let counter = 1;
    const items = [];

    for (const abs of files) {
        const rel = path.relative(process.cwd(), abs).replace(/\\/g, "/");
        const raw = fs.readFileSync(abs, "utf8");
        const chunks = chunkText(raw);
        for (const chunk of chunks) {
            items.push({
                id: `kb_${String(counter).padStart(4, "0")}`,
                source: rel,
                chunk,
                tokensApprox: Math.ceil(chunk.length / 4),
            });
            counter += 1;
        }
    }

    const payload = {
        version: 1,
        builtAt: new Date().toISOString(),
        items,
    };

    const vectorPayload = {
        version: 2,
        builtAt: payload.builtAt,
        embed: {
            provider: EMBED_PROVIDER,
            model: EMBED_MODEL,
            dim: VECTOR_DIM,
        },
        items: items.map((item) => ({
            id: item.id,
            source: item.source,
            chunk: item.chunk,
            tokensApprox: item.tokensApprox,
            vector: makeDeterministicVector(item.chunk, VECTOR_DIM),
        })),
    };

    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
    fs.writeFileSync(OUT_VECTORS_FILE, JSON.stringify(vectorPayload, null, 2), "utf8");
    console.log(`filesCount: ${files.length}`);
    console.log(`chunksCount: ${items.length}`);
    console.log(`embeddingsCount: ${vectorPayload.items.length}`);
    console.log(`kbJsonPath: ${path.relative(process.cwd(), OUT_FILE).replace(/\\/g, "/")}`);
    console.log(`kbVectorsPath: ${path.relative(process.cwd(), OUT_VECTORS_FILE).replace(/\\/g, "/")}`);
}

main();