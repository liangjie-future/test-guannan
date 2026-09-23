# FP-003 Test Cases

## Real Python service and worker

- TC-01: A logged-in session publishes valid content; the result is `OK`, the author comes from the Python session, and SQLite contains the trimmed post.
- TC-02: Empty and whitespace-only content returns `EMPTY_CONTENT` and does not insert a row.
- TC-03: Trimmed content with exactly 280 Unicode code points succeeds and persists the trimmed value.
- TC-04: Trimmed content with 281 Unicode code points returns `TOO_LONG` and does not insert a row.
- TC-05: Missing, expired, and logged-out session tokens do not publish and return an unauthenticated result.
- TC-06: A logged-in timeline contains posts only from followed users, never the viewer or unfollowed users.
- TC-07: A viewer with no follows receives an empty timeline even when own posts exist.
- TC-08: Multiple posts are returned in descending real `created_at` order with `author_username`.
- TC-09: Timeline and post bridge failures surface as HTTP 503; no success markup is emitted.

## HTTP and default assembly

- TC-10: Real `POST /compose` uses the cookie session token, renders success only after Python returns `OK`, and persists to the configured `DATA_DIR/social.db`.
- TC-11: Real `GET /timeline` uses the cookie session token and renders Python's order without Node-side filtering or sorting.
- TC-12: Anonymous or invalid-session access to `/compose` and `/timeline` redirects to `/login`.
- TC-13: `startServer` performs no bootstrap, mock construction, demo seeding, or fixed-token fallback; a fresh database has no users or posts.
- TC-14: Restarting with the same `DATA_DIR` sees the same real users, follows, and posts.
- TC-15: Explicitly injected page mocks remain usable for focused HTML tests.
- TC-16: `npm start` and `./run start --foreground` resolve the same absolute `DATA_DIR/social.db`.

## Error and boundary coverage

- TC-17: Invalid form bodies and oversized bodies are rejected without writing a post.
- TC-18: HTML escaping remains effective for successful and failed post content and timeline fields.
- TC-19: Python protocol, process, timeout, and storage failures return 503 and never retry a write.
