import { spawn, execSync } from 'child_process';
import readline from 'readline';
import path from 'path';
import pc from 'picocolors';
import { extractPortFromError, freePort } from './ports.js';

function isPortConflict(line) {
  return /eaddrinuse|address already in use|port\s+\d+\s+is already in use|port.*in use/i.test(
    line,
  );
}

function terminateProcessGroup(childProcess, signal = 'SIGINT') {
  if (!childProcess || childProcess.killed || !childProcess.pid) return;

  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${childProcess.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // Process already terminated
    }
    return;
  }

  try {
    // On POSIX, a negative PID targets the entire process group
    process.kill(-childProcess.pid, signal);
  } catch (err) {
    try {
      childProcess.kill(signal);
    } catch {
      // Process already terminated
    }
  }
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
  const isPosix = process.platform !== 'win32';

  services.forEach((service) => {
    if (!service || !service.command) return;

    let portConflict = false;
    let detectedConflictPort = null;
    const workingDir = service.cwd
      ? path.resolve(process.cwd(), service.cwd)
      : process.cwd();

    // Spawn the service inside its own process group (detached on POSIX)
    // so that shutdown signals reach all child processes (npm -> nodemon -> node)
    const childProcess = spawn(service.command, {
      shell: true,
      cwd: workingDir,
      detached: isPosix,
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    activeProcesses.push({ service, process: childProcess });

    childProcess.on('error', (err) => {
      console.log(
        pc.red(`\n❌ Failed to spawn [${service.name}]: ${err.message}`),
      );
    });

    // Wrap standard output stream with readline for precise line-by-line streaming
    if (childProcess.stdout) {
      const stdoutReader = readline.createInterface({
        input: childProcess.stdout,
      });
      stdoutReader.on('line', (line) => {
        if (isPortConflict(line)) {
          portConflict = true;
          const parsed = extractPortFromError(line);
          if (parsed) detectedConflictPort = parsed;
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
          const parsed = extractPortFromError(line);
          if (parsed) detectedConflictPort = parsed;
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
          const portMsg = detectedConflictPort
            ? `port ${pc.bold(detectedConflictPort)}`
            : 'its port';
          console.log(
            pc.yellow(
              `\n⚠️  Service [${service.name}] could not start because ${portMsg} is already in use.`,
            ),
          );
          if (detectedConflictPort) {
            try {
              const freed = freePort(detectedConflictPort);
              if (freed.length > 0) {
                console.log(
                  pc.green(
                    `   ⚡ Automatically freed port ${detectedConflictPort} (terminated PID ${freed.join(', ')}). Restarting will now succeed.`,
                  ),
                );
              } else {
                console.log(
                  pc.cyan(
                    `   Fix: Run "tracewatch start" or kill it manually with "lsof -ti:${detectedConflictPort} | xargs kill -9"`,
                  ),
                );
              }
            } catch {
              console.log(
                pc.cyan(
                  `   Fix: Run "tracewatch start" or kill it manually with "lsof -ti:${detectedConflictPort} | xargs kill -9"`,
                ),
              );
            }
          } else {
            console.log(
              pc.gray(
                '   An existing process was occupying the port; TraceWatch auto-frees ports on next start.',
              ),
            );
          }
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

  // Implement graceful shutdown on SIGINT (Ctrl+C) to terminate all child processes and descendants
  const cleanup = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    activeProcesses.forEach(({ process: p }) => {
      terminateProcessGroup(p, 'SIGINT');
    });

    // Provide a brief window for graceful socket closing, then kill any lingering processes
    setTimeout(() => {
      activeProcesses.forEach(({ process: p }) => {
        terminateProcessGroup(p, 'SIGKILL');
      });
      process.exit(0);
    }, 250).unref();
  };

  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  return activeProcesses;
}
