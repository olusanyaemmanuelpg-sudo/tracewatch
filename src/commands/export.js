import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { correlateEvents } from '../correlate.js';
import { analyzeTraces } from '../analyze.js';
import { createSpinner } from '../cli-ui.js';

/**
 * Strips out credential strings, access tokens, and passwords to prevent corporate leaks.
 * @param {string} text - The raw message string content
 * @returns {string} Sanitized string data
 */
export function redactSecrets(text) {
  return (
    text
      // Redact authorization token headers (Bearer tokens, basic credentials)
      .replace(
        /(auth|authorization|bearer|token|jwt)[:=\s"']+[a-zA-Z0-9_\-\.\=\+]{10,}/gi,
        '\$1: [REDACTED]',
      )
      // Redact raw text password fields or environment credentials
      .replace(
        /(pass|password|pwd|secret|key)[:=\s"']+[a-zA-Z0-9_\-\.\!\@\#\$\%\^\&\*]{4,}/gi,
        '\$1: [REDACTED]',
      )
      // Redact private database connection URL strings containing passwords
      .replace(
        /(mongodb\+srv:\/\/|postgres:\/\/|mysql:\/\/)[^:]+:[^@]+@/gi,
        '\$1[USER]:[PASSWORD]@',
      )
  );
}

/**
 * Handles execution of the `tracewatch export` command sequence.
 * @param {Object} [options={}] - Command line flags passed by the user
 */
export function handleExport(options = {}) {
  const sessionPath = path.join(process.cwd(), '.tracewatch-session.jsonl');
  const outFilename = options.out || 'report.md';
  const shouldRedact = options.redact !== false; // Default to true

  // 1. Verify session logs exist
  if (!fs.existsSync(sessionPath)) {
    console.log(
      pc.red(
        '❌ Error: No log session found. Run "tracewatch start" first to collect data.',
      ),
    );
    return;
  }

  // 2. Load historic ledger data
  /** @type {import('../types.js').LogEvent[]} */
  const events = [];
  const spinner = createSpinner('Building secure diagnostic report');
  try {
    const rawData = fs.readFileSync(sessionPath, 'utf-8');
    rawData.split('\n').forEach((line) => {
      if (!line.trim()) return;
      events.push(JSON.parse(line));
    });
  } catch (err) {
    spinner.stop();
    console.error(
      pc.red('❌ Failed to process the logging session data ledger.'),
    );
    return;
  }

  // 3. Process logs through the analytical rule engine
  const traces = correlateEvents(events);
  const findings = analyzeTraces(traces, events);
  const topFinding = findings[0] || null;

  // 4. Construct Markdown String Structure Template
  let md = `# 📊 TraceWatch Diagnostic Report\n`;
  md += `*Generated dynamically on ${new Date().toLocaleString()}*\n\n`;

  if (topFinding) {
    md += `## 🚨 Root Cause Diagnosis\n`;
    md += `> **${topFinding.cause}**\n\n`;
    md += `- Confidence: ${Math.round(topFinding.confidence * 100)}%\n`;
    md += `- Rule triggered: ${topFinding.rule}\n`;
    md += `- Status: incident\n\n`;
    md += `### 💡 Suggested Fix Action\n`;
    md += `${topFinding.fix}\n\n`;
  } else {
    md += `## ✅ System Health Status\n`;
    md += `TraceWatch scanned the aggregated timeline logs but detected zero error signature violations.\n\n`;
  }

  md += `## 📜 Aggregated Log Timeline\n`;
  md += `\`\`\`text\n`;

  // 5. Append timeline lines passing them through the redaction layer if active
  events.forEach((event) => {
    let message = event.message;
    if (shouldRedact) {
      message = redactSecrets(message);
    }

    const time = new Date(event.timestamp)
      .toISOString()
      .split('T')[1]
      .slice(0, -1);
    const badge = event.service.padEnd(8).toUpperCase();
    md += `${time} | ${badge} | ${message}${event.requestId ? ` [req:${event.requestId}]` : ''}\n`;
  });

  md += `\`\`\`\n\n`;
  md += `---\n*Report generated via TraceWatch CLI — "Don't show me the logs, show me what broke."*\n`;

  // 6. Output the string buffer file synchronously to workspace root
  const outPath = path.join(process.cwd(), outFilename);
  fs.writeFileSync(outPath, md, 'utf-8');
  spinner.stop('✅ Report generation complete');

  console.log(
    pc.green(
      `\n📝 Clean markdown audit report successfully generated at: ${pc.bold(outFilename)}`,
    ),
  );
  if (shouldRedact) {
    console.log(
      pc.gray(
        '🔒 Internal security data, connection hashes, and tokens were securely redacted.\n',
      ),
    );
  }
}
