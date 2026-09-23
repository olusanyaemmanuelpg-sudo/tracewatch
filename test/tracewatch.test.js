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
