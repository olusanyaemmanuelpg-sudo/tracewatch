/**
 * RULE: Database Connection Pool Exhaustion Filter
 * Triggers when a backend microservice fails because the database is out of free connections.
 */

export const poolExhausted = {
  id: 'pool-exhausted',
  run(trace) {
    // Scan all log lines inside this trace for common database pool exhaustion messages
    const errorLine = trace.events.find((e) =>
      /too many clients already|pool-exhausted|timeout acquiring a connection|ConnectionAcquireTimeout/i.test(
        e.message,
      ),
    );

    if (!errorLine) return null;

    // Deduce our analytical score based on whether the log grouping boundary is highly accurate
    const confidence = trace.explicit ? 0.95 : 0.8;

    return {
      rule: this.id,
      cause: `${errorLine.service} could not acquire a database connection as the database pool is completely exhausted.`,
      confidence,
      evidence: [errorLine],
      fix: 'Increase the pool max size parameter in your database configuration file, or find the missing query path that fails to release its connection client hooks back to the pool.',
    };
  },
};

/**
 * RULE: Host Storage Space Depletion Filter
 * Triggers when a local process crashes because the local hard drive is completely full.
 */

export const diskFull = {
  id: 'disk-full',
  run(trace) {
    const errorLine = trace.events.find((e) =>
      /ENOSPC|no space left on device|disk full|out of space/i.test(e.message),
    );

    if (!errorLine) return null;

    const confidence = trace.explicit ? 0.95 : 0.8;

    return {
      rule: this.id,
      cause: `${errorLine.service} ran out of available disk space on the local volume context.`,
      confidence,
      evidence: [errorLine],
      fix: 'Clear out hidden cache files, prune stopped docker container layers, or free space on your host machine. Nothing in your primary application source code is broken.',
    };
  },
};

/**
 * RULE: Port Conflict Detection
 * Triggers when a service cannot start because another process
 * is already listening on the desired port.
 */

export const portConflict = {
  id: 'port-conflict',

  run(trace) {
    const errorLine = trace.events.find((e) =>
      /EADDRINUSE|address already in use|port .* already in use|listen EADDRINUSE/i.test(
        e.message,
      ),
    );

    if (!errorLine) return null;

    const confidence = trace.explicit ? 0.95 : 0.8;

    return {
      rule: this.id,
      cause: `${errorLine.service} failed to start because the requested network port is already occupied by another process.`,
      confidence,
      evidence: [errorLine],
      fix: 'Stop the process currently using the port, or change the application port configuration. On Linux/macOS use "lsof -i :PORT". On Windows use "netstat -ano" and terminate the conflicting PID.',
    };
  },
};

/**
 * RULE: Database Unreachable
 * Triggers when the application cannot connect to its database.
 */

export const databaseUnavailable = {
  id: 'database-unavailable',

  run(trace) {
    const errorLine = trace.events.find((e) =>
      /ECONNREFUSED|connection refused|could not connect to server|failed to connect to database|database unavailable/i.test(
        e.message,
      ),
    );

    if (!errorLine) return null;

    const confidence = trace.explicit ? 0.95 : 0.8;

    return {
      rule: this.id,
      cause: `${errorLine.service} attempted to connect to a database instance that is unavailable or not accepting connections.`,
      confidence,
      evidence: [errorLine],
      fix: 'Verify the database service is running, check host and port configuration, confirm Docker containers are healthy, and ensure firewall rules are not blocking access.',
    };
  },
};

/**
 * RULE: Missing Environment Variable
 * Triggers when an application fails because a required
 * environment variable is missing or undefined.
 */

export const missingEnvVar = {
  id: 'missing-env-var',

  run(trace) {
    const errorLine = trace.events.find((e) =>
      /missing env|missing environment variable|environment variable .* not defined|required environment variable .* missing|process\.env\.[A-Z0-9_]+.*undefined|undefined environment variable/i.test(
        e.message,
      ),
    );

    if (!errorLine) return null;

    const confidence = trace.explicit ? 0.95 : 0.8;

    // Try to extract the variable name if possible
    const variableMatch = errorLine.message.match(/([A-Z][A-Z0-9_]{2,})/);

    const variableName = variableMatch ? variableMatch[1] : 'unknown variable';

    return {
      rule: this.id,
      cause: `${errorLine.service} attempted to access the environment variable "${variableName}", but it was not defined in the runtime environment.`,
      confidence,
      evidence: [errorLine],
      fix: `Verify that "${variableName}" exists in your .env file, container configuration, CI/CD secrets, or shell environment before starting the service.`,
    };
  },
};

// Central exported listing of all active evaluation rule functions
export const activeRules = [
  poolExhausted,
  diskFull,
  portConflict,
  databaseUnavailable,
  missingEnvVar,
];
