"use strict";

const net = require("net");
const {
  buildIso8583Binary,
  addLengthHeader,
  stripHeaders,
  parseIso8583Binary
} = require("./iso8583BinaryBuilder");

// Utility: timestamp string
function ts() {
  return new Date().toISOString();
}

const server = net.createServer(socket => {
  console.log(`[${ts()}] Client connected`);

  socket.on("data", data => {
    const start = Date.now();
    console.log(`[${ts()}] Received raw: ${data.toString("hex")}`);

    try {
      // Step 1: Strip headers
      const t1 = Date.now();
      const stripped = stripHeaders(data);
      console.log(`[${ts()}] Headers stripped (took ${Date.now() - t1} ms)`);

      // Step 2: Parse ISO8583 request
      const t2 = Date.now();
      const requestJson = parseIso8583Binary(stripped);
      console.log(`[${ts()}] Parsed request (took ${Date.now() - t2} ms):`, requestJson);

      // Build unique ID from Field 11 + Field 12
      const uniqueId = `${requestJson["11"] || "NA"}_${requestJson["12"] || "NA"}`;

      // Step 3: Prepare response JSON
      const t3 = Date.now();
      const responseJson = { ...requestJson };
      responseJson["0"]  = getResponseMTI(requestJson["0"]);
      responseJson["39"] = getDefaultResponseCode(requestJson["0"]);
      responseJson["38"] = generateApprovalCode();
      responseJson["37"] = generateRetrievalReference(requestJson["11"]);
      responseJson["12"] = getLocalDateTime();
      console.log(`[${ts()}] [${uniqueId}] Response JSON prepared (took ${Date.now() - t3} ms):`, responseJson);

      // Step 4: Build binary response
      const t4 = Date.now();
      const responseIso = buildIso8583Binary(responseJson);
      console.log(`[${ts()}] [${uniqueId}] Response ISO built (took ${Date.now() - t4} ms)`);

      // Step 5: Add length header
      const t5 = Date.now();
      const finalResponse = addLengthHeader(responseIso);
      console.log(`[${ts()}] [${uniqueId}] Length header added (took ${Date.now() - t5} ms)`);

      // Step 6: Send response
      const t6 = Date.now();
      socket.write(finalResponse);
      console.log(`[${ts()}] [${uniqueId}] Sent response (took ${Date.now() - t6} ms): ${finalResponse.toString("hex")}`);

      const end = Date.now();
      const tat = end - start;
      console.log(`[${ts()}] [${uniqueId}] Overall TAT: ${tat} ms`);

      // Close connection after sending response
      socket.end();
    } catch (err) {
      console.error(`[${ts()}] Error parsing/building ISO8583:`, err.message);
    }
  });

  socket.on("end", () => {
    console.log(`[${ts()}] Client disconnected`);
  });
});

// === Helpers ===

function getResponseMTI(requestMTI) {
  const mapping = {
    "0100": "0110",
    "0200": "0210",
    "0300": "0310",
    "0400": "0410",
    "0800": "0810"
  };
  return mapping[requestMTI] || requestMTI;
}

function getDefaultResponseCode(requestMTI) {
  switch (requestMTI) {
    case "0100": return "00"; // Approved
    case "0200": return "00"; // Approved
    case "0400": return "00"; // Reversal accepted
    case "0800": return "00"; // Network management success
    default: return "96";     // System malfunction
  }
}

function generateApprovalCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generateRetrievalReference(stan) {
  const now = new Date();
  const yday = String(Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000)).padStart(3, "0");
  const hhmmss = now.toTimeString().slice(0, 8).replace(/:/g, "");
  return (stan || "000000") + yday + hhmmss.slice(0, 6);
}

function getLocalDateTime() {
  const now = new Date();
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const DD = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${YYYY}${MM}${DD}${hh}${mm}${ss}`;
}

server.listen(5000, "127.0.0.1", () => {
  console.log(`[${ts()}] ISO8583 echo-server listening on 127.0.0.1:5000`);
});
