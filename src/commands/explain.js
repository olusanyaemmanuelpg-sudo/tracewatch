import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { correlateEvents } from '../correlate.js';
import { analyzeTraces } from '../analyze.js';
import { formatLogLine } from '../render.js';

/**
 * Handles execution of the `tracewatch explain` command sequence.
 */

export function handleExplain() {
  const sessionPath = path.join(process.cwd(), '.tracewatch-session.jsonl');

  if (!fs.existsSync(sessionPath)) {
    console.log(
      pc.red(
        '❌ Error: No recent log session data found. Run "tracewatch start" first to collect data.',
      ),
    );
    return;
  }

  // 2. Parse the append-only log entries line-by-line back into memory arrays
  /** @type {import('../types.js').LogEvent[]} */

  const historicEvents = [];
  try {
    const rawData = fs.readFileSync(sessionPath, 'utf-8');
    const lines = rawData.split('\n');

    lines.forEach((line) => {
      if (!line.trim()) return;
      historicEvents.push(JSON.parse(line));
    });
  } catch (err) {
    console.log(pc.red('❌ Failed to read log session trace file.'));
    return;
  }

  if (historicEvents.length === 0) {
    console.log(
      pc.yellow(
        '⚠️  The current log session file is completely empty. No data to analyze.',
      ),
    );
    return;
  }

  // 3. Process logs through our correlation engines and analytical rule sets
  const correlatedTraces = correlateEvents(historicEvents);
  const findings = analyzeTraces(correlatedTraces, historicEvents);

  // 4. Default structural layout screen if no rules successfully trigger matching signatures
  if (findings.length === 0) {
    console.log(
      pc.yellow(
        '\n🔍 TraceWatch swept the log sequence but found no matching error rule signatures.',
      ),
    );
    console.log(
      pc.gray(
        'Everything looks healthy, or the error profile is unrecognized.\n',
      ),
    );
    return;
  }

  // Extract the highest operational ranked finding score at index 0
  const topFinding = findings[0];

  // 5. Output the signature structural visual blueprint layout exactly matching the specification guide
  console.log(`\n${pc.bold(pc.red(topFinding.cause))}`);
  console.log(
    pc.gray(
      `${Math.round(topFinding.confidence * 100)}% confidence · rule ${topFinding.rule}\n`,
    ),
  );

  console.log(pc.bold('evidence'));
  topFinding.evidence.forEach((ev) => {
    // Render out structural log entries wrapped in light gray formatting indicators
    console.log(`  ${formatLogLine(ev, 'white')}`);
  });

  console.log(`\n${pc.bold(pc.cyan('next'))}  ${topFinding.fix}\n`);
}
