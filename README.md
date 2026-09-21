# TraceWatch

TraceWatch helps developers quickly diagnose local application crashes by connecting the dots across multiple services. It watches local service outputs in real time, correlates fragmented logs into logical traces, and automatically pinpoints exactly what broke and how to fix it. No complex setup is required, just straightforward incident intelligence that works out of the box.

## System Architecture

```mermaid
flowchart LR
  Service["Local Services"]
  Collector["Log Collector"]
  Store["Event Store"]
  Analyzer["Rule Engine"]
  Dashboard["Web Dashboard"]

  Service -- "stdout / stderr" --> Collector
  Collector --> Store
  Store -- "Analyze traces" --> Analyzer
  Analyzer --> Dashboard
  Store -- "Live feed" --> Dashboard

  style Service fill:#1e1b4b,stroke:#6366f1,stroke-width:2px,color:#fff
  style Collector fill:#2e1065,stroke:#8b5cf6,stroke-width:2px,color:#fff
  style Store fill:#4c0519,stroke:#ef4444,stroke-width:2px,color:#fff
  style Analyzer fill:#022c22,stroke:#10b981,stroke-width:2px,color:#fff
  style Dashboard fill:#1e1b4b,stroke:#6366f1,stroke-width:2px,color:#fff
```

## Installation

Clone the repository and install the required dependencies:

```bash
git clone https://github.com/olusanyaemmanuelpg-sudo/tracewatch.git
cd tracewatch
npm install
```

To make the tool available globally on your machine, link the package:

```bash
npm link
```

## Usage

TraceWatch operates through a simple command-line interface. 

First, initialize the workspace in your project directory. This scans your local files and generates a configuration profile:

```bash
tracewatch init
```

Next, start the configured services. Adding the web flag will launch the live operations dashboard alongside the terminal output:

```bash
tracewatch start --web
```

If an error occurs, you can ask the tool to explain the latest failure. TraceWatch will sweep the log sequence and determine the root cause:

```bash
tracewatch explain
```

To export a sanitized, credential-free diagnostic report to a markdown file, run the export command:

```bash
tracewatch export --out diagnosis.md
```

## Features

* **Automatic Stack Discovery**: Scans the project directory and detects Node.js or Python frameworks to build a configuration profile automatically.
* **Live Operations Dashboard**: Streams structured logs to a browser UI while highlighting critical errors and correlating cross-service events.
* **Redacted Reporting**: Strips out credential strings, access tokens, and passwords before exporting diagnostic markdown reports.
* **Root Cause Analysis**: Sweeps over trace timelines to match error signatures against known failures like exhausted connection pools or missing environment variables.

```mermaid
sequenceDiagram
  actor Developer
  participant CLI as "TraceWatch CLI"
  participant Store as "Event Store"
  participant Engine as "Rule Engine"

  Developer->>CLI: Run tracewatch explain
  CLI->>Store: Read session logs
  Store->>CLI: Return log history
  CLI->>Engine: Correlate and evaluate traces
  Engine->>CLI: Return top diagnostic finding
  CLI->>Developer: Print root cause and fix action
```

## Technologies Used

| Category | Technology |
| :--- | :--- |
| Runtime | Node.js |
| Terminal Output | Picocolors |
| Dashboard UI | HTML5, CSS3, Vanilla JavaScript |
| Data Storage | JSON-Lines |

## API Documentation

When the web dashboard is running, TraceWatch exposes a lightweight local HTTP server with the following endpoints.

#### GET /api/logs/stream
**Description**: Opens a Server-Sent Events connection that streams live log data as it is captured from the running services.

**Request**:
No body required.

**Response**:
The endpoint returns a continuous text stream formatted as SSE.
```text
data: {"id":"evt_123","timestamp":"2026-09-21T22:41:04.413Z","service":"api","level":"info","message":"validating payload","requestId":null}

```

**Errors**:
* 404: Endpoint not found if requested with unsupported methods.

#### GET /api/explain
**Description**: Triggers an immediate analysis over the current session buffer and returns the highest confidence root cause finding.

**Request**:
No body required.

**Response**:
```json
{
  "found": true,
  "finding": {
    "rule": "pool-exhausted",
    "cause": "demo-app could not acquire a database connection as the database pool is completely exhausted.",
    "confidence": 0.8,
    "evidence": [
      {
        "id": "evt_456",
        "timestamp": "2026-09-21T22:41:04.514Z",
        "service": "db",
        "level": "fatal",
        "message": "FATAL: sorry, too many clients already",
        "requestId": null
      }
    ],
    "fix": "Increase the pool max size parameter in your database configuration file."
  }
}
```

**Errors**:
* 200: Returns `{"found": false}` if no rule violations are detected.

## Contributing

Contributions are welcome. Please open an issue to discuss proposed changes before submitting a pull request. Ensure that any new rule additions include appropriate regex matching logic and test coverage.

## Author Info

* LinkedIn: https://linkedin.com/in/olusanya-emmanuel-21546536a

---

[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

[![Readme was generated by Dokugen](https://img.shields.io/badge/Readme%20was%20generated%20by-Dokugen-brightgreen)](https://dokugen.samueltuoyo.com)