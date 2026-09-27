import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseLogLine } from '../src/parsers/index.js';
import { renderToConsole, formatEvidenceLine } from '../src/render.js';
import { parseGeminiResponse, inferStackWithAI } from '../src/analyze-ai.js';
import { handleExplain } from '../src/commands/explain.js';
import {
  detectLocalStack,
  detectPackageManager,
  resolveNodeScript,
  resolveNodeCommand,
  formatPackageManagerCommand,
} from '../src/config.js';

test('parseLogLine prioritizes fatal and error levels over info', () => {
  assert.equal(parseLogLine('fatal: database connection lost').level, 'fatal');
  assert.equal(parseLogLine('error: request failed').level, 'error');
  assert.equal(parseLogLine('warn: retrying request').level, 'warn');
});

test('renderToConsole does not crash on a normal log event', () => {
  assert.doesNotThrow(() => {
    renderToConsole(
      {
        timestamp: '2026-09-18T12:00:00.000Z',
        service: 'api',
        level: 'error',
        message: 'request failed',
        requestId: 'req-123',
      },
      'red',
    );
  });
});

test('parseGeminiResponse reads the actual Gemini payload format', () => {
  const payload = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: '{"cause":"DB pool exhausted","confidence":0.92,"rule":"pool-exhausted","evidence":["FATAL: sorry, too many clients already"],"fix":"Increase the pool max size."}',
            },
          ],
        },
      },
    ],
  };

  assert.deepEqual(parseGeminiResponse(payload), {
    cause: 'DB pool exhausted',
    confidence: 0.92,
    rule: 'pool-exhausted',
    evidence: ['FATAL: sorry, too many clients already'],
    fix: 'Increase the pool max size.',
  });
});

