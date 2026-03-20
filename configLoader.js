"use strict";

const fs = require("fs");
const path = require("path");

function loadIsoTesterConfig() {
  const configPath = path.join(__dirname, "isotester-config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error("Missing isotester-config.json");
  }

  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw);
}

module.exports = {
  loadIsoTesterConfig
};