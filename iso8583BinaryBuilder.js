"use strict";

const fs = require("fs");
const path = require("path");
const { loadIsoTesterConfig } = require("./configLoader");

function loadFieldConfig(controllerId) {
  const cfgPath = path.join(__dirname, "cdci.cfg");
  const xml = fs.readFileSync(cfgPath, "utf8");

  const controllerRegex = new RegExp(
    `<Controller_Params>[\\s\\S]*?<Controller_Id>${controllerId}[\\s\\S]*?<Field_Spec_List>([\\s\\S]*?)</Field_Spec_List>[\\s\\S]*?</Controller_Params>`,
    "i"
  );
  const controllerMatch = xml.match(controllerRegex);
  if (!controllerMatch) {
    throw new Error(`Controller ${controllerId} not found in cdci.cfg`);
  }

  const fieldBlock = controllerMatch[1];
  const fieldConfig = {};
  const fieldRegex =
    /<Field_No>(\d+)[\s\S]*?<Max_Len>(\d+)[\s\S]*?<Length_Bytes>(\d+)/g;

  let match;
  while ((match = fieldRegex.exec(fieldBlock)) !== null) {
    fieldConfig[Number(match[1])] = {
      maxLen: Number(match[2]),
      lengthBytes: Number(match[3])
    };
  }

  return fieldConfig;
}

function bitmapToBuffer(bits) {
  const buf = Buffer.alloc(8);
  for (let byte = 0; byte < 8; byte++) {
    let val = 0;
    for (let bit = 0; bit < 8; bit++) {
      val = (val << 1) | bits[byte * 8 + bit];
    }
    buf[byte] = val;
  }
  return buf;
}

function buildIso8583Binary(message) {
  const cfg = loadIsoTesterConfig();
  const fieldConfig = loadFieldConfig(cfg.CONTROLLER_ID);

  const fields = Object.keys(message)
    .map(Number)
    .filter(f => f !== 0 && f !== 1)
    .sort((a, b) => a - b);

  const hasSecondary = fields.some(f => f > 64);

  const primary = new Array(64).fill(0);
  const secondary = hasSecondary ? new Array(64).fill(0) : null;
  if (hasSecondary) primary[0] = 1;

  fields.forEach(f => {
    if (f <= 64) primary[f - 1] = 1;
    else secondary[f - 65] = 1;
  });

  const buffers = [];
  buffers.push(Buffer.from(message["0"], "ascii"));
  buffers.push(bitmapToBuffer(primary));
  if (hasSecondary) buffers.push(bitmapToBuffer(secondary));

  fields.forEach(fld => {
    const cfgField = fieldConfig[fld];
    if (!cfgField) throw new Error(`Field ${fld} not defined in cdci.cfg`);

    const value = String(message[fld]);

    if (cfgField.lengthBytes > 0) {
      buffers.push(
        Buffer.from(value.length.toString().padStart(cfgField.lengthBytes, "0"), "ascii"),
        Buffer.from(value, "ascii")
      );
    } else {
      buffers.push(
        Buffer.from(value.padEnd(cfgField.maxLen, " "), "ascii")
      );
    }
  });

  return Buffer.concat(buffers);
}

function addLengthHeader(isoMessage) {
  const cfg = loadIsoTesterConfig();
  const recvFormat = cfg.RECV_FORMAT || "";
  const fixedHeaderLen = Number(cfg.FIXED_HEADER_LEN || 0);
  const fixedHeaderStr = cfg.FIXED_HEADER_STRING || "";

  let headerBuf = Buffer.alloc(0);

  if (/^H02.*BN/.test(recvFormat)) {
    headerBuf = Buffer.alloc(2);
    headerBuf.writeUInt16BE(isoMessage.length);
  } else if (/^H04.*BN/.test(recvFormat)) {
    headerBuf = Buffer.alloc(4);
    headerBuf.writeUInt32BE(isoMessage.length);
  } else if (/^H04.*AS/.test(recvFormat)) {
    const len = isoMessage.length.toString().padStart(4, "0");
    headerBuf = Buffer.from(len, "ascii");
  }

  if (fixedHeaderStr && fixedHeaderLen > 0) {
    const fixedBuf = Buffer.from(fixedHeaderStr.padEnd(fixedHeaderLen, " "), "ascii");
    return Buffer.concat([fixedBuf, headerBuf, isoMessage]);
  }

  return Buffer.concat([headerBuf, isoMessage]);
}

function stripHeaders(buffer) {
  const cfg = loadIsoTesterConfig();
  let offset = 0;

  if (cfg.FIXED_HEADER_LEN && Number(cfg.FIXED_HEADER_LEN) > 0) {
    offset += Number(cfg.FIXED_HEADER_LEN);
  }

  if (/^H02.*BN/.test(cfg.RECV_FORMAT)) {
    offset += 2;
  } else if (/^H04.*BN/.test(cfg.RECV_FORMAT)) {
    offset += 4;
  } else if (/^H04.*AS/.test(cfg.RECV_FORMAT)) {
    offset += 4;
  }

  return buffer.slice(offset);
}

function parseIso8583Binary(buffer) {
  const cfg = loadIsoTesterConfig();
  const fieldConfig = loadFieldConfig(cfg.CONTROLLER_ID);

  let offset = 0;
  const message = {};

  // MTI
  message["0"] = buffer.slice(offset, offset + 4).toString("ascii");
  offset += 4;

  // Primary bitmap
  const primaryBits = buffer.slice(offset, offset + 8);
  offset += 8;
  const bits = [];
  for (let byte = 0; byte < 8; byte++) {
    for (let bit = 7; bit >= 0; bit--) {
      bits.push((primaryBits[byte] >> bit) & 1);
    }
  }

  const hasSecondary = bits[0] === 1;
  let secondaryBits = [];
  if (hasSecondary) {
    const secBuf = buffer.slice(offset, offset + 8);
    offset += 8;
    for (let byte = 0; byte < 8; byte++) {
      for (let bit = 7; bit >= 0; bit--) {
        secondaryBits.push((secBuf[byte] >> bit) & 1);
      }
    }
  }

  const allBits = bits.concat(secondaryBits);

  for (let f = 2; f < allBits.length + 1; f++) {
    if (allBits[f - 1] === 1) {
      const cfgField = fieldConfig[f];
      if (!cfgField) continue;

      if (cfgField.lengthBytes > 0) {
        const lenStr = buffer.slice(offset, offset + cfgField.lengthBytes).toString("ascii");
        offset += cfgField.lengthBytes;
        const len = parseInt(lenStr, 10);
        message[f] = buffer.slice(offset, offset + len).toString("ascii");
        offset += len;
      } else {
        message[f] = buffer.slice(offset, offset + cfgField.maxLen).toString("ascii").trim();
        offset += cfgField.maxLen;
      }
    }
  }

  return message;
}

module.exports = {
  buildIso8583Binary,
  addLengthHeader,
  stripHeaders,
  parseIso8583Binary
};