test('handleExplain can resolve a no-rule fallback with AI and no crash', async () => {
  const originalCwd = process.cwd();
  const originalKey = process.env.GEMINI_API_KEY;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracewatch-'));
  const sessionPath = path.join(tempDir, '.tracewatch-session.jsonl');

  fs.writeFileSync(
    sessionPath,
    JSON.stringify({
      id: 'evt_1',
      timestamp: '2026-09-18T12:00:00.000Z',
      service: 'api',
      level: 'info',
      message: 'boot completed',
      requestId: null,
    }) + '\n',
  );

  process.chdir(tempDir);
  delete process.env.GEMINI_API_KEY;

  try {
    await assert.doesNotReject(async () => {
      await handleExplain();
    });
  } finally {
    process.chdir(originalCwd);
    if (originalKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalKey;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('formatEvidenceLine renders AI evidence strings without crashing', () => {
  const text = '[09:42:00] [API] [ERROR] request failed';
  const rendered = formatEvidenceLine(text);

  assert.equal(typeof rendered, 'string');
  assert.match(rendered, /request failed/);
});

test('detectLocalStack discovers services in frontend and backend folders', () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracewatch-stack-'));

  fs.mkdirSync(path.join(tempDir, 'frontend'));
  fs.mkdirSync(path.join(tempDir, 'backend'));
  fs.writeFileSync(
    path.join(tempDir, 'frontend', 'package.json'),
    JSON.stringify({
      scripts: { dev: 'npm run dev' },
      dependencies: { vite: '^6.0.0' },
    }),
  );
  fs.writeFileSync(
    path.join(tempDir, 'backend', 'package.json'),
    JSON.stringify({
      scripts: { start: 'node server.js' },
      dependencies: { express: '^5.0.0' },
    }),
  );

  process.chdir(tempDir);
  try {
    const services = detectLocalStack();
    assert.deepEqual(
      services.map(({ name, command, cwd }) => ({ name, command, cwd })),
      [
        { name: 'backend', command: 'npm start', cwd: 'backend' },
        { name: 'frontend', command: 'npm run dev', cwd: 'frontend' },
      ],
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('correlateEvents preserves a single loose event without dropping it', async () => {
  const { correlateEvents } = await import('../src/correlate.js');
  const event = {
    id: 'evt_1',
    timestamp: '2026-09-23T12:00:00.000Z',
    service: 'api',
    level: 'error',
    message: 'Unhandled server error',
    requestId: null,
  };

  const traces = correlateEvents([event]);
  assert.equal(traces.length, 1);
  assert.equal(traces[0].events.length, 1);
  assert.equal(traces[0].events[0].id, 'evt_1');
});

test('correlateEvents clusters loose events occurring within time gap', async () => {
  const { correlateEvents } = await import('../src/correlate.js');
  const events = [
    {
      id: 'evt_1',
      timestamp: '2026-09-23T12:00:00.000Z',
      service: 'web',
      level: 'info',
      message: 'outgoing request',
      requestId: null,
    },
    {
      id: 'evt_2',
      timestamp: '2026-09-23T12:00:00.500Z',
      service: 'api',
      level: 'error',
      message: 'connection failed',
      requestId: null,
    },
    {
      id: 'evt_3',
      timestamp: '2026-09-23T12:00:05.000Z',
      service: 'web',
      level: 'info',
      message: 'subsequent action',
      requestId: null,
    },
  ];

  const traces = correlateEvents(events);
  assert.equal(traces.length, 2);
});

test('redactSecrets sanitizes tokens, passwords, and database URIs', async () => {
  const { redactSecrets } = await import('../src/commands/export.js');
  const raw =
    'Authorization: Bearer secret_jwt_token_123456; password=mySuperSecret123; connect to postgres://admin:super_secret@localhost:5432/app_db';
  const sanitized = redactSecrets(raw);

  assert.doesNotMatch(sanitized, /secret_jwt_token_123456/);
  assert.doesNotMatch(sanitized, /mySuperSecret123/);
  assert.doesNotMatch(sanitized, /super_secret/);
  assert.match(sanitized, /\[REDACTED\]/);
  assert.match(sanitized, /\[USER\]:\[PASSWORD\]/);
});

test('detectLocalStack discovers services inside monorepo apps folder', () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracewatch-mono-'));

  fs.mkdirSync(path.join(tempDir, 'apps', 'web'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'apps', 'api'), { recursive: true });

  fs.writeFileSync(
    path.join(tempDir, 'apps', 'web', 'package.json'),
    JSON.stringify({
      scripts: { dev: 'next dev' },
      dependencies: { next: '^14.0.0' },
    }),
  );
  fs.writeFileSync(
    path.join(tempDir, 'apps', 'api', 'package.json'),
    JSON.stringify({
      scripts: { start: 'node main.js' },
      dependencies: { fastify: '^4.0.0' },
    }),
  );

  process.chdir(tempDir);
  try {
    const services = detectLocalStack();
    const serviceMap = services.map(({ name, command, cwd }) => ({
      name,
      command,
      cwd,
    }));

    assert.deepEqual(serviceMap, [
      { name: 'api', command: 'npm start', cwd: 'apps/api' },
      { name: 'web', command: 'npm run dev', cwd: 'apps/web' },
    ]);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('extractPort accurately parses configured, env, command, and framework ports', async () => {
  const { extractPort } = await import('../src/ports.js');

  // Explicit port property
  assert.equal(extractPort({ port: 4000 }), 4000);
  assert.equal(extractPort({ port: '4000' }), 4000);

  // Environment variable PORT
  assert.equal(extractPort({ env: { PORT: '5001' } }), 5001);

  // Command string containing PORT=
  assert.equal(extractPort({ command: 'PORT=3005 nodemon index.js' }), 3005);

  // Command string containing --port
  assert.equal(extractPort({ command: 'vite --port 5174' }), 5174);
  assert.equal(extractPort({ command: 'uvicorn main:app --port=8080' }), 8080);

  // Framework inference
  assert.equal(extractPort({ framework: 'Vite' }), 5173);
  assert.equal(extractPort({ framework: 'Express' }), 3000);
  assert.equal(extractPort({ framework: 'FastAPI' }), 8000);
  assert.equal(extractPort({ framework: 'Flask' }), 5000);
});

test('extractPortFromError accurately identifies port conflict signatures', async () => {
  const { extractPortFromError } = await import('../src/ports.js');

  assert.equal(
    extractPortFromError(
      'Error: listen EADDRINUSE: address already in use 0.0.0.0:3000',
    ),
    3000,
  );
  assert.equal(
    extractPortFromError(
      'Error: listen EADDRINUSE: address already in use :::3000',
    ),
    3000,
  );
  assert.equal(
    extractPortFromError('Port 5173 is in use, trying another one...'),
    5173,
  );
  assert.equal(
    extractPortFromError('port 8080 is already in use'),
    8080,
  );
  assert.equal(
    extractPortFromError('Random unrelated log message'),
    null,
  );
});

test('isPortInUse accurately identifies active and inactive ports', async () => {
  const net = await import('node:net');
  const { isPortInUse } = await import('../src/ports.js');

  // Find a free port by listening on 0
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const assignedPort = server.address().port;

  try {
    // Should be in use while server is open
    const inUse = await isPortInUse(assignedPort);
    assert.equal(inUse, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // After closing, port should no longer be in use
  const freed = await isPortInUse(assignedPort);
  assert.equal(freed, false);
});

test('freePort terminates external processes holding a port', async () => {
  const { spawn } = await import('node:child_process');
  const readline = await import('node:readline');
  const { isPortInUse, freePort, getPortPids } = await import(
    '../src/ports.js'
  );

  // Spawn an external node process listening on an arbitrary available port
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
      const http = require('http');
      const server = http.createServer((req, res) => res.end('ok'));
      server.listen(0, '127.0.0.1', () => {
        console.log(server.address().port);
      });
      // Keep running
      setInterval(() => {}, 1000);
    `,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );

  const reader = readline.createInterface({ input: child.stdout });
  const port = await new Promise((resolve) => {
    reader.once('line', (line) => resolve(Number(line.trim())));
  });

  try {
    assert.equal(await isPortInUse(port), true);
    assert.ok(getPortPids(port).includes(child.pid));

    // Call freePort to eliminate the child process
    const killed = freePort(port);
    assert.ok(killed.includes(child.pid));

    // Verify process is no longer registered to the port
    assert.equal(getPortPids(port).length, 0);
  } finally {
    try {
      child.kill('SIGKILL');
    } catch {}
  }
});

test('detectPackageManager identifies pnpm, yarn, bun, npm, and packageManager field', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracewatch-pm-'));
  try {
    // Default when no files present
    assert.equal(detectPackageManager(tempDir), 'npm');

    // pnpm lockfile
    fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '');
    assert.equal(detectPackageManager(tempDir), 'pnpm');
    fs.rmSync(path.join(tempDir, 'pnpm-lock.yaml'));

    // yarn lockfile
    fs.writeFileSync(path.join(tempDir, 'yarn.lock'), '');
    assert.equal(detectPackageManager(tempDir), 'yarn');
    fs.rmSync(path.join(tempDir, 'yarn.lock'));

    // bun lockfile
    fs.writeFileSync(path.join(tempDir, 'bun.lockb'), '');
    assert.equal(detectPackageManager(tempDir), 'bun');
    fs.rmSync(path.join(tempDir, 'bun.lockb'));

    // package.json packageManager field
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@9.5.0' }),
    );
    assert.equal(detectPackageManager(tempDir), 'pnpm');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resolveNodeScript resolves start/pure, start/dev, start:dev, dev:*, and fallbacks', () => {
  assert.equal(resolveNodeScript({ 'start/pure': 'node server.js' }), 'start/pure');
  assert.equal(resolveNodeScript({ 'start:pure': 'node server.js' }), 'start:pure');
  assert.equal(resolveNodeScript({ 'start/dev': 'nodemon server.js' }), 'start/dev');
  assert.equal(resolveNodeScript({ 'start:dev': 'nest start --watch' }), 'start:dev');
  assert.equal(resolveNodeScript({ 'dev:all': 'concurrently "..."' }), 'dev:all');
  assert.equal(resolveNodeScript({ serve: 'node app.js' }), 'serve');
  assert.equal(resolveNodeScript({ start: 'node index.js' }), 'start');
  assert.equal(resolveNodeScript({ dev: 'vite' }), 'dev');
  assert.equal(resolveNodeScript({}), null);
});

test('resolveNodeCommand formats command with pnpm, yarn, bun, and falls back to server.js', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracewatch-cmd-'));
  try {
    // pnpm with start/pure
    assert.equal(
      resolveNodeCommand({ scripts: { 'start/pure': 'node server.js' } }, 'pnpm', tempDir),
      'pnpm run start/pure',
    );

    // pnpm with start
    assert.equal(
      resolveNodeCommand({ scripts: { start: 'node server.js' } }, 'pnpm', tempDir),
      'pnpm start',
    );

    // yarn with start/dev
    assert.equal(
      resolveNodeCommand({ scripts: { 'start/dev': 'nodemon server.js' } }, 'yarn', tempDir),
      'yarn run start/dev',
    );

    // bun with dev
    assert.equal(
      resolveNodeCommand({ scripts: { dev: 'bun run index.ts' } }, 'bun', tempDir),
      'bun run dev',
    );

    // Fallback to server.js when no scripts defined
    fs.writeFileSync(path.join(tempDir, 'server.js'), 'console.log("running");');
    assert.equal(
      resolveNodeCommand({ scripts: {} }, 'npm', tempDir),
      'node server.js',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('detectLocalStack discovers 3 folders with pnpm, start/pure, and start/dev without standard express/start', () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracewatch-mentor-'));

  // Monorepo root has pnpm-lock.yaml and 3 distinct folders: backend, frontend, worker
  fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '');
  fs.mkdirSync(path.join(tempDir, 'backend'));
  fs.mkdirSync(path.join(tempDir, 'frontend'));
  fs.mkdirSync(path.join(tempDir, 'worker'));

  // Backend: has server.js, start/pure script, non-standard dependencies (e.g. cors, dotenv)
  fs.writeFileSync(path.join(tempDir, 'backend', 'server.js'), 'console.log("backend");');
  fs.writeFileSync(
    path.join(tempDir, 'backend', 'package.json'),
    JSON.stringify({
      scripts: { 'start/pure': 'node server.js' },
      dependencies: { dotenv: '^16.0.0' },
    }),
  );

  // Frontend: has start/dev script and vite
  fs.writeFileSync(
    path.join(tempDir, 'frontend', 'package.json'),
    JSON.stringify({
      scripts: { 'start/dev': 'vite' },
      dependencies: { vite: '^5.0.0' },
    }),
  );

  // Worker: has dev script
  fs.writeFileSync(
    path.join(tempDir, 'worker', 'package.json'),
    JSON.stringify({
      scripts: { dev: 'node worker.js' },
      dependencies: { redis: '^4.0.0' },
    }),
  );

  process.chdir(tempDir);
  try {
    const services = detectLocalStack();
    const serviceSummary = services.map(({ name, command, cwd, type }) => ({
      name,
      command,
      cwd,
      type,
    }));

    assert.deepEqual(serviceSummary, [
      { name: 'backend', command: 'pnpm run start/pure', cwd: 'backend', type: 'backend' },
      { name: 'frontend', command: 'pnpm run start/dev', cwd: 'frontend', type: 'frontend' },
      { name: 'worker', command: 'pnpm run dev', cwd: 'worker', type: 'backend' },
    ]);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('inferStackWithAI handles missing API key safely without throwing', async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const res = await inferStackWithAI(process.cwd());
    assert.equal(res.success, false);
    assert.match(res.message, /GEMINI_API_KEY/);
  } finally {
    if (originalKey !== undefined) {
      process.env.GEMINI_API_KEY = originalKey;
    }
  }
});

test('detectLocalStack does not include arbitrary dummy port values on services', () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracewatch-no-port-'));

  fs.mkdirSync(path.join(tempDir, 'backend'));
  fs.writeFileSync(
    path.join(tempDir, 'backend', 'package.json'),
    JSON.stringify({
      scripts: { start: 'node server.js' },
      dependencies: { express: '^4.18.0' },
    }),
  );

  process.chdir(tempDir);
  try {
    const services = detectLocalStack();
    assert.equal(services.length, 1);
    assert.equal(services[0].port, undefined);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});





