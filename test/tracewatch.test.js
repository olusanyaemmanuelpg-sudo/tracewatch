import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLogLine } from '../src/parsers/index.js';
import { renderToConsole } from '../src/render.js';

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
