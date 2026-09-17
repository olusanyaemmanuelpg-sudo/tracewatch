import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { detectLocalStack } from '../config.js';

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

  console.log(pc.cyan('🔍 Scanning project directory for frameworks...'));

  // Fetch discovered local application stacks
  const detectedServices = detectLocalStack();

  // Construct the clean config temeplate precisely matching your application
  const configPayload = {
    port: 9999,
    services: detectedServices,
  };

  //Write the JSON configuration file to the current working directory
  fs.writeFileSync(configPath, JSON.stringify(configPayload, null, 2), 'utf-8');

  console.log(pc.green('✅ Created configuration profile: tracewatch.json'));
  console.log(pc.gray(JSON.stringify(configPayload, null, 2)));
}
