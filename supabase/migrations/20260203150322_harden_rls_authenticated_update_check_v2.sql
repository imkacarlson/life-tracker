alter policy "Users can read their notebooks" on public.notebooks to authenticated;
alter policy "Users can insert their notebooks" on public.notebooks to authenticated;
alter policy "Users can update their notebooks" on public.notebooks to authenticated;
alter policy "Users can update their notebooks" on public.notebooks using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter policy "Users can delete their notebooks" on public.notebooks to authenticated;

alter policy "Users can read their sections" on public.sections to authenticated;
alter policy "Users can insert their sections" on public.sections to authenticated;
alter policy "Users can update their sections" on public.sections to authenticated;
alter policy "Users can update their sections" on public.sections using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter policy "Users can delete their sections" on public.sections to authenticated;

alter policy "Users can read their trackers" on public.pages to authenticated;
alter policy "Users can insert their trackers" on public.pages to authenticated;
alter policy "Users can update their trackers" on public.pages to authenticated;
alter policy "Users can update their trackers" on public.pages using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter policy "Users can delete their trackers" on public.pages to authenticated;;
