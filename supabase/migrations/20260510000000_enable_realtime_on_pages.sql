-- Enable Supabase Realtime for the pages table.
--
-- Required for the cross-device sync flow in src/hooks/sync/usePageRealtime.js:
-- when one device saves a page, other devices viewing the same page receive
-- the UPDATE event and either swap content in (clean editor) or advance
-- their OCC token so the next save attempt routes through the conflict gate.

alter publication supabase_realtime add table public.pages;
