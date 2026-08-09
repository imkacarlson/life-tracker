-- Custom spellcheck dictionary: words the user has told the editor to stop
-- flagging.
--
-- NOTE: this file was reconstructed from the remote migration history, which is
-- the authoritative record of what was actually applied. The migration was
-- originally applied without a local file being committed, which is what left
-- the CLI unable to run `db push`.

create table public.custom_dictionary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  word text not null,
  created_at timestamptz default now()
);

alter table public.custom_dictionary enable row level security;

create policy "Users can read their custom words"
  on public.custom_dictionary for select using (auth.uid() = user_id);
create policy "Users can insert their custom words"
  on public.custom_dictionary for insert with check (auth.uid() = user_id);
create policy "Users can delete their custom words"
  on public.custom_dictionary for delete using (auth.uid() = user_id);

create index custom_dictionary_user_id_idx on public.custom_dictionary (user_id);
