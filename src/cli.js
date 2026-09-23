import { handleInit } from './commands/init.js';
import { handleStart } from './commands/start.js';
import { handleExplain } from './commands/explain.js';
import { handleExport } from './commands/export.js';

// 1. Extract the raw arguments from the terminal process execution
const rawArgs = process.argv.slice(2);
// Detect if a help modifier is present anywhere in the inputs
const isHelpRequested = rawArgs.includes('--help') || rawArgs.includes('-h');

// 2. Safely isolate the command action word and separate flags
const command = rawArgs.find((arg) => !arg.startsWith('-'));
const flags = rawArgs.filter((arg) => arg.startsWith('-'));

// 2. Define the main CLI help menu string
const helpMenu = `
TraceWatch  /  incident intelligence for local services

USAGE
  tracewatch <command> [flags]

COMMANDS
  init       Detect local frameworks and create tracewatch.json
  start      Run configured services in one observable timeline
  explain    Find the most likely root cause in the latest session
  export     Write a redacted diagnostic report to Markdown

FLAGS
  --web          Launch the live operations dashboard with start
  --out <file>   Specify output file for export (default: report.md)
  --no-redact    Disable credential redaction during export
  --help, -h     Show this command reference
`;

// 3. Handle help flag or missing parameters
if (!command || isHelpRequested) {
  // Store trimmed text explicitly to prevent execution leakage
  const cleanHelpText = String(helpMenu).trim();
  console.log(cleanHelpText);
  process.exit(0);
}

// 4. Command Router Engine (Lazy loads command files to maximize operational speed)
switch (command) {
  case 'init':
    console.log('🔍 Executing stack auto-discovery setup...');
    handleInit();
    break;

  case 'start':
    const useWeb = flags.includes('--web');
    // Pass along flags array mapped into simple config parameters if needed
    handleStart({ web: useWeb });
    break;

  case 'explain':
    await handleExplain();
    break;

  case 'export':
    // Parse flag modifiers if user overrides out file configurations
    const outFlagIndex = rawArgs.indexOf('--out');
    let customFile = 'report.md';
    if (
      outFlagIndex !== -1 &&
      rawArgs[outFlagIndex + 1] &&
      !rawArgs[outFlagIndex + 1].startsWith('-')
    ) {
      customFile = rawArgs[outFlagIndex + 1];
    }
    const noRedact = flags.includes('--no-redact');

    handleExport({ out: customFile, redact: !noRedact });
    break;

  default:
    console.error(
      `❌ Error: Unknown command "${command}". Type "tracewatch --help" to view options.`,
    );
    process.exit(1);
}
