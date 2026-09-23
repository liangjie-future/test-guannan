# FP-003 真实发帖、关注时间线与默认装配

## Approach

- Keep business rules in the existing Python `PostService` and `TimelineService` backed by the shared SQLite `DataStore`.
- Make the worker resolve the current user from `session_token` for `create_post` and `timeline`; invalid, expired, or logged-out sessions return an unauthenticated result rather than performing work.
- Add token-aware methods to `createRealSocialService`, and adapt the Node page layer so production requests pass the cookie token while injected page tests can continue using their existing `(user, id)` contracts.
- Keep bridge failures as exceptions so the HTTP layer returns 503 and never renders a false success page.
- Remove default seed/mock usage from `startServer`; retain mock factories only for explicit unit-test injection and legacy baseline tests.

## Key Decisions

- The Python session is the source of truth for post authorship and timeline viewer identity. Node user objects are used only for page rendering and access-control checks.
- The default production `createWebServer` path is real when `sessionAccess` is supplied by `startServer`; direct unit-test construction remains injectable.
- `TimelineService` owns scope and timestamp ordering. The Node timeline renderer only renders the returned order.
- No bootstrap operation, fixed account, fixed token, or demo post is called during startup.
