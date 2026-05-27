-- =============================================================================
-- REPO FILE: supabase-add-hex-map.sql
--
-- LABEL IN YOUR WORKSPACE: Chronos — 02 games.hex_map
-- Run AFTER: supabase-schema.sql   BEFORE: pins, turn-engine
-- =============================================================================

-- Add hex_map column to games table
-- Run in Supabase SQL Editor → Dashboard → SQL Editor

alter table public.games
  add column if not exists hex_map jsonb;

comment on column public.games.hex_map is
  'Flat array of HexCell objects (30×20 = 600 entries). '
  'Schema: {q, r, terrain, resource, owner (civ_id|null), explored_by (civ_id[])}';
