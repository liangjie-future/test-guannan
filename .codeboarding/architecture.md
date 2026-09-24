# Architecture

## Overview

This is a small social/microblogging application — registration, authentication, posts, follows, and timeline assembly — delivered as two parallel implementations, one in Python and one in Node.js, with Docs & Design Specs capturing the system designs, acceptance/test cases, and operational procedures. The Node HTTP Server & Routing module acts as the runtime entry point, handling server bootstrap, request handling, route dispatch, form-body parsing, and configuration, with the request path continuing through the Node business/UI stack.

## Architectural Patterns

- Layered monolith (3 tiers): Presentation (Node SSR) →
- Ports & Adapters / Contract Injection: all cross-component
- Mock-based cross-language seam: Python services bridged to Node
- Session-guard middleware pattern: requireLogin + RESTRICTED_PATHS with HttpOnly/SameSite=Lax
- PRG (Post-Redirect-Get) for follow/compose actions
- Repository pattern: DataStore encapsulates all SQL; services never
- Spec-driven vertical slices: each FP-XXX card = one
- Seed-data conventions: seeded users/sessions/tokens shared between implementations for

## Project Context

- **Project Type:** Full-stack social web application
- **Domain:** Web development / Social Media

## Tech Stack

`Node.js/TypeScript`

## Common Commands

### Test

```bash
npm run test
```

## Key Entry Points

- `src/index.js`
- `src/server.js`

## Modules

_Each module links to a per-module keyword file listing its native symbols (file/function/class names kept verbatim for exact grep), ranked by importance. The exact formula depends on the module's graph density: dense graphs use `0.30·bridge + 0.30·usage + 0.15·type + 0.15·activity + 0.10·exported`; sparse graphs (calls hidden behind runtime dispatch) use `0.20·bridge + 0.20·usage + 0.15·type + 0.15·activity + 0.15·exported + 0.15·file_hub`. See each keyword file's header for the rule that produced its scores. Agents read a module's keyword file on demand._

### Docs & Design Specs

Non-code artifacts documenting system designs, acceptance/test cases, and operational procedures.

### Python Security Subsystem

Password handling (hashing/verification) and security-related seeding for the Python implementation. [evidence-linked: 4 call edges]

- Keywords: [`keywords/2.md`](keywords/2.md) — 6 scored symbol(s)

### Python Service Layer

Core business logic of the app — authentication, registration, posts, follows, and timeline assembly. [evidence-linked: 3 call edges]

- Keywords: [`keywords/3.md`](keywords/3.md) — 25 scored symbol(s)

### Python Storage Subsystem

Persistence of users/posts/follows plus seeded initial data for the Python implementation. [evidence-linked: 1 call edges]

- Keywords: [`keywords/4.md`](keywords/4.md) — 21 scored symbol(s)

### Node HTTP Server & Routing

Server bootstrap, request handling, route dispatch, form-body parsing, and configuration. [evidence-linked: 26 call edges]

- Keywords: [`keywords/5.md`](keywords/5.md) — 26 scored symbol(s)

### Node Business Services

Node-side counterparts of the Python service layer — login, registration, posting, and follow operations. [evidence-linked: 12 call edges]

- Keywords: [`keywords/6.md`](keywords/6.md) — 13 scored symbol(s)

### Node State & Identity

In-memory persistence of the social graph and sessions, and resolving the current user from session state. [evidence-linked: 6 call edges]

- Keywords: [`keywords/7.md`](keywords/7.md) — 28 scored symbol(s)

### Node UI Rendering

Server-side HTML rendering of layouts, pages, and reusable components. [evidence-linked: 14 call edges]

- Keywords: [`keywords/8.md`](keywords/8.md) — 47 scored symbol(s)

### Build, Run & Test Tooling

Packaging, execution entry points, and automated test suites for both ecosystems.

