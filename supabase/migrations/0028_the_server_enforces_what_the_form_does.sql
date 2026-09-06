-- Two rules the browser already applies, moved to where they cannot be
-- skipped.
--
-- create_listing() is granted to anon, so the publishable key in config.js
-- reaches it directly. Everything the add form checks before calling it --
-- a name of at most 40 characters, a link that is a web address -- was
-- checked only in the page. A caller who does not use the page had neither.
--
-- tagline has had char_length <= 80 since 0001 and link has had <= 200 since
-- 0003. handle, the one field that is drawn on every page it appears on, had
-- no limit at all: the ticker, the rows, the card and the front page would
-- have rendered whatever arrived.
--
-- The scheme check is not about XSS. The page's own policy already refuses to
-- run a javascript: URL -- script-src has no 'unsafe-inline' -- so a link like
-- that is inert where it is drawn today. It is about the link being what the
-- column is for: an address a browser can open. Anywhere the value is used
-- without that policy behind it, this is the check that holds.
--
-- Verified against the live table before writing: 137 listings, longest
-- handle 23 characters, 11 links and all of them http(s). Both constraints
-- apply to the existing rows without a single violation.

alter table public.listings
  drop constraint if exists listings_handle_len;
alter table public.listings
  add constraint listings_handle_len
  check (char_length(handle) between 1 and 40);

alter table public.listings
  drop constraint if exists listings_link_scheme;
alter table public.listings
  add constraint listings_link_scheme
  check (link is null or link ~* '^https?://[^[:space:]]+$');

comment on constraint listings_handle_len on public.listings is
  'What the add form already limits a name to. create_listing() is reachable with the publishable key, so the limit lives here too.';
comment on constraint listings_link_scheme on public.listings is
  'A link is a web address. The form checks it; so does this, for callers that are not the form.';
