-- =============================================================================
-- REPO FILE: supabase-turn-engine.sql
--
-- LABEL IN YOUR WORKSPACE: Chronos — 04 turn queues + BUILD + teacher RPCs
-- Run AFTER: supabase-schema.sql, supabase-add-hex-map.sql, supabase-pins.sql
-- Full reset / order: SUPABASE-MIGRATIONS.md
--
-- Enable Realtime (Dashboard → Database → Replication) for public.games (+ others
-- as noted at bottom of schema file).
-- =============================================================================

-- ============================================================
-- Chronos — turn planning queues + student play RPCs + buildings
-- Run in Supabase SQL Editor after base schema / pins migrations.
-- Enable Realtime (Dashboard → Database → Replication) for:
--   public.games
-- ============================================================

-- PostgreSQL 42P13: CREATE OR REPLACE cannot rename parameter identifiers.
-- Run this whole file from the top. If you only paste a fragment, execute this
-- block once first:
--   drop function if exists public.verify_student_pin(text, text);
drop function if exists public.verify_student_pin(text, text);
drop function if exists public.get_student_play_state(text, text);
-- Drop both historical signatures: correct (text,text,jsonb) and wrong (text,jsonb,text) —
-- the latter causes "could not choose the best candidate function" for submit_turn_queue.
drop function if exists public.submit_turn_queue(text, jsonb, text);
drop function if exists public.submit_turn_queue(text, text, jsonb);

create extension if not exists pgcrypto;
-- PIN RPCs below use crypt() from pgcrypto (usually in schema "extensions" on Supabase).

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
  on public.turn_action_slots
  as permissive
  for all
  using (
    exists (
      select 1 from public.games g
      where g.id = turn_action_slots.game_id and g.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.games g
      where g.id = turn_action_slots.game_id and g.teacher_id = auth.uid()
    )
  );

