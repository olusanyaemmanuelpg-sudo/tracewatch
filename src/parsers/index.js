/**
 * Strips out messy terminal ANSI escape/color sequence strings.
 * @param {string} text
 * @returns {string} Clean textual representation
 */

export function stripAnsi(text) {
  // Regular expression to catch color and text-formatting codes completely
  return text.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    '',
  );
}

/**
 * Parses a raw captured console line into a structural TraceWatch LogEvent object.
 * @param {string} rawLine - The raw stdout string intercepted from a service process
 * @param {string} serviceName - Name of the originating service execution context
 * @returns {Omit<import('../types.js').LogEvent, 'id'>} Clean structured data map ready for storage
 */

export function parseLogLine(rawline, serviceName) {
  const cleanLine = stripAnsi(rawline);
  const timestamp = new Date().toISOString();

  // 1. STRATEGY A: Attempt JSON parsing first (High-utility modern app pattern)
  if (cleanLine.startsWith('{') && cleanLine.endsWith('}')) {
    try {
      const jsonData = JSON.parse(cleanLine);

      //Map common structural JSON logging keys dynamically
      const message =
        jsonData.msg || jsonData.message || jsonData.text || cleanLine;
      const level = String(
        jsonData.level || jsonData.status || 'info',
      ).toLowerCase();
      const requestId =
        jsonData.request_id ||
        jsonData.requestId ||
        jsonData.trace_id ||
        jsonData.traceId ||
        null;

      return {
        timestamp: jsonData.timestamp || jsonData.time || timestamp,
        service: serviceName,
        level: ['info', 'warn', 'error', 'fatal'].includes(level)
          ? level
          : 'info',
        message:
          typeof message === 'object'
            ? JSON.stringify(message)
            : String(message),
        requestId: requestId ? String(requestId) : null,
      };
    } catch (e) {
      // JSON attempt failed due to invalid internal syntax; carry on to text parsing fallback
    }
  }
  // 2. STRATEGY B: Fallback Text Line Structure Processing
  // Look for implicit request/correlation indicators embedded inside general text sentences
  let inferredRequestId = null;
  const requestMatch = cleanLine.match(
    /(?:request_id|requestId|req_id|traceId)[\s:=]+([a-zA-Z0-9_-]+)/i,
  );
  if (requestMatch && requestMatch[1]) {
    inferredRequestId = requestMatch[1];
  }

  // Deduce operational logging alert status from standard text keywords
  let level = 'info';
  if (/fatal|critical/i.test(cleanLine)) level = 'fatal';
  else if (/error|failed|exception/i.test(cleanLine)) level = 'error';
  else if (/warn|warning/i.test(cleanLine)) level = 'warn';

  return {
    timestamp,
    service: serviceName,
    level,
    message: cleanLine,
    requestId: inferredRequestId,
  };
}

export function userFrame(frames) {
  return frames.find((frame) => !/(?:node_modules|internal\/|node:)/.test(frame)) || null;
}
