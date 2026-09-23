# FP-001 Python Bridge Foundation Test Cases

## Bridge protocol

- TC-01: A valid health request returns a versioned successful envelope and
  creates an empty SQLite database with all four tables.
- TC-02: Register, login, current-user, list-users, follow, create-post,
  timeline, and logout requests use the existing Python store/services and
  preserve data across separate worker processes.
- TC-03: Missing or malformed request fields return `INVALID_REQUEST`.
- TC-04: Unknown operations return `UNKNOWN_OPERATION`; intentionally
  unsupported application wiring returns `NOT_IMPLEMENTED`.
- TC-05: Python exceptions become safe `STORAGE_ERROR` or `SERVICE_ERROR`
  envelopes without stack traces, passwords, or tokens.

## Node synchronous bridge

- TC-06: A successful child response is parsed and returned.
- TC-07: Invalid JSON, wrong protocol version, malformed envelope, non-zero
  exit, and spawn errors are bridge failures.
- TC-08: A child timeout fails the request and is not retried.
- TC-09: stdout or stderr at or above 1 MiB fails the request.
- TC-10: The bridge sends the absolute database path and uses the configured
  Python executable and worker path.

## Startup and runtime lifecycle

- TC-11: An empty temporary data directory passes health, creates `social.db`,
  and then listens; no seed rows are present.
- TC-12: Python unavailable, health failure, or SQLite failure rejects startup
  before listening and does not fall back to Mock data.
- TC-13: A runtime bridge failure maps to HTTP 503.
- TC-14: `npm start`, `node src/server.js`, and `./run start --foreground`
  consume the same absolute `DATA_DIR/social.db` configuration.
- TC-15: SIGTERM and SIGINT close the HTTP server and release timers; failed
  startup leaves no listening port.

## Regression and verification

- TC-16: Existing Node tests and Python storage/service tests remain passing.
- TC-17: The repository provides a minimal development pytest dependency file
  and the documented venv command is executable.
