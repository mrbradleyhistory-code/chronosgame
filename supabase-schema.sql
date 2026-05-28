-- =============================================================================
-- REPO FILE: supabase-schema.sql
--
-- Supabase’s editor titles this snippet however you saved it — use REPO FILE
-- above to match the file on disk. Run order: see SUPABASE-MIGRATIONS.md
-- LABEL IN YOUR WORKSPACE: Chronos — 01 base schema + RLS + PIN RPCs
-- Requires: hosted Supabase with Auth enabled (games.teacher_id -> auth.users)
-- =============================================================================

-- ============================================================
-- Chronos Game — Supabase Schema
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor)
-- ============================================================

-- Enable UUID extension (already enabled on Supabase)
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- games
-- ------------------------------------------------------------
create table public.games (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  class_name   text not null,
  teacher_id   uuid not null references auth.users(id) on delete cascade,
  current_turn integer not null default 1,
  status       text not null default 'lobby' check (status in ('lobby','active','paused','review','ended')),
  world_seed   text,
  settings     jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

alter table public.games enable row level security;

create policy "Teachers manage own games"
  on public.games for all
  using (auth.uid() = teacher_id);

create policy "Anyone can read active games"
  on public.games for select
  using (status != 'lobby');

-- ------------------------------------------------------------
-- civilizations
-- ------------------------------------------------------------
create table public.civilizations (
  id            uuid primary key default uuid_generate_v4(),
  game_id       uuid not null references public.games(id) on delete cascade,
  group_name    text not null,
  username      text not null,
  pin_hash      text not null,
  resources     jsonb not null default '{}',
  territory     jsonb not null default '{}',
  techs         jsonb not null default '[]',
  policies      jsonb not null default '[]',
  action_points integer not null default 3,
  color         text not null default '#6366f1'
);

alter table public.civilizations enable row level security;

create policy "Teacher reads all civs in own game"
  on public.civilizations for all
  using (
    exists (
      select 1 from public.games g
      where g.id = game_id and g.teacher_id = auth.uid()
    )
  );

-- Students identify via application logic (PIN), not Supabase auth;
-- use a service-role key server-side for civ mutations if needed.

-- ------------------------------------------------------------
-- turns
-- ------------------------------------------------------------
create table public.turns (
  id           uuid primary key default uuid_generate_v4(),
  game_id      uuid not null references public.games(id) on delete cascade,
  turn_number  integer not null,
  century_label text not null,
  events       jsonb not null default '[]',
  resolved_at  timestamptz,
  unique (game_id, turn_number)
);

alter table public.turns enable row level security;

create policy "Anyone reads turns for active games"
  on public.turns for select
  using (
    exists (
      select 1 from public.games g
      where g.id = game_id and g.status != 'lobby'
    )
  );

create policy "Teacher manages turns"
  on public.turns for all
  using (
    exists (
      select 1 from public.games g
      where g.id = game_id and g.teacher_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- actions
-- ------------------------------------------------------------
create table public.actions (
  id           uuid primary key default uuid_generate_v4(),
  game_id      uuid not null references public.games(id) on delete cascade,
  civ_id       uuid not null references public.civilizations(id) on delete cascade,
  turn_id      uuid not null references public.turns(id) on delete cascade,
  action_type  text not null,
  payload      jsonb not null default '{}',
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_at timestamptz not null default now()
);

alter table public.actions enable row level security;

create policy "Teacher reads/manages actions in own game"
  on public.actions for all
  using (
    exists (
      select 1 from public.games g
      where g.id = game_id and g.teacher_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- messages
-- ------------------------------------------------------------
create table public.messages (
  id         uuid primary key default uuid_generate_v4(),
  game_id    uuid not null references public.games(id) on delete cascade,
  content    text not null,
  type       text not null default 'announcement' check (type in ('announcement','event','system')),
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;

create policy "Anyone reads messages for active games"
  on public.messages for select
  using (
    exists (
      select 1 from public.games g
      where g.id = game_id and g.status != 'lobby'
    )
  );

create policy "Teacher manages messages"
  on public.messages for all
  using (
    exists (
      select 1 from public.games g
      where g.id = game_id and g.teacher_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- question_sets
-- ------------------------------------------------------------
create table public.question_sets (
  id          uuid primary key default uuid_generate_v4(),
  teacher_id  uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text,
  questions   jsonb not null default '[]'
);

alter table public.question_sets enable row level security;

create policy "Teacher manages own question sets"
  on public.question_sets for all
  using (auth.uid() = teacher_id);

-- ------------------------------------------------------------
-- review_sessions
-- ------------------------------------------------------------
create table public.review_sessions (
  id                    uuid primary key default uuid_generate_v4(),
  game_id               uuid not null references public.games(id) on delete cascade,
  question_set_id       uuid not null references public.question_sets(id),
  current_question_index integer not null default 0,
  status                text not null default 'pending' check (status in ('pending','active','ended')),
  reward_config         jsonb not null default '{}',
  created_at            timestamptz not null default now()
);

alter table public.review_sessions enable row level security;

create policy "Teacher manages review sessions"
  on public.review_sessions for all
  using (
    exists (
      select 1 from public.games g
      where g.id = game_id and g.teacher_id = auth.uid()
    )
  );

create policy "Anyone reads active review sessions"
  on public.review_sessions for select
  using (status = 'active');

-- ------------------------------------------------------------
-- review_answers
-- ------------------------------------------------------------
create table public.review_answers (
  id                uuid primary key default uuid_generate_v4(),
  review_session_id uuid not null references public.review_sessions(id) on delete cascade,
  question_id       text not null,
  civ_id            uuid not null references public.civilizations(id) on delete cascade,
  answer_index      integer not null,
  is_correct        boolean not null,
  answered_at       timestamptz not null default now()
);

alter table public.review_answers enable row level security;

create policy "Teacher reads answers"
  on public.review_answers for select
  using (
    exists (
      select 1 from public.review_sessions rs
        join public.games g on g.id = rs.game_id
      where rs.id = review_session_id and g.teacher_id = auth.uid()
    )
  );

-- ============================================================
-- PIN management (pgcrypto / bcrypt)
-- Run this block after the tables above.
-- ============================================================

create extension if not exists pgcrypto;

-- crypt()/gen_salt() live in pgcrypto — on Supabase they resolve via schema “extensions”.
-- Always include schema "extensions" in search_path for functions that hash PINs.

-- ------------------------------------------------------------
-- verify_student_pin
-- Called by unauthenticated students; bypasses RLS via SECURITY
-- DEFINER. Returns the matching civ row (excluding pin_hash) or
-- nothing if the username/PIN pair is wrong.
-- ------------------------------------------------------------
-- PG 42P13 if an older install used different parameter names — drop first.
drop function if exists public.verify_student_pin(text, text);

create or replace function public.verify_student_pin(
  p_username text,
  p_raw_pin  text
)
returns table(
  id            uuid,
  game_id       uuid,
  group_name    text,
  username      text,
  resources     jsonb,
  territory     jsonb,
  techs         jsonb,
  policies      jsonb,
  action_points integer,
  color         text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
    select c.id, c.game_id, c.group_name, c.username,
           c.resources, c.territory, c.techs, c.policies,
           c.action_points, c.color
    from public.civilizations c
    join public.games g on g.id = c.game_id
    where c.username = p_username
      and g.status = 'active'
      and c.pin_hash = crypt(p_raw_pin, c.pin_hash);
end;
$$;

grant execute on function public.verify_student_pin(text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- reset_civ_pin
-- Called by authenticated teachers. Generates a random 4-digit
-- PIN, stores its bcrypt hash, and returns the plaintext PIN
-- (shown to the teacher once, never stored).
-- ------------------------------------------------------------
create or replace function public.reset_civ_pin(p_civ_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pin text;
begin
  if not exists (
    select 1 from public.civilizations c
    join public.games g on g.id = c.game_id
    where c.id = p_civ_id and g.teacher_id = auth.uid()
  ) then
    raise exception 'unauthorized';
  end if;

  v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');

  update public.civilizations
  set pin_hash = crypt(v_pin, gen_salt('bf', 10))
  where id = p_civ_id;

  return v_pin;
end;
$$;

grant execute on function public.reset_civ_pin(uuid) to authenticated;

-- ------------------------------------------------------------
-- create_civ_with_pin
-- Called by authenticated teachers. Inserts a new civilization
-- with a fresh bcrypt-hashed PIN and returns (civ_id, pin).
-- ------------------------------------------------------------
create or replace function public.create_civ_with_pin(
  p_game_id    uuid,
  p_username   text,
  p_group_name text,
  p_color      text default '#6366f1'
)
returns table(civ_id uuid, pin text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pin    text;
  v_civ_id uuid;
begin
  if not exists (
    select 1 from public.games g
    where g.id = p_game_id and g.teacher_id = auth.uid()
  ) then
    raise exception 'unauthorized';
  end if;

  v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');

  insert into public.civilizations(game_id, group_name, username, pin_hash, color)
  values (p_game_id, p_group_name, p_username,
          crypt(v_pin, gen_salt('bf', 10)), p_color)
  returning id into v_civ_id;

  return query select v_civ_id, v_pin;
end;
$$;

grant execute on function public.create_civ_with_pin(uuid, text, text, text) to authenticated;

-- ------------------------------------------------------------
-- Realtime (optional): expose `turns` to Postgres replication so INSERT
-- events reach the projector battle strip / student Chronicle without polling.
--
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.turns;
--
-- Teacher Century tribunal live refresh (`TeacherTurnConsole`):
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.turn_action_slots;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.games;
