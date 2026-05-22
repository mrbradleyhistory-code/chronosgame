-- Add hex_map column to games table
-- Run in Supabase SQL Editor → Dashboard → SQL Editor

alter table public.games
  add column if not exists hex_map jsonb;

comment on column public.games.hex_map is
  'Flat array of HexCell objects (30×20 = 600 entries). '
  'Schema: {q, r, terrain, resource, owner (civ_id|null), explored_by (civ_id[])}';
