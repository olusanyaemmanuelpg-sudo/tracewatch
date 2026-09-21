# 📊 TraceWatch Diagnostic Report
*Generated dynamically on 9/21/2026, 6:19:52 PM*

## 🚨 Root Cause Diagnosis
> **demo-app could not acquire a database connection â€” the database pool is completely exhausted.**
> *Confidence Score:* 80% | *Rule Triggered:* ` pool-exhausted`

### 💡 Suggested Fix Action
Increase the pool max size parameter in your database configuration file, or find the missing query path that fails to release its connection client hooks back to the pool.

## 📜 Aggregated Log Timeline
```text
17:17:24.090 | DEMO-APP | 12:04:31.204  web  POST /api/orders
17:17:24.094 | DEMO-APP | 12:04:31.219  api  validating payload
17:17:24.194 | DEMO-APP | 12:04:31.244  db   FATAL:  sorry, too many clients already
17:17:24.198 | DEMO-APP | 12:04:31.251  api  ConnectionAcquireTimeout: timeout acquiring a connection
17:17:24.203 | DEMO-APP | 12:04:31.258  web  Failed to fetch - 500
```

---
*Report generated via TraceWatch CLI — "Don't show me the logs, show me what broke."*
