import pc from 'picocolors';
import { loadConfig } from '../config.js';
import { spawnServices } from '../collector.js';
import { EventStore } from '../store.js';
import { parseLogLine } from '../parsers/index.js';
import {
  renderToConsole,
  formatStatusTag,
  formatServiceBadge,
} from '../render.js';
import { startDashboardServer, broadcastLog } from '../server.js';
import { createSpinner } from '../cli-ui.js';
import {
  isPortInUse,
  getPortPids,
  freePort,
  extractPort,
} from '../ports.js';

/**
 * Handles execution of the `tracewatch start` command sequence.
 * @param {Object} options - Command line flags passed by the user
 */

export async function handleStart(options = {}) {
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

  // By default, TraceWatch auto-frees conflicting ports so local services boot cleanly
  // This can be disabled via --no-kill or by setting "killConflicts": false in tracewatch.json
  const shouldKillConflicts =
    options.noKill
      ? false
      : options.killConflicts || config.killConflicts !== false;

  // 1. Filter services
  const managedServices = config.services.filter(
    (service) => service.managed !== false,
  );
  const attachedServices = config.services.filter(
    (service) => service.managed === false,
  );

  // 2. Pre-flight port verification and automated resolution
  for (const service of managedServices) {
    const port = extractPort(service);
    if (port) {
      const occupied = await isPortInUse(port);
      if (occupied) {
        if (shouldKillConflicts) {
          const freedPids = freePort(port);
          const freedMsg =
            freedPids.length > 0
              ? `PID ${freedPids.join(', ')}`
              : 'stale process';
          console.log(
            pc.yellow(
              `  ⚡ freed     port ${port} (terminated ${freedMsg}) for [${service.name}]`,
            ),
          );
        } else {
          const pids = getPortPids(port);
          const pidInfo = pids.length > 0 ? ` (PID ${pids.join(', ')})` : '';
          console.log(
            pc.yellow(
              `  ⚠️  conflict  port ${port} is in use${pidInfo} [${service.name}]`,
            ),
          );
          console.log(
            pc.gray(
              '             Pass "--kill-conflicts" (-k) to auto-free ports before start.',
            ),
          );
        }
      }
    }
  }

  // 3. Instantiate our fixed-size 50k log repository ring buffer
  const store = new EventStore(50000);

  // 4. Conditionally spin up the local HTTP web console if the --web flag is provided
  if (options.web) {
    let targetPort = config.port || 9999;
    const webPortInUse = await isPortInUse(targetPort);

    if (webPortInUse) {
      if (shouldKillConflicts) {
        const freed = freePort(targetPort);
        console.log(
          pc.yellow(
            `  ⚡ freed     UI port ${targetPort} (stale PID: ${freed.join(', ') || 'orphaned'})`,
          ),
        );
      } else {
        // Find next open port
        let nextPort = targetPort + 1;
        while ((await isPortInUse(nextPort)) && nextPort < targetPort + 20) {
          nextPort++;
        }
        console.log(
          pc.yellow(
            `  ℹ️  web UI    port ${targetPort} in use; rerouting to http://localhost:${nextPort}`,
          ),
        );
        targetPort = nextPort;
      }
    }

    const dashboardServer = startDashboardServer(targetPort, store);
    dashboardServer.once('listening', () => {
      console.log(
        pc.green(
          `🌐 Visual UI Server actively listening at http://localhost:${targetPort}`,
        ),
      );
    });
  }

  // 5. Setup our processing gateway to run when a service speaks
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

  // 6. Fire up background processes concurrently
  const servicesSummary = config.services
    .map((service) =>
      formatServiceBadge(service.name, service.color || 'neutral'),
    )
    .join('  ');

  console.log(
    pc.cyan(`  services   ${managedServices.length} configured and starting`),
  );
  console.log(`  runtime   ${servicesSummary}`);
  if (attachedServices.length > 0) {
    console.log(
      pc.yellow(
        `  attached   ${attachedServices.map((service) => service.name).join(', ')} already running`,
      ),
    );
    console.log(
      pc.gray(
        '             TraceWatch will not launch attached services. Their existing terminal output cannot be captured retroactively.',
      ),
    );
  }
  spawnServices(managedServices, onIncomingLog);

  console.log(pc.green('\n  status     stream established'));
  console.log(pc.gray('  command   Ctrl+C to stop the workspace safely.\n'));
}
