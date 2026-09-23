import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { detectLocalStack } from '../config.js';
import { createSpinner } from '../cli-ui.js';
import { formatStatusTag } from '../render.js';

/**
 * Handles execution of the `tracewatch init` command sequence.
 */

export function handleInit() {
  const configPath = path.join(process.cwd(), 'tracewatch.json');
  if (fs.existsSync(configPath)) {
    console.log(
      pc.yellow(
        '⚠️  tracewatch.json configuration profile already exists in this folder.',
      ),
    );
    return;
  }

  console.log(pc.cyan('\n╭──────────────────────────────────────╮'));
  console.log(
    `${pc.bold('TRACEWATCH INIT')} ${formatStatusTag('SCAN', 'info')}`,
  );
  console.log(pc.gray('  discovering project services and runtime stack'));
  console.log(pc.cyan('╰──────────────────────────────────────╯\n'));

  const spinner = createSpinner('Scanning project directory for frameworks');
  const detectedServices = detectLocalStack();
  spinner.stop('✅ Stack scan complete');

  const configPayload = {
    port: 9999,
    services: detectedServices,
  };

  fs.writeFileSync(configPath, JSON.stringify(configPayload, null, 2), 'utf-8');

  console.log(
    pc.green(`✅ Created configuration profile: ${pc.bold('tracewatch.json')}`),
  );
  console.log(
    pc.gray(
      `Detected ${detectedServices.length} service${detectedServices.length === 1 ? '' : 's'} for observation.`,
    ),
  );
  console.log(pc.gray(JSON.stringify(configPayload, null, 2)));
}
