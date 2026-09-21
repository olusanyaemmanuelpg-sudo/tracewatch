import { fileURLToPath } from 'url';
import { handleInit } from './commands/init.js';
import { handleStart } from './commands/start.js';
import { handleExplain } from './commands/explain.js';

// 1. Extract the raw arguments from the terminal process execution

const [, , command, ...flags] = process.argv;

// 2. Define the main CLI help menu string
const helpMenu = `
TraceWatch v0.1.0 - Root Cause Analysis for Modern Local Development
Motto: "Don't show me the logs, show me what broke."

Usage:
  tracewatch <command> [flags]

Commands:
  init                 Automatically detect frameworks and write the tracewatch.json config
  start                Run all configured services concurrently in a single timeline
  explain              Parse recent session logs and isolate the core root cause of failures
  export               Generate a clean markdown diagnostic report with secrets redacted
  serve                Replay and review a finished developer logging session in the browser

Flags:
  --web                Launch the local dashboard web console alongside process initialization
  --help, -h           Display this operational command summary screen
`;

// 3. Handle help flag or missing parameters
if (!command || flags.includes('--help') || flags.includes('-h')) {
  console.log(helpMenu);
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
    handleStart({ web: useWeb }); // <-- CHANGE THIS LINE
    break;

  case 'explain':
    handleExplain();
    break;

  case 'export':
    console.log('📝 Generating markdown performance audit trail...');
    break;

  case 'serve':
    console.log('🌐 Mounting session playback micro-server...');
    break;

  default:
    console.error(
      `❌ Error: Unknown command "${command}". Type "tracewatch --help" to view options.`,
    );
    process.exit(1);
}
