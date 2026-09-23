import http from 'http';
import fs from 'fs';
import path from 'path';
import { correlateEvents } from './correlate.js';
import { analyzeTraces } from './analyze.js';
import { superviseWithAI } from './analyze-ai.js';

/** @type {Set<http.ServerResponse>} */
const connectedClients = new Set();

/**
 * Starts the ultra-lightweight TraceWatch Web Dashboard Server.
 * @param {number} port - Target dashboard port (default 9999)
 * @param {import('./store.js').EventStore} eventStore - Direct reference to the active log store
 */

export function startDashboardServer(port, eventStore) {
  const server = http.createServer((req, res) => {
    // 1. ENDPOINT A: The Server-Sent Events (SSE) Live Feed
    if (req.url === '/api/logs/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      //Keep connection tracked in memory
      connectedClients.add(res);
      req.on('close', () => connectedClients.delete(res));

      // Send down all existing log records currently sitting in the ring buffer on initial boot
      const historicalLogs = eventStore.getAll();
      historicalLogs.forEach((log) => {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      });
      return;
    }

    // 2. NEW ENDPOINT B: /api/explain API Engine Endpoint

    if (req.url === '/api/explain' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });

      // Fetch all log lines currently in our high-performance ring buffer
      const currentLogs = eventStore.getAll();

      // Run the deterministic correlation rules and active diagnostic tests
      const traces = correlateEvents(currentLogs);
      const findings = analyzeTraces(traces, currentLogs);

      if (findings.length === 0) {
        superviseWithAI(currentLogs, null)
          .then((aiFinding) => {
            if (aiFinding?.success) {
              res.end(JSON.stringify({ found: true, finding: aiFinding }));
              return;
            }
            res.end(
              JSON.stringify({
                found: false,
                message: aiFinding?.message || 'No finding available.',
              }),
            );
          })
          .catch(() => {
            res.end(
              JSON.stringify({ found: false, message: 'AI diagnosis failed.' }),
            );
          });
        return;
      }

      // Return the top graded diagnostic payload finding directly to the UI panel
      res.end(JSON.stringify({ found: true, finding: findings[0] }));
      return;
    }

    // 3. ENDPOINT B: HTML Frontend Dashboard View Interface Layout
    // 3. ENDPOINT C: HTML Dashboard View Interface
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TraceWatch | Operations</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap');
    :root { --ink: #edf7f5; --muted: #8ca7aa; --line: rgba(143, 196, 193, 0.18); --paper: #071517; --surface: #0c2528; --surface-2: #123337; --teal: #6ee7d2; --teal-soft: rgba(110, 231, 210, 0.12); --red: #ff817c; --amber: #f7c76a; --shadow: rgba(0, 0, 0, 0.35); }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 50% -10%, rgba(41, 123, 115, 0.28), transparent 38%), linear-gradient(rgba(111, 190, 181, 0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(111, 190, 181, 0.025) 1px, transparent 1px), var(--paper); background-size: auto, 32px 32px, 32px 32px; color: var(--ink); font-family: "Space Grotesk", "Trebuchet MS", sans-serif; }
    button, select { font: inherit; }
    .topbar { height: 72px; padding: 0 42px; display: flex; align-items: center; justify-content: space-between; background: rgba(7, 21, 23, 0.84); border-bottom: 1px solid var(--line); backdrop-filter: blur(14px); }
    .brand { display: flex; align-items: center; gap: 11px; font-weight: 700; letter-spacing: -.02em; }
    .brand-mark { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 7px; color: #06272d; background: var(--teal); font-size: 15px; box-shadow: 0 10px 28px rgba(110, 231, 210, 0.18); }
    .brand small { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; font-weight: 500; letter-spacing: 0; }
    .live-status { display: flex; align-items: center; gap: 8px; color: var(--teal); font-family: "DM Mono", monospace; font-size: 11px; font-weight: 500; letter-spacing: .02em; }
    .live-dot { width: 8px; height: 8px; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 5px rgba(52, 211, 153, 0.18); }
    .shell { width: min(1440px, calc(100% - 84px)); margin: 0 auto; padding: 48px 0 56px; }
    .page-heading { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; margin-bottom: 31px; }
    .eyebrow { color: var(--teal); font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 9px 0 7px; font-size: clamp(30px, 3.5vw, 48px); font-weight: 600; letter-spacing: -.055em; line-height: .98; }
    .subtitle { margin: 0; color: var(--muted); font-size: 14px; }
    .refresh-note { color: var(--muted); font-family: "DM Mono", monospace; font-size: 10px; letter-spacing: .05em; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 24px; }
    .metric { padding: 19px 21px; background: rgba(12, 37, 40, 0.86); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 18px 40px var(--shadow); }
    .metric-label { color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .metric-value { margin-top: 8px; font-size: 29px; font-weight: 600; letter-spacing: -.04em; }
    .metric-value.alert { color: var(--red); }
    .workspace { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(310px, .8fr); gap: 18px; align-items: stretch; }
    .panel { min-height: 470px; background: rgba(12, 37, 40, 0.88); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; box-shadow: 0 30px 60px var(--shadow); }
    .panel-head { min-height: 70px; padding: 17px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); }
    .panel-title { margin: 0; font-size: 14px; font-weight: 800; }
    .panel-kicker { margin-top: 4px; color: var(--muted); font-size: 11px; }
    select { padding: 7px 28px 7px 10px; color: var(--ink); background: rgba(7, 21, 23, 0.65); border: 1px solid var(--line); border-radius: 5px; font-size: 11px; }
    #timeline { max-height: 560px; overflow-y: auto; }
    .empty { padding: 56px 24px; color: var(--muted); text-align: center; font-size: 13px; }
    .log-line { display: grid; grid-template-columns: 74px 92px minmax(0, 1fr); gap: 12px; align-items: start; padding: 14px 20px; border-bottom: 1px solid rgba(143, 196, 193, 0.1); font-family: "DM Mono", monospace; font-size: 11px; line-height: 1.5; }
    .log-line:last-child { border-bottom: 0; }
    .log-line.is-error { background: rgba(248, 113, 113, 0.06); }
    .time { color: #8ba8a5; font-family: "DM Mono", monospace; font-size: 10px; padding-top: 2px; }
    .badge { width: fit-content; padding: 3px 7px; border-radius: 4px; color: #06272d; background: rgba(110, 231, 210, 0.9); font-family: "Space Grotesk", sans-serif; font-size: 10px; font-weight: 700; letter-spacing: .04em; }
    .badge.error { color: #fff; background: rgba(248, 113, 113, 0.9); }
    .msg { color: #dfeaf0; overflow-wrap: anywhere; }
    .insight { display: flex; flex-direction: column; }
    .insight .panel-head { display: block; }
    .explain-btn { margin-top: 15px; padding: 10px 13px; display: inline-flex; align-items: center; gap: 8px; color: #06272d; background: var(--teal); border: 0; border-radius: 5px; cursor: pointer; font-size: 12px; font-weight: 700; box-shadow: 0 18px 30px rgba(110, 231, 210, 0.15); }
    .explain-btn:hover { filter: brightness(1.04); }
    #analysis-result { flex: 1; padding: 20px; color: var(--muted); font-size: 13px; line-height: 1.55; }
    .finding-cause { color: #fda4af; font-size: 18px; font-weight: 800; letter-spacing: -.025em; line-height: 1.2; }
    .finding-meta { margin: 7px 0 20px; color: var(--muted); font-family: "DM Mono", monospace; font-size: 10px; }
    .evidence-title { margin-bottom: 8px; color: var(--ink); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .evidence-box { padding: 11px; background: rgba(7, 21, 23, 0.58); border: 1px solid var(--line); border-radius: 5px; }
    .evidence-item { padding: 7px 0; border-bottom: 1px solid rgba(148, 163, 184, 0.12); font-size: 11px; }
    .evidence-item:last-child { border-bottom: 0; }
    .evidence-time { color: var(--muted); font-family: "DM Mono", monospace; font-size: 10px; }
    .next-step { margin-top: 22px; padding-top: 16px; border-top: 1px solid rgba(148, 163, 184, 0.12); }
    .next-step strong { color: var(--teal); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
    @media (max-width: 860px) { .topbar { padding: 0 18px; } .shell { width: min(100% - 36px, 680px); padding-top: 25px; } .page-heading { display: block; } .refresh-note { display: block; margin-top: 15px; } .workspace { grid-template-columns: 1fr; } .metrics { gap: 8px; } .metric { padding: 14px; } .metric-value { font-size: 22px; } }
    @media (max-width: 520px) { .metrics { grid-template-columns: 1fr; } .log-line { grid-template-columns: 64px 1fr; gap: 8px; } .badge { grid-column: 2; grid-row: 1; } .msg { grid-column: 2; } }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand"><span class="brand-mark">T</span><span>TraceWatch<small>incident intelligence</small></span></div>
    <div id="status" class="live-status"><span class="live-dot"></span> Live stream connected</div>
  </header>
  <main class="shell">
    <section class="page-heading">
      <div><div class="eyebrow">Operations overview</div><h1>See what broke.</h1><p class="subtitle">A live view of your services, traces, and root-cause signals.</p></div>
      <div class="refresh-note">STREAM / REAL-TIME</div>
    </section>
    <section class="metrics" aria-label="Session summary">
      <div class="metric"><div class="metric-label">Events captured</div><div id="event-count" class="metric-value">0</div></div>
      <div class="metric"><div class="metric-label">Active errors</div><div id="error-count" class="metric-value alert">0</div></div>
      <div class="metric"><div class="metric-label">Services observed</div><div id="service-count" class="metric-value">0</div></div>
    </section>
    <section class="workspace">
      <div class="panel">
        <div class="panel-head"><div><h2 class="panel-title">Event stream</h2><div class="panel-kicker">Newest activity appears at the bottom</div></div><select id="level-filter" aria-label="Filter events"><option value="all">All events</option><option value="error">Errors only</option><option value="warn">Warnings only</option></select></div>
        <div id="timeline"><div class="empty">Waiting for your services to emit events...</div></div>
      </div>
      <aside class="panel insight">
        <div class="panel-head"><div class="eyebrow">Diagnostic workspace</div><h2 class="panel-title">Root cause</h2><div class="panel-kicker">Run analysis against the current session buffer</div><button class="explain-btn" onclick="triggerWebExplain()"><span>✦</span> Explain latest failure</button></div>
        <div id="analysis-result">No analysis run yet. TraceWatch will connect related events and rank the most likely cause here.</div>
      </aside>
    </section>
  </main>
  <script>
    const timeline = document.getElementById('timeline');
    const source = new EventSource('/api/logs/stream');
    const logs = [];
    const services = new Set();
    const filter = document.getElementById('level-filter');
    const isFailure = (log) => log.level === 'error' || log.level === 'fatal';

    function updateMetrics() {
      document.getElementById('event-count').textContent = logs.length;
      document.getElementById('error-count').textContent = logs.filter(isFailure).length;
      document.getElementById('service-count').textContent = services.size;
    }

    function renderLogs() {
      const visibleLogs = filter.value === 'all' ? logs : logs.filter((log) => log.level === filter.value || (filter.value === 'error' && isFailure(log)));
      timeline.innerHTML = '';
      if (!visibleLogs.length) { timeline.innerHTML = '<div class="empty">No events match this filter.</div>'; return; }
      visibleLogs.forEach((log) => {
        const line = document.createElement('div');
        line.className = 'log-line' + (isFailure(log) ? ' is-error' : '');
        const time = document.createElement('span'); time.className = 'time'; time.textContent = new Date(log.timestamp).toLocaleTimeString();
        const badge = document.createElement('span'); badge.className = 'badge' + (isFailure(log) ? ' error' : ''); badge.textContent = log.service.toUpperCase();
        const message = document.createElement('span'); message.className = 'msg'; message.textContent = log.message;
        line.append(time, badge, message); timeline.appendChild(line);
      });
      timeline.scrollTop = timeline.scrollHeight;
    }

    filter.addEventListener('change', renderLogs);
    source.onmessage = (event) => { const log = JSON.parse(event.data); logs.push(log); services.add(log.service); updateMetrics(); renderLogs(); };
    source.onerror = () => { document.getElementById('status').innerHTML = '<span class="live-dot" style="background:#c84b45;box-shadow:0 0 0 4px #fbe9e7"></span> Stream disconnected'; };

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function renderEvidenceItem(entry) {
      if (typeof entry === 'string') {
        return '<div class="evidence-item"><div class="evidence-time">AI signal</div><div>' + escapeHtml(entry) + '</div></div>';
      }

      const ts = entry && entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : 'unknown';
      const service = entry && entry.service ? entry.service.toUpperCase() : 'SYSTEM';
      const message = entry && entry.message ? entry.message : 'No message available';
      return '<div class="evidence-item"><span class="evidence-time">' + escapeHtml(ts) + '</span> &nbsp; <strong>' + escapeHtml(service) + '</strong><br>' + escapeHtml(message) + '</div>';
    }

    async function triggerWebExplain() {
      const container = document.getElementById('analysis-result');
      container.textContent = 'Analyzing current session...';
      try {
        const data = await (await fetch('/api/explain')).json();
        if (!data.found) {
          container.textContent = data.message || 'No active rule violations found in the current session.';
          return;
        }
        const f = data.finding;
        const isAi = String(f.rule || '').startsWith('ai-');
        const sourceTag = isAi ? '<span class="finding-meta">AI fallback · ' : '<span class="finding-meta">';
        let html = '<div class="finding-cause">' + escapeHtml(f.cause || 'No root cause identified.') + '</div>' + sourceTag + Math.round((Number(f.confidence) || 0) * 100) + '% confidence · ' + escapeHtml(f.rule || 'analysis') + '</span><div class="evidence-title">Evidence</div><div class="evidence-box">';
        (Array.isArray(f.evidence) ? f.evidence : []).forEach((entry) => {
          html += renderEvidenceItem(entry);
        });
        html += '</div><div class="next-step"><strong>Recommended next step</strong><div>' + escapeHtml(f.fix || 'Review the incident logs and verify the failing service.') + '</div></div>';
        container.innerHTML = html;
      } catch (error) { container.textContent = 'The diagnostic endpoint is unavailable. Check the live stream connection.'; }
    }
  </script>
</body>
</html>`;
      res.end(html);
      return;
    }

    // Fallback error code for non-existent page endpoints
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `❌ Dashboard port ${port} is already in use. Close the existing dashboard or choose another port.`,
      );
      return;
    }

    console.error(`❌ Dashboard server failed: ${error.message}`);
  });

  server.listen(port);
  return server;
}

/**
 * Broadcasts a newly parsed event log row out to all listening browser pages instantly.
 * @param {import('./types.js').LogEvent} eventLog
 */
export function broadcastLog(eventLog) {
  for (const client of connectedClients) {
    if (client.writableEnded || client.destroyed) {
      connectedClients.delete(client);
      continue;
    }

    try {
      client.write(`data: ${JSON.stringify(eventLog)}\n\n`);
    } catch {
      connectedClients.delete(client);
    }
  }
}

export const startDashboardSever = startDashboardServer;
