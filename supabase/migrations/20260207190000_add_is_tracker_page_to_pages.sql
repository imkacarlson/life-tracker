alter table public.pages
  add column if not exists is_tracker_page boolean not null default false;

create unique index if not exists pages_one_tracker_per_section_idx
  on public.pages (section_id)
  where is_tracker_page = true;
