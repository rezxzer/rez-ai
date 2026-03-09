"use strict";

const lmstudio = require("./lmstudio");
const ollama = require("./ollama");
const remoteOpenai = require("./remote_openai");

function getProvider(name) {
    const key = (name || "lmstudio").toString().trim().toLowerCase();
    if (key === "ollama") return ollama;
    if (key === "remote_openai" || key === "openai") return remoteOpenai;
    return lmstudio;
}

module.exports = { getProvider };
