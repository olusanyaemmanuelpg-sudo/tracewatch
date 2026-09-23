import { userFrame } from '../parsers/index.js';
import { isFailure } from '../types.js';

const first = (trace, re) => trace.events.find((e) => re.test(e.message));

const connectionRefused = {
  id: 'connection-refused',
  run(trace) {
    const hit = first(
      trace,
      /ECONNREFUSED|connection refused|could not connect to server/i,
    );
    if (!hit) return null;
    const target =
      /(?:ECONNREFUSED\s+)?(\d{1,3}(?:\.\d{1,3}){3}|localhost|127\.0\.0\.1)[:\s]+(\d{2,5})/i.exec(
        hit.message,
      );
    const where = target ? `${target[1]}:${target[2]}` : 'the dependency';
    return {
      rule: this.id,
      cause: `${hit.service} could not reach ${where} — nothing is listening there.`,
      confidence: 0.95,
      evidence: [hit],
      fix: `Start the service on ${where}, or check the host and port in your env config.`,
    };
  },
};

const poolExhausted = {
  id: 'pool-exhausted',
  run(trace) {
    const clientSide = first(
      trace,
      /connection pool|pool (?:is )?exhausted|ConnectionAcquireTimeout|timeout acquiring|pool timeout/i,
    );
    const serverSide = first(
      trace,
      /too many clients|remaining connection slots|max_connections|too many connections/i,
    );
    if (!clientSide && !serverSide) return null;
    const blamed = clientSide ?? serverSide;
    const evidence = [clientSide, serverSide].filter(Boolean);
    const both = Boolean(clientSide && serverSide);
    const concurrent = new Set(
      trace.events.filter((e) => e.requestId).map((e) => e.requestId),
    ).size;
    return {
      rule: this.id,
      cause: both
        ? `${blamed.service} could not get a database connection — the database is out of free slots.`
        : `${blamed.service} ran out of database connections.`,
      confidence: both ? 0.95 : 0.88,
      evidence,
      fix:
        concurrent > 2
          ? `${concurrent} requests were in flight here. Raise the pool max, or find the query path that never releases its connection.`
          : 'Only a couple of requests were in flight, so this looks like a leak rather than load. Check that every acquired connection is released, including on the error path.',
    };
  },
};

const pendingMigration = {
  id: 'pending-migration',
  run(trace) {
    const hit = first(
      trace,
      /column .* does not exist|relation .* does not exist|no such table|Unknown column|undefined table/i,
    );
    if (!hit) return null;
    const name = /"([^"]+)"|column ([\w.]+)/i.exec(hit.message);
    return {
      rule: this.id,
      cause: `The database is missing ${name ? `"${name[1] || name[2]}"` : 'a table or column'} that the code expects.`,
      confidence: 0.92,
      evidence: [hit],
      fix: 'Run your pending migrations. The code is ahead of the schema.',
    };
  },
};

const portInUse = {
  id: 'port-in-use',
  run(trace) {
    const hit = first(
      trace,
      /EADDRINUSE|address already in use|port \d+ is already/i,
    );
    if (!hit) return null;
    const port = /:(\d{2,5})\b|port (\d{2,5})/i.exec(hit.message);
    const p = port ? port[1] || port[2] : 'that port';
    return {
      rule: this.id,
      cause: `${hit.service} could not bind to port ${p} — another process already holds it.`,
      confidence: 0.97,
      evidence: [hit],
      fix: `Run \`lsof -ti:${p} | xargs kill\` or start on a different port.`,
    };
  },
};

const corsBlocked = {
  id: 'cors',
  run(trace) {
    const hit = first(trace, /CORS|Access-Control-Allow-Origin|cross-origin/i);
    if (!hit) return null;
    return {
      rule: this.id,
      cause:
        'The browser blocked the response because the API did not allow this origin.',
      confidence: 0.85,
      evidence: [hit],
      fix: 'Add the frontend origin to your CORS allowlist on the API, and allow credentials if you send cookies.',
    };
  },
};

