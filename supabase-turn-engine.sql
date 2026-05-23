-- ============================================================
-- Chronos — turn planning queues + student play RPCs + buildings
--
-- HOW TO RUN THIS (you can run the ENTIRE file at once)
-- ------------------------------------------------------------
-- 1. Open the Supabase website and sign in.
-- 2. Click your Chronos project.
-- 3. In the left sidebar, click "SQL Editor".
-- 4. Click "New query".
-- 5. Open this file on your computer, select everything (Cmd+A), copy (Cmd+C).
-- 6. Paste into the big empty box in Supabase, then click "Run" (or press Cmd+Enter).
-- 7. If it says "Success", you're done. If you changed functions and the game
--    still acts odd, run this one line in a new query:  notify pgrst, 'reload schema';
--
-- Run after your main game tables exist (games, civilizations). If you have not
-- run the base schema yet, do that first.
-- Enable Realtime (Dashboard → Database → Replication) for:
--   public.games
-- ============================================================

-- Buildings placed via BUILD actions (persisted JSON array)
alter table public.civilizations
  add column if not exists buildings jsonb not null default '[]';

comment on column public.civilizations.buildings is
  'Array of { q, r, buildingId } objects claimed through BUILD resolutions.';

-- ------------------------------------------------------------
-- turn_action_slots — student plans (≤3 slots) reviewed by teacher
-- ------------------------------------------------------------
create table if not exists public.turn_action_slots (
  id            uuid primary key default uuid_generate_v4(),
  game_id       uuid not null references public.games(id) on delete cascade,
  civ_id        uuid not null references public.civilizations(id) on delete cascade,
  turn_number   integer not null,
  slot_index    integer not null check (slot_index >= 0 and slot_index <= 2),
  action_type   text not null check (action_type in (
    'EXPAND','EXPLORE','ATTACK','TRADE','RESEARCH','BUILD','ENACT_POLICY'
  )),
  payload       jsonb not null default '{}',
  review_status text not null default 'submitted' check (
    review_status in ('draft','submitted','approved','rejected','modified')
  ),
  reviewed_payload jsonb,
  submitted_at timestamptz not null default now(),
  unique (civ_id, turn_number, slot_index)
);

create index if not exists turn_action_slots_game_turn_idx
  on public.turn_action_slots(game_id, turn_number);

alter table public.turn_action_slots enable row level security;

