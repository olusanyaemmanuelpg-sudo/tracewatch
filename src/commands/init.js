import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { detectLocalStack } from '../config.js';
import { inferStackWithAI } from '../analyze-ai.js';
import { createSpinner } from '../cli-ui.js';
import { formatStatusTag } from '../render.js';

/**
 * Handles execution of the `tracewatch init` command sequence.
 * @param {Object} [options]
 */
export async function handleInit(options = {}) {
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
  let detectedServices = detectLocalStack();

  const isOnlyUnknown =
    detectedServices.length === 0 ||
    (detectedServices.length === 1 && detectedServices[0].type === 'unknown');

  // Lightweight AI fallback: ONLY triggered when deterministic scan found no supported frameworks
  // and developer has GEMINI_API_KEY configured.
  if (isOnlyUnknown && process.env.GEMINI_API_KEY) {
    spinner.update('Consulting AI fallback for project stack...');
    try {
      const aiResult = await inferStackWithAI(process.cwd());
      if (
        aiResult?.success &&
        Array.isArray(aiResult.services) &&
        aiResult.services.length > 0
      ) {
        const PALETTE = ['cyan', 'magenta', 'yellow', 'blue', 'green'];
        detectedServices = aiResult.services.map((service, index) => ({
          ...service,
          color: service.color || PALETTE[index % PALETTE.length],
        }));
      }
    } catch {
      // Gracefully fall back to deterministic scan results
    }
  }

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
