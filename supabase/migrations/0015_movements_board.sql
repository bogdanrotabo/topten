-- Movements: a board beside the parties, under no country.
--
-- This constraint is the real list of boards. A board drawn in the front end
-- that this check rejects lets somebody fill in the form, pay Stripe, and have
-- the insert fail afterwards -- money taken for a listing that cannot exist.
--
-- Applied to production on 2026-09-03 as `0011_movements_board`.
alter table public.listings drop constraint if exists listings_platform_check;

alter table public.listings add constraint listings_platform_check check (
  platform = any (array[
    'x', 'instagram', 'tiktok', 'youtube', 'twitch', 'linkedin', 'threads',
    'facebook', 'telegram', 'snapchat',
    'x-influencers', 'instagram-influencers', 'tiktok-influencers',
    'youtube-influencers', 'facebook-influencers',
    'playstation', 'xbox', 'nintendo', 'games',
    'nba-teams', 'nba-players', 'nhl-teams', 'nhl-players',
    'football-clubs', 'football-players', 'f1-drivers', 'golf-players',
    'ufc-fighters', 'mma-fighters', 'boxers',
    'bellator', 'one-championship', 'pfl',
    'crypto', 'memecoins', 'exchanges', 'gifts',
    'artists', 'podcasts', 'actors', 'movies',
    'cars', 'boats',
    'us-parties', 'us-politicians', 'movements',
    'startups', 'restaurants', 'cities', 'pets'
  ]::text[])
);
