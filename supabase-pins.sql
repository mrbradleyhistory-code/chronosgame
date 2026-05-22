-- Run this any time to install or reinstall the PIN management functions.
-- Safe to re-run — uses CREATE OR REPLACE and IF NOT EXISTS.

create extension if not exists pgcrypto;

-- verify_student_pin: called by unauthenticated students
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

-- reset_civ_pin: teacher-only, returns new plaintext PIN once
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

-- create_civ_with_pin: teacher-only, inserts civ and returns (civ_id, pin)
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
