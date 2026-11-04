-- Session recordings: rrweb captures of the app (DOM changes, mouse movement,
-- touches, scrolls, plus keystrokes as custom events) so a glitch can be
-- watched back like a video.
--
-- The recordings themselves are gzipped JSON files in the private
-- session-recordings bucket, one file per upload chunk, under
-- <user id>/<session id>/. This table indexes them so the viewer can fetch
-- just the chunks around a moment instead of listing the bucket.

insert into storage.buckets (id, name, public)
values ('session-recordings', 'session-recordings', false)
on conflict (id) do nothing;

-- Same folder-per-user rule as tracker-images. No update/delete: chunks are
-- write-once.
create policy "Users can upload their recordings"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'session-recordings'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
create policy "Users can read their recordings"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'session-recordings'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create table public.recording_chunks (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Same id as activity_events.session_id, so events and video line up.
  session_id uuid not null,
  seq int not null,
  path text not null,
  device text not null check (device in ('phone', 'desktop')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  -- Replay must start from a chunk holding a full DOM snapshot.
  has_full_snapshot boolean not null,
  event_count int not null,
  bytes int not null,
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);

alter table public.recording_chunks enable row level security;

create policy "Users can read their recording chunks"
  on public.recording_chunks for select using ((select auth.uid()) = user_id);
create policy "Users can insert their recording chunks"
  on public.recording_chunks for insert with check ((select auth.uid()) = user_id);

create index recording_chunks_user_time_idx
  on public.recording_chunks (user_id, started_at desc);
create index recording_chunks_session_idx
  on public.recording_chunks (session_id, seq);
