# Chronos — Supabase SQL files (run order)

Supabase SQL Editor names snippets however you saved them (“Untitled”, “migration 7”, …).  
**Identify scripts by the line near the top of each file**:

```text
-- REPO FILE: supabase-xxxx.sql
```

## Full reset on a disposable project

1. **Wipe app objects** — run [`supabase-wipe-chronos-public.sql`](supabase-wipe-chronos-public.sql) end-to-end.  
   Saves your **Auth** users only; destroys every game row and Chronicle dataset.
2. Re-run installs **in this exact order** (each file from **line 1**):

| Step | REPO FILE | Purpose |
|------|-----------|---------|
| 0 *(optional wipe)* | [`supabase-wipe-chronos-public.sql`](supabase-wipe-chronos-public.sql) | **Dev-only:** drops all Chronos tables + listed RPCs |
| 1 | [`supabase-schema.sql`](supabase-schema.sql) | Core tables + RLS + base PIN RPCs |
| 2 | [`supabase-add-hex-map.sql`](supabase-add-hex-map.sql) | `games.hex_map` column |
| 3 | [`supabase-pins.sql`](supabase-pins.sql) | PIN helpers + constraint refresh |
| 4 | [`supabase-turn-engine.sql`](supabase-turn-engine.sql) | Queues + buildings + student/teacher RPCs |

## Student login: `function crypt(text, text) does not exist`

1. Enable **pgcrypto**: run `create extension if not exists pgcrypto;` in the SQL Editor (both `supabase-schema.sql` and `supabase-turn-engine.sql` include this if you run them from the top).
2. Ensure PIN RPCs use `set search_path = public, extensions` so Supabase can resolve `crypt` / `gen_salt`. Re-apply `supabase-turn-engine.sql` (or the full install order) after pulling the latest scripts.

## Decrees missing on teacher tribunal

- The dashboard game list is filtered to **`teacher_id = you`** (otherwise you could pick another instructor’s active game and see no slots).
- The tribunal loads rows via **`teacher_list_turn_slots`**, a SECURITY DEFINER RPC (student writes still bypass RLS; teacher reads hit subtle RLS/role quirks on some hosts). **`turn_action_slots` RLS** no longer restricts the policy with `TO authenticated`, so DELETE after advance works consistently.
- Re-run **`supabase-turn-engine.sql`** from line 1 in the Supabase SQL editor after pulling latest so `teacher_list_turn_slots` exists. If Supabase reports a missing RPC, search the dashboard SQL history for fragments and run the full file.

## Student submit: `could not choose the best candidate function` for `submit_turn_queue`

An old duplicate used argument types `(text, jsonb, text)` instead of `(text, text, jsonb)`. Drop the bad overload, then re-apply `supabase-turn-engine.sql`:

```sql
drop function if exists public.submit_turn_queue(text, jsonb, text);
```

## Updating an existing project (no wipe)

- Run **steps 3–4** when you ship new turn-queue logic; **`supabase-turn-engine.sql`** is written to be re-runnable (`IF NOT EXISTS` where possible + leading `DROP FUNCTION` guards).
- If Postgres returns **42P13** (“cannot change name of input parameter”), run only the **`DROP FUNCTION`** lines at the top of `supabase-turn-engine.sql` once, then the rest of that file.

## Alternative: wipe everything in Supabase

Dashboard **Project Settings → Danger zone → Pause / Delete project** removes the hosted database entirely. Useful when you truly want zero schema left; then create a project and execute **Install order** skipping the wipe script.
