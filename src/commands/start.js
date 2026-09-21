import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { loadConfig } from '../config.js';
import { spawnServices } from '../collector.js';
import { EventStore } from '../store.js';
import { parseLogLine } from '../parsers/index.js';
import { renderToConsole } from '../render.js';
import { startDashboardSever, broadcastLog } from '../server.js';

/**
 * Handles execution of the `tracewatch start` command sequence.
 * @param {Object} options - Command line flags passed by the user
 */

export function handleStart(options = {}) {
  let config;

  try {
    config = loadConfig();
  } catch (err) {
    console.error(pc.red(`❌ ${err.message}`));
    return;
  }

  if (
    !config ||
    !Array.isArray(config.services) ||
    config.services.length === 0
  ) {
    console.error(
      pc.red('❌ No services configured. Check your TraceWatch config.'),
    );
    return;
  }

  console.log(
    pc.blue(`\n🚀 TraceWatch v0.1.0 starting multi-service pipeline...`),
  );
  console.log(
    pc.gray(`Motto: "Don't show me the logs, show me what broke."\n`),
  );

  // 2. Instantiate our fixed-size 50k log repository ring buffer

  const store = new EventStore(50000);

  // 3. Conditionally spin up the local HTTP web console if the --web flag is provided
  if (options.web) {
    const targetPort = config.port || 9999;
    startDashboardSever(targetPort, store);
    console.log(
      pc.green(
        `🌐 Visual UI Server actively listening at http://localhost:${targetPort}`,
      ),
    );
  }

  // Define an active tracking map to look up service colors quickly
  const serviceColorMap = new Map();
  config.services.forEach((service) => {
    serviceColorMap.set(service.name, service.color);
  });

  // 3. Setup our processing gateway to run when a service speaks
  const onIncomingLog = (rawLog) => {
    // rawLog contains: { service, stream, text, color }

    // Convert raw process console text into a standard LogEvent contract
    const parsedEvent = parseLogLine(rawLog.text, rawLog.service);

    // Save to memory ring buffer + append to transactional session file on disk
    const savedEvent = store.append(parsedEvent);

    // Render cleanly to the terminal timeline
    renderToConsole(savedEvent, rawLog.color);

    if (options.web) {
      broadcastLog(savedEvent);
    }
  };
  // 4. Fire up background processes concurrently
  console.log(
    pc.cyan(
      `📦 Spawning [${config.services.length}] configured sub-services...`,
    ),
  );
  spawnServices(config.services, onIncomingLog);

  console.log(
    pc.green(
      `\n⚡ Stream established. Press Ctrl+C to terminate all services safely.\n`,
    ),
  );
}
