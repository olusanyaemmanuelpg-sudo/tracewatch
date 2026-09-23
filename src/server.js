import http from 'http';
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
    // 0. Handle CORS preflight options
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    // 1. ENDPOINT A: The Server-Sent Events (SSE) Live Feed
    if (req.url === '/api/logs/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      // Keep connection tracked in memory
      connectedClients.add(res);
      req.on('close', () => connectedClients.delete(res));

      // Send down all existing log records currently sitting in the ring buffer on initial boot
      const historicalLogs = eventStore.getAll();
      historicalLogs.forEach((log) => {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      });
      return;
    }

    // 2. ENDPOINT B: /api/explain API Engine Endpoint
    if (req.url === '/api/explain' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });

      // Fetch all log lines currently in our high-performance ring buffer
      const currentLogs = eventStore.getAll();

      // Run deterministic correlation rules and active diagnostic tests
      const traces = correlateEvents(currentLogs);
      const findings = analyzeTraces(traces, currentLogs);

      const isNoSpecificRule =
        findings.length === 0 || findings[0].rule === 'fallback';

      if (isNoSpecificRule) {
        superviseWithAI(currentLogs, null)
          .then((aiFinding) => {
            if (aiFinding?.success) {
              res.end(JSON.stringify({ found: true, finding: aiFinding }));
              return;
            }
            if (findings.length > 0 && findings[0].rule === 'fallback') {
              res.end(JSON.stringify({ found: true, finding: findings[0] }));
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
            if (findings.length > 0 && findings[0].rule === 'fallback') {
              res.end(JSON.stringify({ found: true, finding: findings[0] }));
              return;
            }
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

    // 3. ENDPOINT C: HTML Dashboard View Interface
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TraceWatch · Cloud-Native Incident Observability</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #09090b;
      --card: #111115;
      --card-muted: #16161c;
      --card-highlight: #1c1c24;
      --border: rgba(255, 255, 255, 0.08);
      --border-subtle: rgba(255, 255, 255, 0.04);
      --border-active: #6366f1;
      --text: #f4f4f5;
      --text-muted: #a1a1aa;
      --text-dim: #71717a;
      --accent: #6366f1;
      --accent-soft: rgba(99, 102, 241, 0.12);
      --accent-glow: rgba(99, 102, 241, 0.35);
      --cyan: #06b6d4;
      --cyan-soft: rgba(6, 182, 212, 0.12);
      --emerald: #10b981;
      --emerald-soft: rgba(16, 185, 129, 0.12);
      --rose: #f43f5e;
      --rose-soft: rgba(244, 63, 94, 0.12);
      --amber: #f59e0b;
      --amber-soft: rgba(245, 158, 11, 0.12);
      --radius: 10px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background-color: var(--bg);
      background-image: 
        radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99, 102, 241, 0.15), transparent 70%),
        radial-gradient(ellipse 60% 40% at 80% -10%, rgba(6, 182, 212, 0.08), transparent 60%),
        linear-gradient(rgba(255, 255, 255, 0.015) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.015) 1px, transparent 1px);
      background-size: 100% 100%, 100% 100%, 28px 28px, 28px 28px;
      color: var(--text);
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      letter-spacing: -0.01em;
    }

    code, pre, .mono {
      font-family: 'JetBrains Mono', monospace;
    }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 9999px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.22); }

    /* Top Navigation */
    .topbar {
      height: 64px;
      padding: 0 32px;
      background: rgba(9, 9, 11, 0.75);
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(18px);
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
    }

    .brand-group {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .brand-logo {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: linear-gradient(135deg, #6366f1 0%, #38bdf8 100%);
      display: grid;
      place-items: center;
      box-shadow: 0 0 20px rgba(99, 102, 241, 0.4);
      color: #fff;
      font-weight: 800;
      font-size: 15px;
    }

    .brand-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .brand-title {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: #fff;
    }

    .brand-badge {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 2px 7px;
      border-radius: 9999px;
      background: rgba(99, 102, 241, 0.15);
      color: #a5b4fc;
      border: 1px solid rgba(99, 102, 241, 0.3);
    }

    .cluster-status-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 12px;
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.25);
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      color: #34d399;
    }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 10px #10b981;
      animation: ripple 2s infinite ease-in-out;
    }

    @keyframes ripple {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.35; transform: scale(0.85); }
    }

    .actions-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn {
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      padding: 7px 14px;
      border-radius: 8px;
      border: 1px solid transparent;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      outline: none;
    }

    .btn-primary {
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      color: #fff;
      box-shadow: 0 0 20px rgba(99, 102, 241, 0.3);
    }

    .btn-primary:hover {
      box-shadow: 0 0 28px rgba(99, 102, 241, 0.5);
      transform: translateY(-1px);
    }

    .btn-subtle {
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-muted);
      border-color: var(--border);
    }

    .btn-subtle:hover {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text);
      border-color: rgba(255, 255, 255, 0.15);
    }

    .kbd {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-muted);
    }

    /* Container */
    .app-main {
      width: 100%;
      max-width: 1680px;
      margin: 0 auto;
      padding: 24px 32px 32px;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* KPI Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
    }

    .kpi-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      position: relative;
      overflow: hidden;
      transition: all 0.2s;
    }

    .kpi-card:hover {
      border-color: rgba(255, 255, 255, 0.14);
      background: var(--card-muted);
    }

    .kpi-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .kpi-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-dim);
    }

    .kpi-tag {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-muted);
    }

    .kpi-value {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.04em;
      display: flex;
      align-items: baseline;
      gap: 6px;
    }

    .kpi-subtext {
      font-size: 11px;
      color: var(--text-dim);
    }

    .kpi-danger { color: #fb7185; }
    .kpi-success { color: #34d399; }
    .kpi-warning { color: #fbbf24; }

    /* Work Area Split */
    .workspace-split {
      display: grid;
      grid-template-columns: minmax(0, 1.9fr) minmax(380px, 1fr);
      gap: 20px;
      flex: 1;
      min-height: 600px;
    }

    /* Stream Feed Panel */
    .stream-panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
    }

    .toolbar {
      padding: 14px 20px;
      background: rgba(17, 17, 21, 0.95);
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .toolbar-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .search-wrapper {
      position: relative;
      flex: 1;
      min-width: 260px;
    }

    .search-input {
      width: 100%;
      background: var(--card-muted);
      border: 1px solid var(--border);
      color: #fff;
      font-family: inherit;
      font-size: 12px;
      padding: 7px 32px 7px 12px;
      border-radius: 6px;
      outline: none;
      transition: all 0.15s;
    }

    .search-input:focus {
      border-color: var(--accent);
      background: var(--card-highlight);
    }

    .search-icon {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-dim);
      font-size: 12px;
      pointer-events: none;
    }

    .segmented-control {
      display: flex;
      background: var(--card-muted);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 2px;
      gap: 2px;
    }

    .segment-btn {
      background: transparent;
      border: 0;
      color: var(--text-dim);
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.12s;
    }

    .segment-btn:hover {
      color: var(--text);
    }

    .segment-btn.active {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }

    /* Service Pills */
    .services-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 2px;
    }

    .service-pill {
      background: var(--card-muted);
      border: 1px solid var(--border);
      border-radius: 9999px;
      padding: 4px 11px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 7px;
      white-space: nowrap;
      transition: all 0.15s;
    }

    .service-pill:hover {
      border-color: rgba(255, 255, 255, 0.18);
      color: #fff;
    }

    .service-pill.active {
      background: var(--accent-soft);
      border-color: var(--accent);
      color: #a5b4fc;
    }

    .pill-counter {
      font-size: 10px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.08);
    }

    /* Timeline Table Feed */
    .stream-body {
      position: relative;
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    #timeline {
      flex: 1;
      max-height: calc(100vh - 360px);
      min-height: 520px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.55;
    }

    .table-head {
      display: grid;
      grid-template-columns: 88px 115px 65px minmax(0, 1fr) 40px;
      gap: 12px;
      padding: 9px 20px;
      background: rgba(255, 255, 255, 0.015);
      border-bottom: 1px solid var(--border-subtle);
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-dim);
    }

    .log-line {
      display: grid;
      grid-template-columns: 88px 115px 65px minmax(0, 1fr) 40px;
      gap: 12px;
      align-items: baseline;
      padding: 7px 20px;
      border-bottom: 1px solid var(--border-subtle);
      transition: background 0.1s;
      cursor: pointer;
    }

    .log-line:hover {
      background: rgba(255, 255, 255, 0.03);
    }

    .log-line.is-fatal,
    .log-line.is-error {
      background: rgba(244, 63, 94, 0.08);
      border-left: 2px solid #f43f5e;
    }

    .log-line.is-warn {
      background: rgba(245, 158, 11, 0.05);
      border-left: 2px solid #f59e0b;
    }

    .time-col {
      color: var(--text-dim);
      font-size: 11px;
    }

    .service-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 2px 7px;
      border-radius: 4px;
      width: fit-content;
      letter-spacing: 0.04em;
    }

    .level-badge {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .lvl-fatal { color: #fb7185; }
    .lvl-error { color: #fb7185; }
    .lvl-warn { color: #fbbf24; }
    .lvl-info { color: #38bdf8; }

    .msg-col {
      color: #e4e4e7;
      word-break: break-word;
      font-size: 12px;
    }

    .req-tag {
      color: var(--text-dim);
      background: rgba(255, 255, 255, 0.06);
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
      margin-left: 6px;
      cursor: pointer;
    }

    .req-tag:hover {
      background: rgba(99, 102, 241, 0.25);
      color: #a5b4fc;
    }

    .copy-btn {
      opacity: 0;
      background: transparent;
      border: 0;
      color: var(--text-dim);
      cursor: pointer;
      font-size: 11px;
      transition: opacity 0.15s;
    }

    .log-line:hover .copy-btn {
      opacity: 1;
    }

    .copy-btn:hover {
      color: #fff;
    }

    .auto-scroll-banner {
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--card-highlight);
      border: 1px solid var(--border);
      color: #fff;
      padding: 6px 16px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      cursor: pointer;
      display: none;
      align-items: center;
      gap: 6px;
      z-index: 20;
    }

    .auto-scroll-banner:hover {
      border-color: var(--accent);
    }

    .empty-state {
      padding: 80px 24px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      color: var(--text-dim);
    }

    /* Diagnosis Panel */
    .diag-panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
    }

    .diag-header {
      padding: 18px 20px;
      background: rgba(17, 17, 21, 0.95);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .diag-title {
      font-size: 13px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .diag-container {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      overflow-y: auto;
      max-height: calc(100vh - 360px);
    }

    .incident-box {
      background: linear-gradient(180deg, rgba(244, 63, 94, 0.08) 0%, rgba(17, 17, 21, 0.6) 100%);
      border: 1px solid rgba(244, 63, 94, 0.25);
      border-radius: 8px;
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      position: relative;
    }

    .incident-box.is-healthy {
      background: linear-gradient(180deg, rgba(16, 185, 129, 0.08) 0%, rgba(17, 17, 21, 0.6) 100%);
      border-color: rgba(16, 185, 129, 0.25);
    }

    .incident-headline {
      font-size: 15px;
      font-weight: 800;
      line-height: 1.35;
      color: #fca5a5;
      letter-spacing: -0.02em;
    }

    .incident-headline.is-healthy {
      color: #6ee7b7;
    }

    .incident-meta-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .meta-tag {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 2px 7px;
      border-radius: 4px;
      letter-spacing: 0.05em;
    }

    .tag-rule {
      background: rgba(99, 102, 241, 0.15);
      color: #c7d2fe;
      border: 1px solid rgba(99, 102, 241, 0.3);
    }

    .tag-ai {
      background: rgba(168, 85, 247, 0.15);
      color: #e9d5ff;
      border: 1px solid rgba(168, 85, 247, 0.3);
    }

    /* Failure Cascade Flow Diagram */
    .cascade-flow {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 14px;
      background: var(--card-muted);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow-x: auto;
      margin-top: 4px;
    }

    .cascade-node {
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 90px;
    }

    .cascade-node.root-cause {
      background: rgba(244, 63, 94, 0.12);
      border-color: rgba(244, 63, 94, 0.4);
    }

    .node-service {
      font-weight: 700;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .node-status {
      font-size: 11px;
      color: var(--text-muted);
    }

    .cascade-arrow {
      color: var(--text-dim);
      font-size: 13px;
    }

    /* Evidence Snippets */
    .section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-dim);
      margin-bottom: 6px;
    }

    .evidence-block {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .evidence-card {
      background: var(--card-muted);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 11px;
    }

    .evidence-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
      font-size: 10px;
      color: var(--text-dim);
    }

    /* Remediation Card */
    .fix-card {
      background: rgba(99, 102, 241, 0.06);
      border: 1px solid rgba(99, 102, 241, 0.25);
      border-radius: 8px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .fix-title {
      font-size: 11px;
      font-weight: 700;
      color: #c7d2fe;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .fix-body {
      font-size: 12px;
      line-height: 1.5;
      color: #e0e7ff;
      white-space: pre-wrap;
    }

    @media (max-width: 1100px) {
      .workspace-split { grid-template-columns: 1fr; }
      .kpi-grid { grid-template-columns: repeat(2, 1fr); }
    }

    @media (max-width: 640px) {
      .topbar { padding: 0 16px; }
      .app-main { padding: 16px; }
      .kpi-grid { grid-template-columns: 1fr; }
      .log-line { grid-template-columns: 70px 1fr; }
      .level-badge, .copy-btn { display: none; }
    }
  </style>
</head>
<body>
  <!-- Topbar -->
  <header class="topbar">
    <div class="brand-group">
      <div class="brand-logo">T</div>
      <div class="brand-info">
        <span class="brand-title">TraceWatch</span>
        <span class="brand-badge">OBSERVABILITY</span>
      </div>
      <div class="cluster-status-pill">
        <span class="status-dot"></span>
        <span id="conn-status">Cluster Live</span>
      </div>
    </div>

    <div class="actions-group">
      <button class="btn btn-subtle" onclick="clearTimeline()" title="Clear events (C)">
        <span>Clear</span>
        <span class="kbd">C</span>
      </button>
      <button class="btn btn-subtle" onclick="copySessionReport()" title="Export Markdown (D)">
        <span>Export</span>
        <span class="kbd">D</span>
      </button>
      <button class="btn btn-primary" onclick="triggerExplain()" title="Diagnose failure (E)">
        <span>✦ Explain failure</span>
        <span class="kbd" style="background:rgba(255,255,255,0.2);color:#fff;">E</span>
      </button>
    </div>
  </header>

  <!-- App Main -->
  <main class="app-main">
    <!-- Executive KPI Bar -->
    <section class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-label">System Health</span>
          <span id="health-tag" class="kpi-tag">ONLINE</span>
        </div>
        <div id="kpi-status-val" class="kpi-value kpi-success">100% OK</div>
        <span id="kpi-status-sub" class="kpi-subtext">Zero error cascades detected</span>
      </div>

      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-label">Captured Events</span>
          <span class="kpi-tag">BUFFER</span>
        </div>
        <div id="kpi-events-val" class="kpi-value mono">0</div>
        <span class="kpi-subtext">50k ring buffer limit</span>
      </div>

      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-label">Failure Incidents</span>
          <span class="kpi-tag">ERROR RATE</span>
        </div>
        <div id="kpi-errors-val" class="kpi-value kpi-success mono">0</div>
        <span id="kpi-errors-sub" class="kpi-subtext">0 fatal · 0 warnings</span>
      </div>

      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-label">Microservices</span>
          <span class="kpi-tag">DISCOVERED</span>
        </div>
        <div id="kpi-services-val" class="kpi-value mono">0</div>
        <span id="kpi-services-sub" class="kpi-subtext">Awaiting log emissions</span>
      </div>
    </section>

    <!-- Workspace Split -->
    <section class="workspace-split">
      <!-- Live Log Stream Feed -->
      <div class="stream-panel">
        <div class="toolbar">
          <div class="toolbar-row">
            <div class="search-wrapper">
              <input type="text" id="filter-search" class="search-input" placeholder="Search by message, service, or req ID... (Press / to focus)" oninput="onSearchChange(this.value)">
              <span class="search-icon">🔍</span>
            </div>

            <div class="segmented-control">
              <button class="segment-btn active" onclick="setLevelFilter('all', this)">All</button>
              <button class="segment-btn" onclick="setLevelFilter('error', this)">Errors</button>
              <button class="segment-btn" onclick="setLevelFilter('warn', this)">Warns</button>
              <button class="segment-btn" onclick="setLevelFilter('info', this)">Info</button>
            </div>
          </div>

          <!-- Microservice Pills -->
          <div id="services-bar" class="services-bar">
            <button class="service-pill active" onclick="setServiceFilter('all')">
              <span>ALL SERVICES</span>
              <span id="all-count-pill" class="pill-counter">0</span>
            </button>
          </div>
        </div>

        <div class="stream-body">
          <div class="table-head">
            <span>TIMESTAMP</span>
            <span>SERVICE</span>
            <span>LEVEL</span>
            <span>MESSAGE</span>
            <span></span>
          </div>

          <div id="timeline">
            <div class="empty-state">
              <div style="font-size:24px;opacity:0.4;">⚡</div>
              <div style="font-weight:600;color:var(--text-muted);">Listening for service logs</div>
              <div style="font-size:12px;color:var(--text-dim);">TraceWatch will capture, correlate, and stream events here in real-time.</div>
            </div>
          </div>

          <div id="auto-scroll-banner" class="auto-scroll-banner" onclick="resumeAutoScroll()">
            <span>⇣ Auto-scroll paused — Click to resume</span>
          </div>
        </div>
      </div>

      <!-- Incident Intelligence & Root Cause Panel -->
      <div class="diag-panel">
        <div class="diag-header">
          <div class="diag-title">
            <span>Root Cause Intelligence</span>
            <span class="brand-badge" style="font-size:9px;">AI + RULES</span>
          </div>
          <button class="btn btn-subtle" style="padding:4px 10px;font-size:11px;" onclick="triggerExplain()">Re-Analyze</button>
        </div>

        <div id="diag-container" class="diag-container">
          <!-- Initial Diagnosis Card -->
          <div class="incident-box is-healthy">
            <div class="incident-headline is-healthy">✅ Systems Operating Normally</div>
            <div class="incident-meta-row">
              <span class="meta-tag" style="background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.3);">HEALTHY CLUSTER</span>
              <span class="mono" style="font-size:11px;color:var(--text-dim);">No active error signatures</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);line-height:1.5;margin-top:4px;">
              TraceWatch monitors logs across your services. If an incident or dependency cascade occurs, click <strong>✦ Explain failure</strong> to diagnose the exact root cause.
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>

  <script>
    const logs = [];
    const serviceCounts = new Map();
    const serviceColors = {
      'web': '#38bdf8',
      'api': '#c084fc',
      'db': '#fbbf24',
      'frontend': '#38bdf8',
      'backend': '#c084fc',
      'worker': '#34d399',
      'auth': '#f472b6',
      'redis': '#f87171',
    };
    const palette = ['#38bdf8', '#c084fc', '#fbbf24', '#34d399', '#f472b6', '#a78bfa', '#2dd4bf'];

    let activeService = 'all';
    let activeLevel = 'all';
    let searchQuery = '';
    let autoScroll = true;

    const timeline = document.getElementById('timeline');
    const autoScrollBanner = document.getElementById('auto-scroll-banner');

    timeline.addEventListener('scroll', () => {
      const atBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 35;
      autoScroll = atBottom;
      autoScrollBanner.style.display = autoScroll ? 'none' : 'flex';
    });

    function resumeAutoScroll() {
      autoScroll = true;
      autoScrollBanner.style.display = 'none';
      timeline.scrollTop = timeline.scrollHeight;
    }

    function isFailure(log) {
      return log.level === 'error' || log.level === 'fatal';
    }

    function getServiceColor(name) {
      const lower = String(name || '').toLowerCase();
      if (serviceColors[lower]) return serviceColors[lower];
      let hash = 0;
      for (let i = 0; i < lower.length; i++) hash += lower.charCodeAt(i);
      return palette[hash % palette.length];
    }

    function escapeHtml(str) {
      return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function formatTime(iso) {
      try {
        const d = new Date(iso);
        if (!isNaN(d.getTime())) {
          return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
        }
        return String(iso || '00:00:00');
      } catch {
        return '00:00:00';
      }
    }

    function updateKPIs() {
      const total = logs.length;
      const errors = logs.filter(isFailure).length;
      const warns = logs.filter((l) => l.level === 'warn').length;

      document.getElementById('kpi-events-val').textContent = total;
      const errEl = document.getElementById('kpi-errors-val');
      errEl.textContent = errors;
      errEl.className = 'kpi-value mono ' + (errors > 0 ? 'kpi-danger' : 'kpi-success');

      document.getElementById('kpi-errors-sub').textContent = errors + ' errors · ' + warns + ' warnings';

      const sCount = serviceCounts.size;
      document.getElementById('kpi-services-val').textContent = sCount;
      document.getElementById('kpi-services-sub').textContent = sCount + ' active service' + (sCount === 1 ? '' : 's');

      const healthVal = document.getElementById('kpi-status-val');
      const healthSub = document.getElementById('kpi-status-sub');
      const healthTag = document.getElementById('health-tag');

      if (errors > 0) {
        healthVal.textContent = 'INCIDENT';
        healthVal.className = 'kpi-value kpi-danger';
        healthSub.textContent = errors + ' failure event' + (errors === 1 ? '' : 's') + ' in window';
        healthTag.textContent = 'ATTENTION';
        healthTag.style.color = '#fb7185';
      } else {
        healthVal.textContent = '100% OK';
        healthVal.className = 'kpi-value kpi-success';
        healthSub.textContent = 'Zero error cascades detected';
        healthTag.textContent = 'ONLINE';
        healthTag.style.color = '#34d399';
      }

      const allPill = document.getElementById('all-count-pill');
      if (allPill) allPill.textContent = total;
    }

    function renderServicePills() {
      const bar = document.getElementById('services-bar');
      const services = Array.from(serviceCounts.keys()).sort();

      let html = '<button class="service-pill ' + (activeService === 'all' ? 'active' : '') + '" onclick="setServiceFilter(\\'all\\')"><span>ALL SERVICES</span><span id="all-count-pill" class="pill-counter">' + logs.length + '</span></button>';

      services.forEach((s) => {
        const count = serviceCounts.get(s) || 0;
        const color = getServiceColor(s);
        const isActive = activeService === s ? 'active' : '';
        html += '<button class="service-pill ' + isActive + '" onclick="setServiceFilter(\\'' + escapeHtml(s) + '\\')"><span style="width:7px;height:7px;border-radius:50%;background:' + color + '"></span><span>' + escapeHtml(s.toUpperCase()) + '</span><span class="pill-counter">' + count + '</span></button>';
      });

      bar.innerHTML = html;
    }

    function matchesFilter(log) {
      if (activeService !== 'all' && log.service !== activeService) return false;
      if (activeLevel === 'error' && !isFailure(log)) return false;
      if (activeLevel === 'warn' && log.level !== 'warn') return false;
      if (activeLevel === 'info' && log.level !== 'info') return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const text = (log.message + ' ' + log.service + ' ' + (log.requestId || '')).toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    }

    function createLogRow(log) {
      const row = document.createElement('div');
      const fail = isFailure(log);
      const isWarn = log.level === 'warn';
      row.className = 'log-line' + (fail ? ' is-error' : isWarn ? ' is-warn' : '');

      const sColor = getServiceColor(log.service);

      const timeCol = document.createElement('span');
      timeCol.className = 'mono time-col';
      timeCol.textContent = formatTime(log.timestamp);

      const sBadge = document.createElement('span');
      sBadge.className = 'service-badge mono';
      sBadge.style.background = sColor + '1a';
      sBadge.style.color = sColor;
      sBadge.style.border = '1px solid ' + sColor + '40';
      sBadge.textContent = String(log.service || 'SYSTEM').toUpperCase();

      const lvlSpan = document.createElement('span');
      lvlSpan.className = 'level-badge mono lvl-' + (log.level || 'info');
      lvlSpan.textContent = String(log.level || 'INFO').toUpperCase();

      const msgCol = document.createElement('span');
      msgCol.className = 'msg-col mono';
      msgCol.textContent = log.message;

      if (log.requestId) {
        const reqSpan = document.createElement('span');
        reqSpan.className = 'req-tag mono';
        reqSpan.textContent = 'req:' + log.requestId;
        reqSpan.title = 'Click to filter by trace ' + log.requestId;
        reqSpan.onclick = (e) => {
          e.stopPropagation();
          document.getElementById('filter-search').value = log.requestId;
          onSearchChange(log.requestId);
        };
        msgCol.appendChild(reqSpan);
      }

      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.textContent = '📋';
      copyBtn.title = 'Copy log row';
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(log.message);
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
      };

      row.append(timeCol, sBadge, lvlSpan, msgCol, copyBtn);
      return row;
    }

    function renderFilteredTimeline() {
      timeline.innerHTML = '';
      const filtered = logs.filter(matchesFilter);
      if (filtered.length === 0) {
        timeline.innerHTML = '<div class="empty-state"><div style="font-size:20px;opacity:0.4;">🔍</div><div>No logs match current filters</div></div>';
        return;
      }
      const frag = document.createDocumentFragment();
      filtered.forEach((log) => frag.appendChild(createLogRow(log)));
      timeline.appendChild(frag);

      if (autoScroll) {
        timeline.scrollTop = timeline.scrollHeight;
      }
    }

    function appendIncomingLog(log) {
      if (logs.length === 1) {
        timeline.innerHTML = '';
      }
      if (matchesFilter(log)) {
        timeline.appendChild(createLogRow(log));
        if (autoScroll) {
          timeline.scrollTop = timeline.scrollHeight;
        }
      }
    }

    function setServiceFilter(s) {
      activeService = s;
      renderServicePills();
      renderFilteredTimeline();
    }

    function setLevelFilter(lvl, btn) {
      activeLevel = lvl;
      document.querySelectorAll('.segment-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderFilteredTimeline();
    }

    function onSearchChange(val) {
      searchQuery = val.trim();
      renderFilteredTimeline();
    }

    function clearTimeline() {
      logs.length = 0;
      serviceCounts.clear();
      updateKPIs();
      renderServicePills();
      timeline.innerHTML = '<div class="empty-state"><div style="font-weight:600;color:var(--text-muted);">Console buffer cleared</div><div style="font-size:12px;color:var(--text-dim);">Listening for new microservice events...</div></div>';
    }

    function copySessionReport() {
      const summary = '# TraceWatch Session Report\\n' +
        '*Exported: ' + new Date().toLocaleString() + '*\\n\\n' +
        '## Metrics\\n- Total Events: ' + logs.length + '\\n- Total Failures: ' + logs.filter(isFailure).length + '\\n\\n' +
        '## Timeline Logs\\n\`\`\`\\n' +
        logs.map((l) => formatTime(l.timestamp) + ' | ' + l.service.padEnd(10) + ' | ' + l.message).join('\\n') +
        '\\n\`\`\`';
      navigator.clipboard.writeText(summary).then(() => {
        alert('Diagnostic report copied to clipboard in clean Markdown!');
      });
    }

    // Connect Server-Sent Events stream
    const sse = new EventSource('/api/logs/stream');
    sse.onmessage = (msg) => {
      try {
        const log = JSON.parse(msg.data);
        logs.push(log);
        const count = (serviceCounts.get(log.service) || 0) + 1;
        serviceCounts.set(log.service, count);

        updateKPIs();
        if (count === 1) {
          renderServicePills();
        }

        appendIncomingLog(log);
      } catch (e) {}
    };

    sse.onerror = () => {
      document.getElementById('conn-status').textContent = 'Disconnected';
      document.getElementById('conn-status').parentElement.style.borderColor = 'rgba(244,63,94,0.3)';
      document.getElementById('conn-status').parentElement.style.color = '#fb7185';
    };

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'e' || e.key === 'E') { triggerExplain(); }
      if (e.key === 'c' || e.key === 'C') { clearTimeline(); }
      if (e.key === 'd' || e.key === 'D') { copySessionReport(); }
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('filter-search').focus();
      }
    });

    // Explain Failure
    async function triggerExplain() {
      const diag = document.getElementById('diag-container');
      diag.innerHTML = '<div class="incident-box"><div style="display:flex;align-items:center;gap:10px;"><span class="status-dot"></span><span style="font-weight:600;">Analyzing service cascade traces...</span></div></div>';

      try {
        const res = await fetch('/api/explain');
        const data = await res.json();

        if (!data.found || !data.finding) {
          diag.innerHTML = '<div class="incident-box is-healthy"><div class="incident-headline is-healthy">✅ Zero Failure Signatures Detected</div><div style="font-size:12px;color:var(--text-muted);margin-top:6px;">' + escapeHtml(data.message || 'All monitored services operated within normal parameters.') + '</div></div>';
          return;
        }

        const f = data.finding;
        const isAi = String(f.rule || '').startsWith('ai-') || f.rule === 'ai-fallback';
        const confidence = Math.round((Number(f.confidence) || 0) * 100);

        let html = '<div class="incident-box">';
        html += '<div class="incident-headline">' + escapeHtml(f.cause || 'Service breakdown detected') + '</div>';
        html += '<div class="incident-meta-row">';
        html += '<span class="meta-tag ' + (isAi ? 'tag-ai' : 'tag-rule') + '">' + (isAi ? '✦ AI SUPERVISOR' : 'DETERMINISTIC RULE') + '</span>';
        html += '<span class="mono" style="font-size:11px;color:var(--text-muted);">' + confidence + '% confidence · ' + escapeHtml(f.rule || 'rule') + '</span>';
        html += '</div></div>';

        // Failure Cascade Flow
        if (Array.isArray(f.evidence) && f.evidence.length > 1) {
          html += '<div><div class="section-title">Cascade Chain Propagation</div><div class="cascade-flow">';
          f.evidence.forEach((ev, idx) => {
            const sName = typeof ev === 'string' ? 'AI SIGNAL' : String(ev.service || 'SERVICE').toUpperCase();
            const sColor = getServiceColor(sName);
            const isRoot = idx === 0;
            html += '<div class="cascade-node ' + (isRoot ? 'root-cause' : '') + '">';
            html += '<span class="node-service" style="color:' + sColor + ';">' + escapeHtml(sName) + (isRoot ? ' (ROOT)' : '') + '</span>';
            html += '<span class="node-status mono">' + (typeof ev === 'string' ? 'Signal' : escapeHtml(String(ev.level || 'err').toUpperCase())) + '</span>';
            html += '</div>';
            if (idx < f.evidence.length - 1) {
              html += '<span class="cascade-arrow">➔</span>';
            }
          });
          html += '</div></div>';
        }

        // Evidence section
        if (Array.isArray(f.evidence) && f.evidence.length > 0) {
          html += '<div><div class="section-title">Causal Evidence Logs</div><div class="evidence-block">';
          f.evidence.forEach((ev) => {
            if (typeof ev === 'string') {
              html += '<div class="evidence-card"><div class="mono" style="color:#e4e4e7;">' + escapeHtml(ev) + '</div></div>';
            } else {
              const time = formatTime(ev.timestamp);
              const sColor = getServiceColor(ev.service);
              html += '<div class="evidence-card">';
              html += '<div class="evidence-top mono"><span>' + time + '</span><span style="color:' + sColor + ';font-weight:700;">' + escapeHtml(String(ev.service || '').toUpperCase()) + '</span></div>';
              html += '<div class="mono" style="color:#e4e4e7;">' + escapeHtml(ev.message || '') + '</div>';
              html += '</div>';
            }
          });
          html += '</div></div>';
        }

        // Actionable Remediation Fix
        if (f.fix) {
          html += '<div class="fix-card"><div class="fix-title">Suggested Remediation</div><div class="fix-body mono">' + escapeHtml(f.fix) + '</div></div>';
        }

        diag.innerHTML = html;
      } catch (err) {
        diag.innerHTML = '<div class="incident-box"><div style="color:#fb7185;font-weight:700;">Diagnosis failed</div><div style="font-size:12px;color:var(--text-dim);margin-top:4px;">Failed to reach diagnostic endpoint.</div></div>';
      }
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