drop policy if exists "Teacher manages turn action slots" on public.turn_action_slots;
create policy "Teacher manages turn action slots"
  on public.turn_action_slots for all
  using (
    exists (
      select 1 from public.games g
      where g.id = game_id and g.teacher_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- Read policies for playable student clients (PIN auth in RPC)
-- ------------------------------------------------------------
drop policy if exists "Anyone can read civ rows in playable games" on public.civilizations;

create policy "Anyone can read civ rows in playable games"
  on public.civilizations for select
  using (
    exists (
      select 1 from public.games g
      where g.id = civilizations.game_id
        and g.status in ('active','paused','review')
    )
  );

-- ------------------------------------------------------------
-- Student RPCs — PostgREST can bind alphabetically sorted JSON keys to arg order:
--   • verify_student_pin(p_raw_pin, p_username)
--   • get_student_play_state — same PIN pair naming
--   • submit_turn_queue(p_raw_pin, p_slots, p_username) → pin, payload, civ name
-- Renaming identifiers requires DROP — CREATE OR REPLACE cannot rename parameters.
-- ------------------------------------------------------------
-- Postgres distinguishes overloads by arg *types*: old submit was (text,text,jsonb);
-- current is PIN text, slots jsonb, username text → (text, jsonb, text). Drop both.
drop function if exists public.submit_turn_queue(text, text, jsonb);
drop function if exists public.submit_turn_queue(text, jsonb, text);
drop function if exists public.get_student_play_state(text, text);
drop function if exists public.verify_student_pin(text, text);

-- ------------------------------------------------------------
-- verify_student_pin — include buildings column in return set
-- ------------------------------------------------------------
create or replace function public.verify_student_pin(
  p_raw_pin  text,
  p_username text
)
returns table(
  id             uuid,
  game_id        uuid,
  group_name     text,
  username       text,
  resources      jsonb,
  territory      jsonb,
  techs          jsonb,
  policies       jsonb,
  action_points  integer,
  color          text,
  buildings      jsonb
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
    select c.id, c.game_id, c.group_name, c.username,
           c.resources, c.territory, c.techs, c.policies,
           c.action_points, c.color, coalesce(c.buildings, '[]'::jsonb)
    from public.civilizations c
    join public.games g on g.id = c.game_id
    where c.username = lower(trim(p_username))
      and g.status = 'active'
      and c.pin_hash = crypt(p_raw_pin, c.pin_hash);
end;
$$;

grant execute on function public.verify_student_pin(text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- get_student_play_state — authenticated by PIN pair (same keys as verify_student_pin)
-- Returns civ JSON + game snippet + queued slots this turn.
-- ------------------------------------------------------------
create or replace function public.get_student_play_state(
  p_raw_pin  text,
  p_username text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  row record;
begin
  select c.*
  into row
  from public.civilizations c
  join public.games g on g.id = c.game_id
  where c.username = lower(trim(p_username))
    and g.status in ('active','paused')
    and c.pin_hash = crypt(p_raw_pin, c.pin_hash);

  if row is null then
    return null;
  end if;

  return jsonb_build_object(
    'civ', jsonb_build_object(
      'id', row.id,
      'game_id', row.game_id,
      'group_name', row.group_name,
      'username', row.username,
      'resources', row.resources,
      'territory', row.territory,
      'techs', row.techs,
      'policies', row.policies,
      'action_points', row.action_points,
      'color', row.color,
      'buildings', coalesce(row.buildings, '[]'::jsonb)
    ),
    'game', (
      select jsonb_build_object(
        'id', g.id,
        'current_turn', g.current_turn,
        'status', g.status,
        'settings', g.settings
      )
      from public.games g
      where g.id = row.game_id
      limit 1
    ),
    'queue',
    (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'game_id', s.game_id,
          'civ_id', s.civ_id,
          'turn_number', s.turn_number,
          'slot_index', s.slot_index,
          'action_type', s.action_type,
          'payload', s.payload,
          'review_status', s.review_status,
          'reviewed_payload', s.reviewed_payload,
          'submitted_at', s.submitted_at
        ) order by s.slot_index asc
      ), '[]'::jsonb)
      from public.turn_action_slots s
      where s.civ_id = row.id
        and s.turn_number = (
          select g2.current_turn from public.games g2 where g2.id = row.game_id limit 1
        )
    )
  );
end;
$$;

grant execute on function public.get_student_play_state(text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- submit_turn_queue — replace up to 3 slots after PIN check (arg names/order for PostgREST).
-- ------------------------------------------------------------
create or replace function public.submit_turn_queue(
  p_raw_pin  text,
  p_slots    jsonb,
  p_username text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_civ record;
  v_turn int;
  elem jsonb;
  idx int := 0;
begin
  if jsonb_array_length(p_slots) is null then
    raise exception 'invalid_slots' using hint = 'empty';
  end if;

  if jsonb_array_length(p_slots) > 3 then
    raise exception 'invalid_slots' using hint = 'max_three';
  end if;

  select c.* into v_civ
  from public.civilizations c
  join public.games g on g.id = c.game_id
  where c.username = lower(trim(p_username))
    and g.status = 'active'
    and c.pin_hash = crypt(p_raw_pin, c.pin_hash);

  if v_civ is null then
    raise exception 'unauthorized_civ';
  end if;

  select g.current_turn into v_turn
  from public.games g
  where g.id = v_civ.game_id
  limit 1;

  delete from public.turn_action_slots
  where civ_id = v_civ.id
    and turn_number = v_turn;

  idx := 0;
  while idx < jsonb_array_length(p_slots) loop
    elem := p_slots -> idx;

    insert into public.turn_action_slots(
      game_id, civ_id, turn_number, slot_index,
      action_type, payload, review_status
    )
    values (
      v_civ.game_id,
      v_civ.id,
      v_turn,
      coalesce((elem->>'slot_index')::int, idx),
      elem->>'action_type',
      coalesce(elem->'payload', '{}'::jsonb),
      'submitted'
    );

    idx := idx + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'turn_number', v_turn,
    'slot_count', jsonb_array_length(p_slots)
  );
end;
$$;

grant execute on function public.submit_turn_queue(text, jsonb, text) to anon, authenticated;

-- ------------------------------------------------------------
-- Migration: widen action_type constraint on existing installs
-- ------------------------------------------------------------
alter table public.turn_action_slots drop constraint if exists turn_action_slots_action_type_check;
alter table public.turn_action_slots add constraint turn_action_slots_action_type_check
  check (action_type in (
    'EXPAND','EXPLORE','ATTACK','TRADE','RESEARCH','BUILD','ENACT_POLICY'
  ));
