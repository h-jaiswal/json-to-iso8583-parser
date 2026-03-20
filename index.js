"use strict";

const net = require("net");
const fs = require("fs");
const path = require("path");
const {
  buildIso8583Binary,
  addLengthHeader,
  stripHeaders,
  parseIso8583Binary
} = require("./iso8583BinaryBuilder");
const { loadIsoTesterConfig } = require("./configLoader");

const cfg = loadIsoTesterConfig();

// Timestamp helper
function ts() {
  return new Date().toISOString();
}

// Load ISO8583 request payload
const payloadPath = path.join(__dirname, "requestPayloadIsoJson.json");
if (!fs.existsSync(payloadPath)) {
  throw new Error("Missing requestPayloadIsoJson.json");
}
const isoMessage = JSON.parse(fs.readFileSync(payloadPath, "utf8"));

const isoPayload = buildIso8583Binary(isoMessage);
const finalPayload = addLengthHeader(isoPayload);

// Ensure log folder exists
const logDir = path.join(__dirname, "log");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Build unique ID from Field 11 + Field 12
const uniqueId = `${isoMessage["11"] || "NA"}_${isoMessage["12"] || "NA"}`;

// Log file path based on Field 11
const logFileName = `${isoMessage["11"]}.log`;
const logFilePath = path.join(logDir, logFileName);

// Append logs with timestamp and unique ID
function appendLog(section, content) {
  fs.appendFileSync(
    logFilePath,
    `\n[${ts()}] [${uniqueId}] === ${section} ===\n${content}\n`
  );
}

// Log request
appendLog("REQUEST - JSON", JSON.stringify(isoMessage, null, 2));
appendLog(
  "REQUEST - ISO8583 Fields",
  Object.entries(isoMessage).map(([k, v]) => `Field ${k}: ${v}`).join("\n")
);
appendLog("REQUEST - BYTES (HEX)", finalPayload.toString("hex").toUpperCase());

const socket = new net.Socket();
let responseBuffer = Buffer.alloc(0);
const start = Date.now();

socket.setTimeout(cfg.RESP_TIMEOUT_MS);

socket.connect(Number(cfg.PORT), cfg.HOST, () => {
  console.log(`[${ts()}] [${uniqueId}] Connected to ${cfg.HOST}:${cfg.PORT}`);
  appendLog("SOCKET - CONNECTED", `Connected to ${cfg.HOST}:${cfg.PORT}`);
  socket.write(finalPayload);
  console.log(`[${ts()}] [${uniqueId}] Request sent`);
  appendLog("SOCKET - REQUEST SENT", finalPayload.toString("hex").toUpperCase());
});

// Multi-chunk safe handling
socket.on("data", data => {
  console.log(`[${ts()}] [${uniqueId}] Data chunk received (${data.length} bytes)`);
  responseBuffer = Buffer.concat([responseBuffer, data]);

  // Determine expected length from header
  let expectedLength = null;
  if (/^H02.*BN/.test(cfg.RECV_FORMAT) && responseBuffer.length >= 2) {
    expectedLength = responseBuffer.readUInt16BE(0) + 2;
  } else if (/^H04.*BN/.test(cfg.RECV_FORMAT) && responseBuffer.length >= 4) {
    expectedLength = responseBuffer.readUInt32BE(0) + 4;
  } else if (/^H04.*AS/.test(cfg.RECV_FORMAT) && responseBuffer.length >= 4) {
    expectedLength = parseInt(responseBuffer.slice(0, 4).toString("ascii"), 10) + 4;
  }

  // Parse only when full message received
  if (expectedLength && responseBuffer.length >= expectedLength) {
    try {
      console.log(`[${ts()}] [${uniqueId}] Full response received (${responseBuffer.length} bytes)`);

      const strippedResponse = stripHeaders(responseBuffer);
      console.log(`[${ts()}] [${uniqueId}] Stripping headers`);

      const parsedResponse = parseIso8583Binary(strippedResponse);
      console.log(`[${ts()}] [${uniqueId}] Parsing response`);

      const responseHex = responseBuffer.toString("hex").toUpperCase();
      appendLog("RESPONSE - BYTES (HEX)", responseHex);
      appendLog("RESPONSE - ASCII", responseBuffer.toString("ascii"));
      appendLog("RESPONSE - JSON", JSON.stringify(parsedResponse, null, 2));
      appendLog(
        "RESPONSE - ISO8583 Fields",
        Object.entries(parsedResponse).map(([k, v]) => `Field ${k}: ${v}`).join("\n")
      );

      const tat = Date.now() - start;
      appendLog("RESPONSE - TAT", `${tat} ms`);
      console.log(`[${ts()}] [${uniqueId}] Response parsed successfully`);
      console.log(`[${ts()}] [${uniqueId}] TAT: ${tat} ms`);

      // Close socket after parsing
      socket.end();
    } catch (err) {
      console.error(`[${ts()}] [${uniqueId}] Parse error: ${err.message}`);
      appendLog("RESPONSE - PARSE ERROR", err.message);
    }
  }
});

socket.on("timeout", () => {
  console.error(`[${ts()}] [${uniqueId}] Socket timeout`);
  appendLog("RESPONSE - TIMEOUT", `No response within ${cfg.RESP_TIMEOUT_MS} ms`);
  socket.destroy();
});

socket.on("close", () => {
  console.log(`[${ts()}] [${uniqueId}] Connection closed`);
  appendLog("SOCKET - CLOSED", "Connection closed by server");
});

socket.on("error", err => {
  console.error(`[${ts()}] [${uniqueId}] Socket error: ${err.message}`);
  appendLog("RESPONSE - SOCKET ERROR", err.message);
});
