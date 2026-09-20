/**
 * Takes a sequential list of raw LogEvents and structures them into grouped Traces.
 * @param {import('./types.js').LogEvent[]} events - Sorted array of log events from the store
 * @returns {import('./types.js').Trace[]} Array of correlated traces sorted newest first
 */

export function correlateEvents(events) {
  if (events.length === 0) return [];

  /** @type {Map<string, import('./types.js').LogEvent[]>} */
  const explicitGroups = new Map();
  /** @type {import('./types.js').LogEvent[]} */
  const looseEvents = [];

  // 1. PHASE 1: Extract Explicit Traces via matching Request IDs
  events.forEach((event) => {
    if (event.requestId) {
      if (!explicitGroups.has(event.requestId)) {
        explicitGroups.set(event.requestId, []);
      }
      explicitGroups.get(event.requestId).push(event);
    } else {
      looseEvents.push(event);
    }
  });

  /** @type {import('./types.js').Trace[]} */
  const traces = [];

  // Convert explicit map groups into structural Trace contract objects
  for (const [reqId, groupedEvents] of explicitGroups.entries()) {
    traces.push({
      id: reqId,
      explicit: true,
      events: groupedEvents.sort(
        (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
      ),
    });
  }

  // 2. PHASE 2: Group leftover loose logs using Time-Gap Inference
  // If two logs occur within 1.5 seconds (1500ms) of each other locally, they belong to the same action run.
  const TIME_GAP_CEILING_MS = 1500;

  // Sort loose events chronologically to find consecutive runs easily
  looseEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  /** @type {import('./types.js').LogEvent[]} */
  let currentCluster = [];
  let clusterIndex = 1;
  looseEvents.forEach((event, idx) => {
    if (currentCluster.length === 0) {
      currentCluster.push(event);
      return;
    }
    const previousEvent = currentCluster[currentCluster.length - 1];
    const timeDiff =
      new Date(event.timestamp) - new Date(previousEvent.timestamp);

    if (timeDiff <= TIME_GAP_CEILING_MS) {
      currentCluster.push(event);
    } else {
      // Close the current time-cluster trace and save it
      traces.push({
        id: `cluster_${Date.now().toString().slice(-4)}_${clusterIndex++}`,
        explicit: false,
        events: currentCluster,
      });
      // Start a brand new cluster chain
      currentCluster = [event];
    }

    // Edge-case catch for the very last remaining item in the loop array
    if (idx === looseEvents.length - 1 && currentCluster.length > 0) {
      traces.push({
        id: `cluster_${Date.now().toString().slice(-4)}_${clusterIndex++}`,
        explicit: false,
        events: currentCluster,
      });
    }
  });

  // Return the entire trace timeline sorted with the freshest activity sitting at the top
  return traces.sort((a, b) => {
    const aTime = new Date(a.events[a.events.length - 1].timestamp);
    const bTime = new Date(b.events[b.events.length - 1].timestamp);
    return bTime - aTime;
  });
}
