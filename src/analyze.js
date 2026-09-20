import { activeRules } from './rules/index.js';

/**
 * Sweeps over correlated traces to run rule checks, ranks findings, and applies ambient context.
 * @param {import('./types.js').Trace[]} traces - List of correlated traces from the session
 * @param {import('./types.js').LogEvent[]} allEvents - Every sequential event in the EventStore (for enrichment)
 * @returns {import('./types.js').Finding[]} Sorted array of diagnostic findings
 */

export function analyzeTraces(traces, allEvents) {
  /** @type {import('./types.js').Finding[]} */
  const findings = [];

  // 1. Run every pure rule function against every correlated trace timeline
  traces.forEach((trace) => {
    activeRules.forEach((ruleEngine) => {
      try {
        const result = ruleEngine.run(trace);
        if (result) {
          findings.push(result);
        }
      } catch {
        // Prevent a buggy single rule definition from breaking the core execution loop
      }
    });
  });

  // 2. Rank findings by confidence scores (Highest operational certainty floats to index 0)
  findings.sort((a, b) => b.confidence - a.confidence);

  // 3. Ambient Enrichment Phase: Pull in adjacent logs from system-wide boundaries (e.g., db, redis)
  if (findings.length > 0) {
    const topFinding = findings[0];
    const primaryEvidence = topFinding.evidence[0];

    if (primaryEvidence) {
      const errorTime = new Date(primaryEvidence.timestamp).getTime();
      // Look for overlapping context within a strict 500ms time bracket around the crash incident
      const TIME_WINDOW_MS = 500;

      allEvents.forEach((event) => {
        // Avoid adding the original line twice
        if (event.id === primaryEvidence.id) return;

        const eventTime = new Date(event.timestamp).getTime();
        const difference = Math.abs(errorTime - eventTime);

        // If a system line (like a db log) fired right next to the crash, pull it in as corroborating evidence
        if (
          difference <= TIME_WINDOW_MS &&
          ['db', 'redis', 'nginx'].includes(event.service)
        ) {
          // Verify it isn't already included in the evidence list
          if (!topFinding.evidence.some((e) => e.id === event.id)) {
            topFinding.evidence.push(event);
          }
        }
      });

      // Keep evidence arrays ordered sequentially by timestamp.
      topFinding.evidence.sort(
        (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
      );
    }
  }

  return findings;
}
