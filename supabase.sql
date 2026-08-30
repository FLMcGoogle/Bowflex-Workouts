-- Bowflex Progress: Supabase schema
-- Run in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_date date not null,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, workout_date)
);

create table if not exists public.workout_items (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  exercise_name text not null,
  weight numeric(8,2) not null default 0,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.workouts enable row level security;
alter table public.workout_items enable row level security;

drop policy if exists "Users can read own workouts" on public.workouts;
create policy "Users can read own workouts"
on public.workouts for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own workouts" on public.workouts;
create policy "Users can insert own workouts"
on public.workouts for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own workouts" on public.workouts;
create policy "Users can update own workouts"
on public.workouts for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own workouts" on public.workouts;
create policy "Users can delete own workouts"
on public.workouts for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read own workout items" on public.workout_items;
create policy "Users can read own workout items"
on public.workout_items for select
using (
  exists (
    select 1 from public.workouts w
    where w.id = workout_items.workout_id
      and w.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert own workout items" on public.workout_items;
create policy "Users can insert own workout items"
on public.workout_items for insert
with check (
  exists (
    select 1 from public.workouts w
    where w.id = workout_items.workout_id
      and w.user_id = auth.uid()
  )
);

drop policy if exists "Users can update own workout items" on public.workout_items;
create policy "Users can update own workout items"
on public.workout_items for update
using (
  exists (
    select 1 from public.workouts w
    where w.id = workout_items.workout_id
      and w.user_id = auth.uid()
  )
);

drop policy if exists "Users can delete own workout items" on public.workout_items;
create policy "Users can delete own workout items"
on public.workout_items for delete
using (
  exists (
    select 1 from public.workouts w
    where w.id = workout_items.workout_id
      and w.user_id = auth.uid()
  )
);