comment on policy "Teacher manages turn action slots" on public.turn_action_slots is
  'Teachers only see decree rows for games they own. The teacher dashboard filters games '
  'by teacher_id; without that, stray active games from other instructors would show in the picker '
  'but this policy would hide all slots.';
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
-- verify_student_pin — include buildings column in return set
-- ------------------------------------------------------------
create or replace function public.verify_student_pin(
  p_username text,
  p_raw_pin  text
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
    where c.username = p_username
      and g.status in ('active', 'paused', 'review')
      and c.pin_hash = crypt(p_raw_pin, c.pin_hash);
end;
$$;

grant execute on function public.verify_student_pin(text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- get_student_play_state — authenticated by PIN pair
-- Returns civ JSON + game snippet + queued slots this turn.
-- ------------------------------------------------------------
create or replace function public.get_student_play_state(
  p_username text,
  p_raw_pin  text
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
    and g.status in ('active','paused','review')
    and c.pin_hash = crypt(p_raw_pin, c.pin_hash);

  if row is null then
    return null;
  end if;

  perform public.ensure_hex_map_spawns_in_place(row.game_id);

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
-- submit_turn_queue — replace up to 3 slots after PIN check.
-- ------------------------------------------------------------
create or replace function public.submit_turn_queue(
  p_username text,
  p_raw_pin text,
  p_slots jsonb
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

  -- Align with get_student_play_state — students may seal decrees whenever they can hydrate
  -- (Teacher "End Session" sets paused; drafts must still queue for tribunal after class.)
  select c.* into v_civ
  from public.civilizations c
  join public.games g on g.id = c.game_id
  where c.username = lower(trim(p_username))
    and g.status in ('active', 'paused', 'review')
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

grant execute on function public.submit_turn_queue(text, text, jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- Migration: widen action_type constraint on existing installs
-- ------------------------------------------------------------
alter table public.turn_action_slots drop constraint if exists turn_action_slots_action_type_check;
alter table public.turn_action_slots add constraint turn_action_slots_action_type_check
  check (action_type in (
    'EXPAND','EXPLORE','ATTACK','TRADE','RESEARCH','BUILD','ENACT_POLICY'
  ));

-- ------------------------------------------------------------
-- teacher_list_turn_slots — tribunal board loader (SECURITY DEFINER)
-- PostgREST direct SELECT can return zero rows when RLS and JWT roles diverge.
-- Mirrors ownership on games then reads slot rows inside DEFINER.
-- ------------------------------------------------------------
drop function if exists public.teacher_list_turn_slots(uuid, integer);

create or replace function public.teacher_list_turn_slots(
  p_game_id uuid,
  p_turn    integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tid uuid := auth.uid();
begin
  if v_tid is null then
    return '[]'::jsonb;
  end if;

  if not exists (
    select 1 from public.games g
    where g.id = p_game_id and g.teacher_id = v_tid
  ) then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(to_jsonb(s) order by s.civ_id asc, s.slot_index asc)
      from public.turn_action_slots s
      where s.game_id = p_game_id
        and s.turn_number = p_turn
    ),
    '[]'::jsonb
  );
end;
$$;

grant execute on function public.teacher_list_turn_slots(uuid, integer) to authenticated;

-- ------------------------------------------------------------
-- Teacher tribunal: security-definer review RPC
-- Bypasses turn_action_slots RLS so rulings persist reliably when
-- the teacher JWT is valid (REST updates can silently affect 0 rows).
-- See also supabase-teacher-review.sql (same definition).
-- ------------------------------------------------------------
drop function if exists public.teacher_review_slot(uuid, text, jsonb);

create or replace function public.teacher_review_slot(
  p_slot_id          uuid,
  p_status           text,
  p_reviewed_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_game_id uuid;
  v_n       int;
begin
  perform set_config('row_security', 'off', true);

  select game_id into v_game_id
  from public.turn_action_slots
  where id = p_slot_id;

  if v_game_id is null then
    return jsonb_build_object('ok', false, 'error', 'slot_not_found');
  end if;

  if not exists (
    select 1 from public.games
    where id = v_game_id
      and teacher_id = auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  if p_status not in ('draft', 'submitted', 'approved', 'rejected', 'modified') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  update public.turn_action_slots
  set
    review_status    = p_status,
    reviewed_payload = case
                         when p_reviewed_payload is not null then p_reviewed_payload
                         else reviewed_payload
                       end
  where id = p_slot_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'update_failed');
  end if;

  return jsonb_build_object(
    'ok',      true,
    'slot_id', p_slot_id,
    'status',  p_status
  );
end;
$$;

grant execute on function public.teacher_review_slot(uuid, text, jsonb) to authenticated;

-- ------------------------------------------------------------
-- save_hex_map_spawns — persist initial civ placement on hex_map
-- Teachers update directly via RLS; students (anon/PIN) may call
-- once when the stored map has zero owned cells.
-- ------------------------------------------------------------
drop function if exists public.hex_map_owner_count(jsonb);
drop function if exists public.save_hex_map_spawns(uuid, jsonb);

create or replace function public.hex_map_owner_count(p_map jsonb)
returns integer
language sql
immutable
as $$
  select coalesce(sum(
    case
      when cell ? 'owner'
       and cell->>'owner' is not null
       and cell->>'owner' <> ''
       and lower(cell->>'owner') <> 'null'
      then 1 else 0
    end
  ), 0)::integer
  from jsonb_array_elements(
    case
      when p_map is null then '[]'::jsonb
      when p_map ? 'cells' then p_map->'cells'
      when jsonb_typeof(p_map) = 'array' then p_map
      else '[]'::jsonb
    end
  ) as cell;
$$;

create or replace function public.save_hex_map_spawns(
  p_game_id uuid,
  p_hex_map jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher   uuid;
  v_status    text;
  v_old       jsonb;
  v_old_count int;
  v_new_count int;
begin
  select teacher_id, status, hex_map
    into v_teacher, v_status, v_old
  from public.games
  where id = p_game_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'game_not_found');
  end if;

  if v_status not in ('lobby', 'active', 'paused', 'review') then
    return jsonb_build_object('ok', false, 'error', 'game_not_spawnable');
  end if;

  v_old_count := public.hex_map_owner_count(v_old);
  v_new_count := public.hex_map_owner_count(p_hex_map);

  if auth.uid() is distinct from v_teacher then
    if v_old_count > 0 or v_new_count = 0 then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
  end if;

  update public.games
  set hex_map = p_hex_map
  where id = p_game_id;

  return jsonb_build_object('ok', true, 'owners', v_new_count);
end;
$$;

grant execute on function public.hex_map_owner_count(jsonb) to authenticated, anon;
grant execute on function public.save_hex_map_spawns(uuid, jsonb) to authenticated, anon;

-- ------------------------------------------------------------
-- list_game_civ_roster — id/name/color for map rendering (no PIN)
-- Students cannot SELECT civilizations directly (teacher-only RLS).
-- ------------------------------------------------------------
drop function if exists public.list_game_civ_roster(uuid);

create or replace function public.list_game_civ_roster(p_game_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'group_name', c.group_name,
        'color', c.color
      )
      order by c.group_name asc
    ),
    '[]'::jsonb
  )
  from public.civilizations c
  join public.games g on g.id = c.game_id
  where c.game_id = p_game_id
    and g.status in ('active', 'paused', 'review', 'ended', 'lobby');
$$;

grant execute on function public.list_game_civ_roster(uuid) to authenticated, anon;

-- ------------------------------------------------------------
-- ensure_hex_map_spawns_in_place — server-side capital + fog bootstrap
-- Runs on student login (get_student_play_state) and via client RPC.
-- ------------------------------------------------------------
drop function if exists public.ensure_hex_map_spawns_in_place(uuid);

create or replace function public.ensure_hex_map_spawns_in_place(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_map     jsonb;
  v_cells   jsonb;
  v_len     int;
  v_i       int;
  v_cell    jsonb;
  v_civ     uuid;
  v_terrain text;
  v_owner   text;
  v_resource text;
  v_expl    jsonb;
  v_has_cap boolean;
  v_placed  boolean;
begin
  select hex_map into v_map from public.games where id = p_game_id;
  if v_map is null or not (v_map ? 'cells') then
    return;
  end if;

  v_cells := v_map->'cells';
  v_len := jsonb_array_length(v_cells);

  for v_civ in select id from public.civilizations where game_id = p_game_id loop
    select exists (
      select 1
      from jsonb_array_elements(v_cells) c
      where c->>'owner' = v_civ::text
    ) into v_has_cap;

    if v_has_cap then
      continue;
    end if;

    v_placed := false;

    -- Prefer land hexes with at least one resource
    for v_i in 0 .. v_len - 1 loop
      v_cell := v_cells->v_i;
      v_owner := v_cell->>'owner';
      v_terrain := coalesce(v_cell->>'terrain', 'plains');
      v_resource := v_cell->>'resource';

      if v_owner is not null and v_owner <> '' and lower(v_owner) <> 'null' then
        continue;
      end if;

      if v_terrain in ('lake', 'mountain', 'river') then
        continue;
      end if;

      if v_resource is null or v_resource = '' or lower(v_resource) = 'null' then
        continue;
      end if;

      v_cells := jsonb_set(v_cells, array[v_i::text, 'owner'], to_jsonb(v_civ::text), true);

      v_expl := coalesce(v_cell->'explored_by', '[]'::jsonb);
      if not v_expl @> jsonb_build_array(v_civ::text) then
        v_expl := v_expl || jsonb_build_array(v_civ::text);
      end if;
      v_cells := jsonb_set(v_cells, array[v_i::text, 'explored_by'], v_expl, true);

      v_placed := true;
      exit;
    end loop;

    if v_placed then
      continue;
    end if;

    -- Fallback: any passable land hex
    for v_i in 0 .. v_len - 1 loop
      v_cell := v_cells->v_i;
      v_owner := v_cell->>'owner';
      v_terrain := coalesce(v_cell->>'terrain', 'plains');

      if v_owner is not null and v_owner <> '' and lower(v_owner) <> 'null' then
        continue;
      end if;

      if v_terrain in ('lake', 'mountain', 'river') then
        continue;
      end if;

      v_cells := jsonb_set(v_cells, array[v_i::text, 'owner'], to_jsonb(v_civ::text), true);

      v_expl := coalesce(v_cell->'explored_by', '[]'::jsonb);
      if not v_expl @> jsonb_build_array(v_civ::text) then
        v_expl := v_expl || jsonb_build_array(v_civ::text);
      end if;
      v_cells := jsonb_set(v_cells, array[v_i::text, 'explored_by'], v_expl, true);

      exit;
    end loop;
  end loop;

  update public.games
  set hex_map = jsonb_set(v_map, '{cells}', v_cells, true)
  where id = p_game_id;
end;
$$;

grant execute on function public.ensure_hex_map_spawns_in_place(uuid) to authenticated, anon;
