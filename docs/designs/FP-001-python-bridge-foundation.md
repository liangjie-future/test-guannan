# FP-001 Python Bridge Foundation

## Approach

- Node owns configuration, HTTP listening, startup health gating, and signal
  handling. `DATA_DIR` is resolved once by `loadConfig`; Python receives the
  absolute `DATA_DIR/social.db` path on every request.
- `src/python-bridge.js` sends one versioned JSON line to a fresh Python
  worker through `spawnSync`. The bridge validates exit status, timeout,
  output size, JSON shape, and protocol version before exposing a result.
- `python_worker.py` validates the request, opens `DataStore`, dispatches
  supported operations to the existing Python services, and emits one safe
  JSON envelope. It never loads seed data.
- `startServer` performs `health` before calling `listen`. A failed health
  check rejects startup, so no HTTP port is opened. Runtime bridge failures
  are surfaced as HTTP 503 rather than replaced with Mock success.
- Existing dependency-injection APIs remain available for unit tests and page
  tests. Production startup uses the real bridge for its persistence-backed
  adapters; unsupported operations return an explicit `NOT_IMPLEMENTED` error.

## Key Decisions

- A fresh short-lived worker per request avoids a hidden Python daemon and
  makes lifecycle ownership unambiguous.
- No automatic retry is performed, especially for writes.
- Error messages are fixed safe messages; passwords, tokens, and tracebacks
  are not written to the Node response or logs.
- `DataStore` creates its parent directory before opening SQLite and continues
  to enable foreign keys and WAL.
