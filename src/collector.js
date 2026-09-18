import { spawn } from 'child_process';
import readline from 'readline';
import pc from 'picocolors';

/**
 * Spawns and manages a group of configured local application services.
 * @param {Array<Object>} services - Array of service configurations from tracewatch.json
 * @param {Function} onLogEvent - Callback function triggered whenever a clean log line is captured
 * @returns {Array<Object>} Active running process objects
 */

export function spawnServices(services, onLogEvent) {
  const activeProcesses = [];

  services.forEach((service) => {
    const [cmd, ...arg] = service.command.split(' ');

    // Spawn the service inside a system shell to support cross-platform path resolution
    const childProcess = spawn(cmd, arg, {
      shell: true,
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    activeProcesses.push({ service, process: childProcess });

    //Wrap standard output stream with readline for precise line-by-line streaming

    if (childProcess.stdout) {
      const stdoutReader = readline.createInterface({
        input: childProcess.stdout,
      });
      stdoutReader.on('line', (line) => {
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
        onLogEvent({
          service: service.name,
          stream: 'stderr',
          text: line,
          color: pc.red,
        });
      });
    }

    //Handle sudden internal process craches or standard exit behaviours
    childProcess.on('close', (code) => {
      if (code !== 0 && code !== null) {
        console.log(
          pc.red(
            `\n❌ Service [${service.name}] crashed or closed unexpectedly with code ${code}.`,
          ),
        );
      }
    });

    // Implement graceful shutdown on SIGINT (Ctrl+C) to terminate all child processes on exit
    const cleanup = () => {
      activeProcesses.forEach(({ name, process: p }) => {
        if (!p.killed) {
          try {
            p.kill('SIGINT');
          } catch (err) {
            //process already terminated safely, ignore the error
          }
        }
      });
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });

  return activeProcesses;
}
