-- The mark a king brings with them.
--
-- The card had a name, a message and a link. A brand holding the throne wants
-- its mark up there too, and there was nowhere to put one.
--
-- This is deliberately NOT a url. A payer-supplied image address would mean
-- widening img-src past 'self' to the whole web, fetching from a host we do
-- not control on every page load, and moderating pictures instead of a
-- hundred characters of text -- three problems for one line of decoration.
--
-- So the column holds a slug, and the site draws the mark itself from a small
-- registry of inline SVGs it ships. Unknown slug, nothing drawn. The claim
-- form does not offer the field and edit_reign() does not write it: this is
-- set from the dashboard, by whoever runs the site, for a brand they have
-- agreed to draw. A king still writes their own name, message and link.

alter table public.reigns
  add column if not exists logo text
    check (logo is null or logo ~ '^[a-z0-9][a-z0-9.-]{0,39}$');

comment on column public.reigns.logo is
  'Slug of a mark the site ships as inline SVG (see MARKS in app.js). Not payer-settable: edit_reign() never writes it.';

-- The card reads the king view, so the column has to reach it. Dropped and
-- rebuilt rather than replaced: `create or replace view` can only append a
-- column, and "cannot change name of view column" is what it says when you
-- try to put one in the middle. Nothing else depends on this view --
-- attempts_on_king joins the table, not this.
drop view if exists public.king;
create view public.king
with (security_invoker = true) as
  select r.id, r.amount_cents, r.currency, r.name, r.url, r.message, r.logo, r.crowned_at
  from public.reigns r
  where r.dethroned_at is null;

grant select (logo) on public.reigns to anon, authenticated;
grant select on public.king to anon, authenticated;

-- And the replication stream, or a crowning would move the page without the
-- mark until the next poll.
do $do$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime'
               and schemaname = 'public' and tablename = 'reigns') then
    alter publication supabase_realtime drop table public.reigns;
  end if;
end;
$do$;

alter publication supabase_realtime add table public.reigns
  (id, amount_cents, currency, name, url, message, logo, crowned_at, dethroned_at);
