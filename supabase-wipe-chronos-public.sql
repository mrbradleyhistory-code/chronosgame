-- =============================================================================
-- REPO FILE: supabase-wipe-chronos-public.sql
--
-- LABEL IN YOUR WORKSPACE: Chronos — 00 WIPE public game data (+ RPC drops)
--
-- Deletes ALL Chronos app data in schema public:
--   - Every game, civilization, turn row, queued action, review session, …
--   - Chronos SECURITY DEFINER functions listed below (game auth.user rows stay)
--
-- Does NOT reset Supabase Auth users, JWTs, Storage, Edge Functions, Realtime pub.
-- SAFE for a disposable dev project. DO NOT run on production with real classes.
--
-- After this succeeds, run migrations in order (see SUPABASE-MIGRATIONS.md).
-- =============================================================================

-- ── Chronos RPCs (drop before tables avoid odd dependency errors)
drop function if exists public.submit_turn_queue(text, jsonb, text);
drop function if exists public.submit_turn_queue(text, text, jsonb);
drop function if exists public.get_student_play_state(text, text);
drop function if exists public.teacher_list_turn_slots(uuid, integer);
drop function if exists public.teacher_review_slot(uuid, text, jsonb);
drop function if exists public.verify_student_pin(text, text);
drop function if exists public.reset_civ_pin(uuid);
drop function if exists public.create_civ_with_pin(uuid, text, text, text);

-- ── Tables (respect FK chains; CASCADE tolerates stray deps)
drop table if exists public.review_answers cascade;
drop table if exists public.actions cascade;
drop table if exists public.review_sessions cascade;
drop table if exists public.turn_action_slots cascade;
drop table if exists public.turns cascade;
drop table if exists public.messages cascade;
drop table if exists public.civilizations cascade;
drop table if exists public.games cascade;
drop table if exists public.question_sets cascade;

-- Optional: uncomment ONLY if nothing else depends on extensions in THIS project:
-- drop extension if exists "uuid-ossp";
-- pgcrypto: often shared — leave enabled unless you know it is unused.