const upstreamTimeout = {
  id: 'upstream-timeout',
  run(trace) {
    const hit = first(
      trace,
      /ETIMEDOUT|timed? ?out|deadline exceeded|socket hang up/i,
    );
    if (!hit) return null;
    const slow = trace.events.filter((e) => (e.durationMs ?? 0) > 1000);
    return {
      rule: this.id,
      cause: `${hit.service} gave up waiting on a slower dependency.`,
      confidence: slow.length ? 0.8 : 0.6,
      evidence: slow.length ? [slow[slow.length - 1], hit] : [hit],
      fix: 'The dependency is slow, not down. Look at what it was doing during the window before raising the timeout.',
    };
  },
};

const missingEnv = {
  id: 'missing-env',
  run(trace) {
    const hit = first(
      trace,
      /(?:env(?:ironment)?[ _]?var\w*|process\.env\.[A-Z_]+)[^\n]*(?:undefined|missing|not set|required)|Missing required environment/i,
    );
    if (!hit) return null;
    const name = /\b([A-Z][A-Z0-9_]{3,})\b/.exec(hit.message);
    return {
      rule: this.id,
      cause: `${name ? `${name[1]} is not set` : 'A required environment variable is not set'} in ${hit.service}.`,
      confidence: 0.85,
      evidence: [hit],
      fix: 'Add it to .env and confirm the process actually loads that file.',
    };
  },
};

const authExpired = {
  id: 'auth-expired',
  run(trace) {
    const unauthorized = trace.events.filter(
      (e) => e.statusCode === 401 || e.statusCode === 403,
    );
    const expiry = first(
      trace,
      /jwt expired|token (?:has )?expired|invalid signature|TokenExpiredError/i,
    );
    if (!expiry && unauthorized.length < 2) return null;
    return {
      rule: this.id,
      cause: expiry
        ? 'The request carried an expired token, so auth rejected it.'
        : `${unauthorized.length} requests were rejected as unauthorized in this window.`,
      confidence: expiry ? 0.88 : 0.55,
      evidence: expiry
        ? [expiry, ...unauthorized.slice(0, 2)]
        : unauthorized.slice(0, 3),
      fix: 'Refresh the token rather than debugging the auth middleware.',
    };
  },
};

const rateLimited = {
  id: 'rate-limited',
  run(trace) {
    const hits = trace.events.filter(
      (e) =>
        e.statusCode === 429 || /rate limit|too many requests/i.test(e.message),
    );
    if (hits.length === 0) return null;
    return {
      rule: this.id,
      cause:
        'An upstream service rate limited this request, and the failure cascaded from there.',
      confidence: 0.86,
      evidence: hits.slice(0, 2),
      fix: 'Back off and retry, or cache the upstream response. The error downstream is a symptom.',
    };
  },
};

const undefinedAccess = {
  id: 'undefined-access',
  run(trace) {
    const hit = first(
      trace,
      /Cannot read (?:property|properties) .* of (?:undefined|null)|is not a function|is not defined|NoneType|AttributeError/i,
    );
    if (!hit) return null;
    const index = trace.events.indexOf(hit);
    const frames = trace.events
      .slice(index, index + 12)
      .flatMap((e) => e.stack || []);
    const frame = userFrame(frames);
    const prop = /(?:property|properties) '([^']+)'/i.exec(hit.message);
    return {
      rule: this.id,
      cause: `${hit.service} read ${prop ? `"${prop[1]}"` : 'a property'} off a value that was undefined.`,
      confidence: frame ? 0.8 : 0.65,
      evidence: [hit],
      fix: frame
        ? `First frame in your own code: ${frame}`
        : 'Trace back to where that value is assigned — it is usually an unchecked response body.',
    };
  },
};

const fallback = {
  id: 'fallback',
  run(trace) {
    const failures = trace.events.filter(isFailure);
    if (failures.length === 0) return null;
    const worst = failures[failures.length - 1];
    return {
      rule: this.id,
      cause: `No rule matched. The first failure in this window came from ${worst.service}.`,
      confidence: 0.3,
      evidence: failures.slice(0, 3),
      fix: 'Run with --verbose to see the full window, or open an issue with the exported report.',
    };
  },
};

export const RULES = [
  connectionRefused,
  poolExhausted,
  pendingMigration,
  portInUse,
  corsBlocked,
  upstreamTimeout,
  missingEnv,
  authExpired,
  rateLimited,
  undefinedAccess,
  fallback,
];

export const activeRules = RULES;
