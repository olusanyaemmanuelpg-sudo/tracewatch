import net from 'net';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Checks whether a given TCP port is currently occupied.
 * @param {number} port - The port number to verify
 * @param {string} host - Optional host (default: '0.0.0.0' to check all interfaces)
 * @returns {Promise<boolean>} True if the port is in use, false otherwise
 */
export function isPortInUse(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    if (!port || isNaN(Number(port))) {
      return resolve(false);
    }

    const server = net.createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        resolve(true);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close(() => resolve(false));
    });

    try {
      server.listen(Number(port), host);
    } catch {
      resolve(true);
    }
  });
}

/**
 * Discovers the Process IDs (PIDs) holding a specific port.
 * @param {number} port - Port number
 * @returns {Array<number>} Array of PIDs
 */
export function getPortPids(port) {
  const pids = new Set();
  if (!port || isNaN(Number(port))) return [];

  const numericPort = Number(port);

  if (process.platform === 'win32') {
    try {
      const output = execSync(`netstat -ano | findstr :${numericPort}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const lines = output.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (pid && !isNaN(pid) && pid > 0 && pid !== process.pid) {
          pids.add(pid);
        }
      }
    } catch {
      // No process found
    }
  } else {
    // POSIX: try lsof first
    try {
      const output = execSync(`lsof -ti :${numericPort}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      output
        .trim()
        .split('\n')
        .forEach((line) => {
          const pid = Number(line.trim());
          if (pid && !isNaN(pid) && pid !== process.pid) {
            pids.add(pid);
          }
        });
    } catch {
      // If lsof fails or is absent, attempt fuser fallback
      try {
        const output = execSync(`fuser ${numericPort}/tcp 2>/dev/null`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        output
          .trim()
          .split(/\s+/)
          .forEach((chunk) => {
            const pid = Number(chunk.trim());
            if (pid && !isNaN(pid) && pid !== process.pid) {
              pids.add(pid);
            }
          });
      } catch {
        // No process found or tools unavailable
      }
    }
  }

  return Array.from(pids);
}

/**
 * Terminates any process currently bound to the target port.
 * @param {number} port - Port to clear
 * @returns {Array<number>} PIDs of processes terminated
 */
export function freePort(port) {
  const pids = getPortPids(port);
  if (pids.length === 0) return [];

  const killedPids = [];
  for (const pid of pids) {
    if (pid === process.pid) continue;
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } else {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // Already stopped
        }
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already stopped
        }
      }
      killedPids.push(pid);
    } catch {
      // Process may have already exited
    }
  }
  return killedPids;
}

/**
 * Extracts or infers the target port from a service configuration.
 * @param {Object} service - Service config object
 * @returns {number|null} Port number or null if undetermined
 */
export function extractPort(service) {
  if (!service) return null;

  if (service.port && !isNaN(Number(service.port))) {
    return Number(service.port);
  }

  if (service.env && service.env.PORT && !isNaN(Number(service.env.PORT))) {
    return Number(service.env.PORT);
  }

  if (typeof service.command === 'string') {
    // Matches PORT=1234
    const envMatch = service.command.match(/\bPORT=(\d+)\b/i);
    if (envMatch) return Number(envMatch[1]);

    // Matches --port 1234, --port=1234, -p 1234
    const portFlagMatch = service.command.match(
      /(?:--port[=\s]+|-p\s+)(\d+)\b/i,
    );
    if (portFlagMatch) return Number(portFlagMatch[1]);
  }

  if (service.framework) {
    const fw = String(service.framework).toLowerCase();
    if (fw.includes('vite')) return 5173;
    if (
      fw.includes('express') ||
      fw.includes('next') ||
      fw.includes('react') ||
      fw.includes('nest') ||
      fw.includes('fastify') ||
      fw.includes('koa')
    ) {
      return 3000;
    }
    if (fw.includes('fastapi') || fw.includes('django')) return 8000;
    if (fw.includes('flask')) return 5000;
  }

  // Inspect service.cwd package.json if present
  if (service.cwd) {
    try {
      const cwdPath = path.resolve(process.cwd(), service.cwd);
      const pkgPath = path.join(cwdPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
        };
        if (deps.vite) return 5173;
        if (deps.next) return 3000;
        if (
          deps.express ||
          deps.koa ||
          deps.fastify ||
          deps['@nestjs/core']
        ) {
          return 3000;
        }
      }
    } catch {
      // Ignore reading error
    }
  }

  // Fallback by service name convention
  if (service.name) {
    const name = String(service.name).toLowerCase();
    if (
      name.includes('vite') ||
      name.includes('front') ||
      name.includes('client') ||
      name.includes('web') ||
      name.includes('ui')
    ) {
      return 5173;
    }
    if (
      name.includes('back') ||
      name.includes('api') ||
      name.includes('server')
    ) {
      return 3000;
    }
  }

  return null;
}

/**
 * Parses an error string to detect port conflict signatures and extract the port number.
 * @param {string} line - Log line text
 * @returns {number|null} Port number if found, or null
 */
export function extractPortFromError(line) {
  if (typeof line !== 'string') return null;

  // Handles:
  // "listen EADDRINUSE: address already in use 0.0.0.0:3000"
  // "listen EADDRINUSE: address already in use :::3000"
  // "listen EADDRINUSE: address already in use 127.0.0.1:3000"
  // "Port 5173 is in use"
  // "Port 3000 is already in use"
  const patterns = [
    /address already in use.*?[:\s](\d{2,5})\b/i,
    /eaddrinuse.*?[:\s](\d{2,5})\b/i,
    /port\s+(\d{2,5})\s+(?:is\s+)?already\s+in\s+use/i,
    /port\s+(\d{2,5})\s+is\s+in\s+use/i,
    /:(\d{2,5})\b.*?(?:in use|already in use|eaddrinuse)/i,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match && match[1]) {
      const port = Number(match[1]);
      if (port > 0 && port <= 65535) {
        return port;
      }
    }
  }

  return null;
}
