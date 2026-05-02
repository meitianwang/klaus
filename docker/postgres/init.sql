-- Auto-run by docker-entrypoint-initdb.d on first container init.
-- These extensions back the Phase 1 schema (decisions #3 + #4):
--   pgcrypto: gen_random_uuid() for users.id PK
--   citext:   case-insensitive UNIQUE on users.email
--   pg_stat_statements: query metrics (also loaded via shared_preload_libraries)

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
