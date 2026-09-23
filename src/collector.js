import { spawn } from 'child_process';
import readline from 'readline';
import path from 'path';
import pc from 'picocolors';

function isPortConflict(line) {
  return /eaddrinuse|address already in use|port\s+\d+\s+is already in use|port.*in use/i.test(
    line,
  );
}

/**
 * Spawns and manages a group of configured local application services.
 * @param {Array<Object>} services - Array of service configurations from tracewatch.json
 * @param {Function} onLogEvent - Callback function triggered whenever a clean log line is captured
 * @returns {Array<Object>} Active running process objects
 */

export function spawnServices(services, onLogEvent) {
  const activeProcesses = [];
  let isShuttingDown = false;

  services.forEach((service) => {
    if (!service || !service.command) return;

    let portConflict = false;
    const workingDir = service.cwd
      ? path.resolve(process.cwd(), service.cwd)
      : process.cwd();

    // Spawn the service inside a system shell to support cross-platform path resolution and pipelines
    const childProcess = spawn(service.command, {
      shell: true,
      cwd: workingDir,
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    activeProcesses.push({ service, process: childProcess });

    // Wrap standard output stream with readline for precise line-by-line streaming
    if (childProcess.stdout) {
      const stdoutReader = readline.createInterface({
        input: childProcess.stdout,
      });
      stdoutReader.on('line', (line) => {
        if (isPortConflict(line)) {
          portConflict = true;
        }
        onLogEvent({
          service: service.name,
          stream: 'stdout',
          text: line,
          color: service.color,
        });
      });
    }

    // Wrap error output stream to catch crash trace instantly
    if (childProcess.stderr) {
      const stderrReader = readline.createInterface({
        input: childProcess.stderr,
      });
      stderrReader.on('line', (line) => {
        if (isPortConflict(line)) {
          portConflict = true;
        }
        onLogEvent({
          service: service.name,
          stream: 'stderr',
          text: line,
          color: 'red',
        });
      });
    }

    // Handle sudden internal process crashes or standard exit behaviours
    childProcess.on('close', (code) => {
      if (isShuttingDown) return;

      if (code !== 0 && code !== null) {
        if (portConflict) {
          console.log(
            pc.yellow(
              `\n⚠️  Service [${service.name}] could not start because its port is already in use.`,
            ),
          );
          console.log(
            pc.gray(
              '   An existing process may still be serving it; stop that process or change its port before restarting it.',
            ),
          );
        } else {
          console.log(
            pc.red(
              `\n❌ Service [${service.name}] crashed or closed unexpectedly with code ${code}.`,
            ),
          );
        }
      }
    });
  });

  // Implement graceful shutdown on SIGINT (Ctrl+C) to terminate all child processes on exit
  const cleanup = () => {
    isShuttingDown = true;
    activeProcesses.forEach(({ process: p }) => {
      if (!p.killed) {
        try {
          p.kill('SIGINT');
        } catch (err) {
          // process already terminated safely, ignore the error
        }
      }
    });
    process.exit(0);
  };

  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  return activeProcesses;
}
