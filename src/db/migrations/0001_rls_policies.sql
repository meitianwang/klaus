-- Phase 1: Row-Level Security policies for all per-user tables.
--
-- Application layer is expected to set `app.current_user_id` once per request
-- via `SET LOCAL app.current_user_id = '<uuid>'`. Then `WHERE user_id = ?`
-- becomes implicit — DB filters rows even if the app forgets.
--
-- Admin / migration scripts use the BYPASSRLS role (klaus_admin) to skip.
--
-- Decision #4: this is the SaaS multi-tenant safety net. Application bugs
-- (forgotten WHERE clause, SQL injection in non-RLS paths) cannot leak
-- cross-tenant data through the app_user role.

-- Helper: read current user id, returning NULL if unset (so admin paths
-- without SET LOCAL get NULL → policy fails closed → no rows visible).
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

-- =====================================================================
-- Per-user tables (8) — one policy each
-- =====================================================================

-- users: a user can only see / mutate their own row
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (id = app_current_user_id())
  WITH CHECK (id = app_current_user_id());

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_settings
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

ALTER TABLE user_prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_prompts
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

ALTER TABLE cron_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cron_tasks
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cron_runs
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sessions
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

ALTER TABLE session_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON session_artifacts
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

ALTER TABLE token_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON token_usage
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

-- =====================================================================
-- Short-lived auth tables: per-user RLS too (a user shouldn't read
-- another user's session tokens / desktop OAuth codes).
-- =====================================================================

ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON auth_sessions
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

ALTER TABLE desktop_auth_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON desktop_auth_codes
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

ALTER TABLE desktop_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON desktop_tokens
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

-- =====================================================================
-- Performance: convert short-lived state tables to UNLOGGED so they
-- skip WAL (acceptable: ~5-min TTL, lost-on-restart is fine).
-- Drizzle generator doesn't support UNLOGGED, so we toggle here.
-- =====================================================================

ALTER TABLE auth_sessions SET UNLOGGED;
ALTER TABLE desktop_auth_codes SET UNLOGGED;

-- =====================================================================
-- Database roles: app vs admin vs readonly
-- =====================================================================

-- klaus_app: day-to-day request handling. NO BYPASSRLS, NO DDL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'klaus_app') THEN
    CREATE ROLE klaus_app NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
END$$;
GRANT CONNECT ON DATABASE klaus TO klaus_app;
GRANT USAGE ON SCHEMA public TO klaus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO klaus_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO klaus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO klaus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO klaus_app;

-- klaus_admin: migrations + admin panel. BYPASSRLS so it can see everything.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'klaus_admin') THEN
    CREATE ROLE klaus_admin NOINHERIT NOSUPERUSER BYPASSRLS;
  END IF;
END$$;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO klaus_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO klaus_admin;

-- klaus_readonly: BI / analytics. SELECT only, no BYPASSRLS (sees own user only — not useful for analytics, prefer service role with BYPASSRLS).
-- Provided as a placeholder; tighten as needed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'klaus_readonly') THEN
    CREATE ROLE klaus_readonly NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
END$$;
GRANT CONNECT ON DATABASE klaus TO klaus_readonly;
GRANT USAGE ON SCHEMA public TO klaus_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO klaus_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO klaus_readonly;
