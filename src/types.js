/**
 * TRACEWATCH CORE DATA CONTRACTS (v0.1)
 *
 * This file serves as a reference blueprint for data structures used across
 * collectors, parsers, rule engines, and dashboards.
 */

/**
 * @typedef {Object} LogEvent
 * @property {string} id - Unique KSUID/UUID string identifying this individual log line
 * @property {string} timestamp - High-precision ISO timestamp or format marker (e.g., "12:04:31.204")
 * @property {string} service - Name of the originating project service (e.g., "web", "api", "db")
 * @property {string} level - Log severity level (e.g., "info", "warn", "error", "fatal")
 * @property {string} message - The clean string output content with ANSI color codes stripped out
 * @property {string|null} [requestId] - Extracted correlation identifier from incoming network headers
 */

export function isFailure(event) {
	return event.level === 'error' || event.level === 'fatal';
}

/**
 * @typedef {Object} Trace
 * @property {string} id - The matching correlation identifier or a computed time-cluster ID
 * @property {boolean} explicit - True if grouped by matching IDs; false if grouped by close timestamps
 * @property {LogEvent[]} events - Sorted array of log events grouped under this operational scope
 */

/**
 * @typedef {Object} Finding
 * @property {string} rule - The identifier string of the triggered rule engine (e.g., "pool-exhausted")
 * @property {string} cause - A plain-language sentence mapping out the failure root cause
 * @property {number} confidence - A percentage score between 0.0 and 1.0 reflecting analysis certainty
 * @property {LogEvent[]} evidence - The primary array of log lines that directly proved the breakdown
 * @property {string} fix - Actionable advice explaining how the developer can resolve the issue
 */
