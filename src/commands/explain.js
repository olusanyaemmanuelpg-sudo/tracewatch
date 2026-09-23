import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { correlateEvents } from '../correlate.js';
import { analyzeTraces } from '../analyze.js';
import { superviseWithAI } from '../analyze-ai.js';
import { formatLogEvent, formatEvidenceLine } from '../render.js';
import { createSpinner } from '../cli-ui.js';

/**
 * Handles execution of the `tracewatch explain` command sequence.
 */

export async function handleExplain() {
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

  const spinner = createSpinner('Reading and analyzing session logs');
  const historicEvents = [];
  try {
    const rawData = fs.readFileSync(sessionPath, 'utf-8');
    const lines = rawData.split('\n');

    lines.forEach((line) => {
      if (!line.trim()) return;
      historicEvents.push(JSON.parse(line));
    });
  } catch (err) {
    spinner.stop();
    console.log(pc.red('❌ Failed to read log session trace file.'));
    return;
  }

  if (historicEvents.length === 0) {
    spinner.stop();
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
  spinner.stop('✅ Session analysis complete');

  // 4. Default structural layout screen if no rules successfully trigger matching signatures
  if (findings.length === 0) {
    const aiFinding = await superviseWithAI(historicEvents, null);

    if (aiFinding?.success) {
      console.log(`\n${pc.bold(pc.red(aiFinding.cause))}`);
      console.log(
        pc.gray(
          `${Math.round(aiFinding.confidence * 100)}% confidence · rule ${aiFinding.rule}\n`,
        ),
      );

      console.log(pc.bold('evidence'));
      aiFinding.evidence.forEach((ev) => {
        const evidenceText =
          typeof ev === 'string' ? ev : formatLogEvent(ev, 'white');
        console.log(`  ${formatEvidenceLine(evidenceText, 'white')}`);
      });

      console.log(`\n${pc.bold(pc.cyan('next'))}  ${aiFinding.fix}\n`);
      return;
    }

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
    if (aiFinding?.message) {
      console.log(pc.gray(aiFinding.message));
    }
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
    console.log(`  ${formatLogEvent(ev, 'white')}`);
  });

  console.log(`\n${pc.bold(pc.cyan('next'))}  ${topFinding.fix}\n`);
}
