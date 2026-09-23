import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { loadConfig } from '../config.js';
import { spawnServices } from '../collector.js';
import { EventStore } from '../store.js';
import { parseLogLine } from '../parsers/index.js';
import {
  renderToConsole,
  formatStatusHeader,
  formatStatusTag,
  formatServiceBadge,
} from '../render.js';
import { startDashboardServer, broadcastLog } from '../server.js';
import { createSpinner } from '../cli-ui.js';

/**
 * Handles execution of the `tracewatch start` command sequence.
 * @param {Object} options - Command line flags passed by the user
 */

export function handleStart(options = {}) {
  let config;
  const configSpinner = createSpinner('Loading workspace configuration');

  try {
    config = loadConfig();
  } catch (err) {
    configSpinner.stop();
    console.error(pc.red(`❌ ${err.message}`));
    return;
  }
  configSpinner.stop('✅ Workspace configuration loaded');

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

  console.log(pc.cyan('\n╭──────────────────────────────────────────╮'));
  console.log(
    `${pc.bold('TRACEWATCH')} ${formatStatusTag('LIVE', 'success')}  ${pc.gray('live service workspace')}`,
  );
  console.log(pc.gray('Observe the signal. Find the failure.'));
  console.log(pc.cyan('╰──────────────────────────────────────────╯\n'));

  // 2. Instantiate our fixed-size 50k log repository ring buffer

  const store = new EventStore(50000);

  // 3. Conditionally spin up the local HTTP web console if the --web flag is provided
  if (options.web) {
    const targetPort = config.port || 9999;
    const dashboardServer = startDashboardServer(targetPort, store);
    dashboardServer.once('listening', () => {
      console.log(
        pc.green(
          `🌐 Visual UI Server actively listening at http://localhost:${targetPort}`,
        ),
      );
    });
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
  const servicesSummary = config.services
    .map((service) =>
      formatServiceBadge(service.name, service.color || 'neutral'),
    )
    .join('  ');

  console.log(
    pc.cyan(`  services   ${config.services.length} configured and starting`),
  );
  console.log(`  runtime   ${servicesSummary}`);
  spawnServices(config.services, onIncomingLog);

  console.log(pc.green('\n  status     stream established'));
  console.log(pc.gray('  command   Ctrl+C to stop the workspace safely.\n'));
}
