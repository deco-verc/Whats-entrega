---
trigger: glob
globs: "server/**, src/db/**, src/routes/**, src/services/**, *.sql"
description: "DecoHUB Backend SaaS & Persistence Invariants (SQLite WAL, AppSec, Dual-Mode)"
---

# Backend SaaS & Persistence Invariants

<backend_invariants>
1. SQLite WAL & Concurrency:
   - Always initialize SQLite connections with WAL mode and foreign keys enabled:
     PRAGMA journal_mode = WAL;
     PRAGMA foreign_keys = ON;
     PRAGMA busy_timeout = 5000;
   - Wrap multi-statement mutations in explicit transactions (`db.transaction(...)` or `BEGIN IMMEDIATE / COMMIT`).

2. Deterministic Seeding (`seedIfEmpty`):
   - Every database table must have an idempotent `seedIfEmpty()` routine that seeds 15-30 realistic domain records if the table is empty upon server boot.

3. Dual-Mode DOCSIMP Architecture:
   - Supabase Auth: Support live Supabase auth headers with automatic fallback to local JWT/session auth in offline/mock environments.
   - Cloudflare Turnstile: Validate tokens via siteverify endpoint, with development bypass mode when secret keys are absent.
   - PushinPay PIX: Enforce strict idempotency via UUIDv4 `idempotency_key`, storing QR code copy-paste string and base64 SVG representation.
   - Upstash Redis: Implement distributed rate-limiting with in-memory TokenBucket fallback when UPSTASH_REDIS_REST_URL is unset.

4. PORT_GUARD & Route Hygiene:
   - Bind HTTP ports exclusively within 4000-4999: `const PORT = Number(process.env.PORT) || 4000;`. Never bind to 3000, 3001, or 5173.
   - Route separation: `GET /` exclusively serves the static frontend HTML (`public/index.html` or compiled SPA).
   - API Health: Healthchecks are strictly isolated at `GET /api/health` returning JSON `{ status: 'ok', uptime: process.uptime() }`.

5. AppSec by Default:
   - Parameterized queries: 100% of SQL queries must use `?` parameter placeholders. Zero string interpolation in SQL.
   - Path traversal defense: Always validate and bound filesystem paths with `path.resolve` and strict prefix checks.
</backend_invariants>