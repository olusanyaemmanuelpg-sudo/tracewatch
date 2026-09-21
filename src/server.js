import http from 'http';
import fs from 'fs';
import path from 'path';

/** @type {Set<http.ServerResponse>} */
const connectedClients = new Set();

/**
 * Starts the ultra-lightweight TraceWatch Web Dashboard Server.
 * @param {number} port - Target dashboard port (default 9999)
 * @param {import('./store.js').EventStore} eventStore - Direct reference to the active log store
 */

export function startDashboardSever(port, eventStore) {
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

      // Send down all existing log records currently sitting in the ring buffer on initial boot
      const historicalLogs = eventStore.getAll();
      historicalLogs.forEach((log) => {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      });
      return;
    }

    // 2. ENDPOINT B: HTML Frontend Dashboard View Interface Layout
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });

      // Injecting a completely self-contained responsive HTML dashboard directly out of the server memory block!
      const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>TraceWatch Visual Dashboard</title>
        <style>
          body { background: #0f172a; color: #e2e8f0; font-family: monospace; margin: 0; padding: 20px; }
          header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 15px; margin-bottom: 20px; }
          h1 { margin: 0; color: #38bdf8; font-size: 20px; }
          .motto { color: #64748b; font-style: italic; }
          #timeline { background: #020617; border: 1px solid #1e293b; border-radius: 6px; padding: 15px; min-height: 400px; max-height: 70vh; overflow-y: auto; }
          .log-line { display: flex; margin-bottom: 6px; font-size: 13px; line-height: 1.5; border-left: 3px solid transparent; padding-left: 8px; }
          .time { color: #475569; margin-right: 15px; }
          .badge { font-weight: bold; margin-right: 15px; width: 80px; }
          .msg { flex-grow: 1; white-space: pre-wrap; }
          
          /* Service colors mapped straight out of config schemas */
          .clr-cyan { color: #22d3ee; }
          .clr-magenta { color: #f472b6; }
          .clr-yellow { color: #facc15; }
          .clr-blue { color: #60a5fa; }
          .clr-red { color: #f87171; border-left-color: #ef4444; background: rgba(239, 68, 68, 0.05); }
        </style>
      </head>
      <body>
        <header>
          <div>
            <h1>TraceWatch Visual Console</h1>
            <div class="motto">"Don't show me the logs, show me what broke."</div>
          </div>
          <div id="status" style="color: #4ade80;">● Connected Stream Live</div>
        </header>

        <div id="timeline"></div>

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
            // Dynamically evaluate text style color profiles
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
            timeline.scrollTop = timeline.scrollHeight; // Auto scroll down layout
          };

          source.onerror = () => {
            document.getElementById('status').textContent = '○ Connection Severed';
            document.getElementById('status').style.color = '#f87171';
          };
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

  server.listen(port, () => {
    // Dynamic background operational start logging is skipped here to keep the CLI clean
  });
}

/**
 * Broadcasts a newly parsed event log row out to all listening browser pages instantly.
 * @param {import('./types.js').LogEvent} eventLog
 */
export function broadcastLog(eventLog) {
  for (const client of connectedClients) {
    client.write(`data: ${JSON.stringify(eventLog)}\n\n`);
  }
}
