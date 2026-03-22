-- Add type column to notebooks to distinguish tracker vs recipes notebooks.
alter table public.notebooks
  add column if not exists type text not null default 'tracker'
  check (type in ('tracker', 'recipes'));
