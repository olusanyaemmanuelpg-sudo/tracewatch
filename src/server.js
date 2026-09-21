import http from 'http';
import fs from 'fs';
import path from 'path';
import { correlateEvents } from './correlate.js';
import { analyzeTraces } from './analyze.js';

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
        res.end(JSON.stringify({ found: false }));
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
    <title>TraceWatch Visual Dashboard</title>
    <style>
      body { background: #0f172a; color: #e2e8f0; font-family: monospace; margin: 0; padding: 20px; display: flex; flex-direction: column; height: 95vh; }
      header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 15px; margin-bottom: 20px; flex-shrink: 0; }
      h1 { margin: 0; color: #38bdf8; font-size: 20px; }
      .motto { color: #64748b; font-style: italic; }
      
      .dashboard-container { display: flex; gap: 20px; flex-grow: 1; min-height: 0; }
      #timeline { background: #020617; border: 1px solid #1e293b; border-radius: 6px; padding: 15px; flex-grow: 2; overflow-y: auto; }
      #ai-pane { background: #0b1329; border: 1px solid #1e293b; border-radius: 6px; padding: 15px; flex-grow: 1; width: 400px; display: flex; flex-direction: column; }
      
      .explain-btn { background: #0284c7; color: white; border: none; padding: 10px 16px; font-family: monospace; font-weight: bold; border-radius: 4px; cursor: pointer; transition: background 0.2s; width: 100%; margin-bottom: 15px; }
      .explain-btn:hover { background: #0369a1; }
      
      #analysis-result { flex-grow: 1; overflow-y: auto; font-size: 13px; line-height: 1.5; }
      .log-line { display: flex; margin-bottom: 6px; font-size: 13px; line-height: 1.5; border-left: 3px solid transparent; padding-left: 8px; }
      .time { color: #475569; margin-right: 15px; }
      .badge { font-weight: bold; margin-right: 15px; width: 80px; }
      .msg { flex-grow: 1; white-space: pre-wrap; }
      
      .clr-cyan { color: #22d3ee; }
      .clr-magenta { color: #f472b6; }
      .clr-yellow { color: #facc15; }
      .clr-blue { color: #60a5fa; }
      .clr-red { color: #f87171; border-left-color: #ef4444; background: rgba(239, 68, 68, 0.05); }
      .evidence-box { background: #020617; padding: 10px; border-radius: 4px; border: 1px solid #1e293b; margin-top: 10px; }
      
      /* Status Badge Styling rules */
      .status-live { color: #4ade80; font-weight: bold; }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>TraceWatch Visual Console</h1>
        <div class="motto">"Don't show me the logs, show me what broke."</div>
      </div>
      <div id="status" class="status-live">● Connected Stream Live</div>
    </header>

    <div class="dashboard-container">
      <div id="timeline"></div>
      <div id="ai-pane">
        <button class="explain-btn" onclick="triggerWebExplain()">🔍 EXPLAIN LAST FAILURE</button>
        <div id="analysis-result">
          <span style="color: #64748b;">Click the button above to run local analysis rules on the session snapshot.</span>
        </div>
      </div>
    </div>

    <script>
      const timeline = document.getElementById('timeline');
      const source = new EventSource('/api/logs/stream');

      source.onmessage = (event) => {
        const log = JSON.parse(event.data);
        
        const lineEl = document.createElement('div');
        lineEl.className = 'log-line ' + (log.level === 'error' || log.level === 'fatal' ? 'clr-red' : '');
        
        const timeEl = document.createElement('span');
        timeEl.className = 'time';
        timeEl.textContent = new Date(log.timestamp).toLocaleTimeString();

        const badgeEl = document.createElement('span');
        let colorClass = 'clr-blue';
        if (log.service === 'frontend') colorClass = 'clr-cyan';
        if (log.service === 'auth-api') colorClass = 'clr-magenta';
        if (log.level === 'error' || log.level === 'fatal') colorClass = 'clr-red';
        
        badgeEl.className = 'badge ' + colorClass;
        badgeEl.textContent = log.service.toUpperCase();

        const msgEl = document.createElement('span');
        msgEl.className = 'msg';
        msgEl.textContent = log.message;

        lineEl.appendChild(timeEl);
        lineEl.appendChild(badgeEl);
        lineEl.appendChild(msgEl);
        
        timeline.appendChild(lineEl);
        timeline.scrollTop = timeline.scrollHeight;
      };

      source.onerror = () => {
        document.getElementById('status').textContent = '○ Connection Severed';
        document.getElementById('status').className = '';
        document.getElementById('status').style.color = '#f87171';
      };

      async function triggerWebExplain() {
        const container = document.getElementById('analysis-result');
        container.innerHTML = '<span style="color: #38bdf8;">Analyzing active trace arrays...</span>';
        
        try {
          const res = await fetch('/api/explain');
          const data = await res.json();
          
          if (!data.found) {
            container.innerHTML = '<span style="color: #facc15;">🔍 TraceWatch swept the active timeline buffer but detected zero active rule violations.</span>';
            return;
          }
          
          const f = data.finding;
          let html = \`
            <div style="color: #f87171; font-weight: bold; font-size: 15px; margin-bottom: 5px;">\${f.cause}</div>
            <div style="color: #64748b; font-size: 11px; margin-bottom: 15px;">\${Math.round(f.confidence * 100)}% confidence · rule: \${f.rule}</div>
            
            <div style="font-weight: bold; margin-bottom: 5px; color: #e2e8f0;">evidence:</div>
            <div class="evidence-box">
          \`;
          
          f.evidence.forEach(e => {
            html += \`<div style="font-size: 12px; margin-bottom: 4px; color: #cbd5e1;">
              <span style="color: #475569;">[\${new Date(e.timestamp).toLocaleTimeString()}]</span> 
              <span style="color: #ef4444; font-weight: bold;">[\${e.service.toUpperCase()}]</span> \${e.message}
            </div>\`;
          });
          
          html += \`
            </div>
            <div style="margin-top: 15px;">
              <span style="color: #22d3ee; font-weight: bold;">next:</span> 
              <span style="color: #cbd5e1;">\${f.fix}</span>
                </div>
              \`;
              
              container.innerHTML = html;
            } catch (err) {
              container.innerHTML = '<span style="color: #f87171;">Failed to communicate with diagnostic endpoint.</span>';
            }
          }
        </script>
      </body>
      </html>
      `;
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
