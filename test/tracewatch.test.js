import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseLogLine } from '../src/parsers/index.js';
import { renderToConsole, formatEvidenceLine } from '../src/render.js';
import { parseGeminiResponse } from '../src/analyze-ai.js';
import { handleExplain } from '../src/commands/explain.js';
import { detectLocalStack } from '../src/config.js';

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

