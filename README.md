# json-to-iso8583-parser
Json to ISO-8583 (1993) version parser with dummy echo server to test.



Purpose
This tool is a configdriven ISO8583 test client. It builds, sends, and parses ISO8583 financial transaction messages against a target host/controller. It is designed for testing and validation of message formats, headers, and payloads in a controlled environment.
Components
1. cdci.cfg
o XML file defining ISO8583 field specifications (maximum length, length bytes, etc.) for each controller.
o The client uses this to encode and decode each field correctly.
2. isotester-config.json
o JSON configuration file containing:
▪ CONTROLLER_ID → selects the correct field spec block in cdci.cfg.
▪ HOST / PORT → target server connection details.
▪ RECV_FORMAT → defines header type (ASCII4, 2BYTE, 4BYTE).
▪ FIXED_HEADER_STRING / FIXED_HEADER_LEN → optional fixed header.
▪ RESP_TIMEOUT_MS → socket timeout in milliseconds.
3. requestPayloadIsoJson.json
o JSON file containing the ISO8583 request payload (field numbers as keys, values as strings).
o Example:
json
{
 "0": "1200",
 "2": "1111111111111111111",
 "3": "400000",
 "4": "0000000050000000",
 "11": "RRKDV9000003",
 "12": "20260303000000",
 "17": "20260303",
 "24": "200",
 "32": "024",
 "49": "INR"
}
4. iso8583BinaryBuilder.js
o Builds ISO8583 binary messages from JSON payloads.
o Adds headers dynamically based on isotester-config.json.
o Strips headers from responses before parsing.
o Parses responses back into JSON fields.
o Handles bitmap creation and field encoding.
5. index.js
o Main runner script.
o Loads request payload from requestPayloadIsoJson.json.
o Builds and sends the ISO8583 message to the configured host/port.
o Receives response, strips headers, parses fields.
o Logs request and response in multiple formats.
Logging
• All logs are written into a log folder.
• Each log file is named after Field 11 (System Trace Audit Number), e.g. RRKDV9000003.log.
• Each log contains:
o Request in JSON format.
o Request in ISO8583 field listing.
o Request raw bytes (hex).
o Response raw bytes (hex).
o Response ASCII view.
o Response parsed back into JSON and ISO8583 field listing.
o Timeout or socket errors if applicable.
How to Run
1. Ensure Node.js is installed.
2. Place the following files in the same directory:
o index.js
o iso8583BinaryBuilder.js
o configLoader.js
o isotester-config.json
o cdci.cfg
o requestPayloadIsoJson.json
3. Update isotester-config.json with correct host, port, controller ID, and header format.
4. Update requestPayloadIsoJson.json with the desired ISO8583 request payload.
5. Run the client:
bash
node index.js
6. Check the log folder for the generated log file named after Field 11.
Technical Assumptions
• Encoding: All ISO8583 fields are treated as ASCII strings. No EBCDIC or binary field encoding is implemented.
• Field specifications: The parser assumes cdci.cfg accurately defines Max_Len and Length_Bytes for each field.
• Headers: The client assumes the header type is correctly specified in RECV_FORMAT (H02BN, H04BN, H04AS). Incorrect configuration will cause misalignment.
• Fixed header: If FIXED_HEADER_STRING and FIXED_HEADER_LEN are set, they are prepended to every request and stripped from every response.
• Timeouts: The socket timeout is read from RESP_TIMEOUT_MS in isotester-config.json. If no response arrives within this period, the connection is closed and a timeout is logged.
• Field 11: Assumed to always exist in the request payload and is used to name the log file.
• Response parsing: Assumes the response follows the same field specification as defined in cdci.cfg. If the server sends nonstandard fields or encodings, parsing may fail.
• Environment: Tested with Node.js runtime. Requires file system access to read configs and write logs.
 

 

 

 

 

In the current implementation, the RECV_FORMAT field in isotester-config.json controls how the client adds or strips length headers. These are the supported sample values you can set:
Supported RECV_FORMAT Values
1. H02BN
o Meaning: 2byte binary length header.
o Behavior: The client prepends a 2byte bigendian integer representing the message length.
o On response, the client strips 2 bytes before parsing.
2. H04BN
o Meaning: 4byte binary length header.
o Behavior: The client prepends a 4byte bigendian integer representing the message length.
o On response, the client strips 4 bytes before parsing.
3. H04AS
o Meaning: 4character ASCII length header.
o Behavior: The client prepends a 4digit ASCII string (e.g., "0123") representing the message length.
o On response, the client strips 4 characters before parsing.
4. H00
o Meaning: No length header.
o Behavior: The client does not prepend any length header.
o On response, no length header is stripped.
o Typically used when only a fixed header string is required.
Interaction with Fixed Header
• If FIXED_HEADER_STRING and FIXED_HEADER_LEN are set in the JSON, that string is always prepended to the request and stripped from the response, regardless of the RECV_FORMAT.
• Example:
json

"RECV_FORMAT": "H00(00,00,XX)",
"FIXED_HEADER_STRING": "XYZABC",
"FIXED_HEADER_LEN": 6
→ Outgoing message starts with "XYZABC" followed by the ISO8583 payload. → Response parsing skips the first 6 characters before decoding the ISO message.
Technical Assumptions
• Only the above four formats are supported (H02BN, H04BN, H04AS, H00).
• Any other value will result in no length header being added or stripped.
• The server must expect the same header format configured in RECV_FORMAT; mismatches will cause misalignment.
• Fixed header length must match the actual string length provided; otherwise, parsing will be offset incorrectly.
• All ISO8583 payloads are assumed to be ASCIIencoded and conform to the field specifications in cdci.cfg.
