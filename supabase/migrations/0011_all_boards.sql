-- Every board the site offers has to be a value this column accepts.
--
-- The check listed the seventeen boards that existed when it was written, so
-- adding a board in the front end without coming here would let somebody fill
-- in the form, pay Stripe, and have the insert rejected afterwards -- money
-- taken for a listing that cannot exist. This constraint is the real list of
-- boards; app.js only draws it, and scripts/check-boards.mjs fails the build
-- when the two disagree.
--
-- Applied to production on 2026-09-02 as `0004_platform_check_all_boards`,
-- then extended with 'exchanges' as `0005_exchanges_board`.
alter table public.listings drop constraint if exists listings_platform_check;

alter table public.listings add constraint listings_platform_check check (
  platform = any (array[
    -- social networks: you list your own profile
    'x', 'instagram', 'tiktok', 'youtube', 'twitch', 'linkedin', 'threads',
    'facebook', 'telegram', 'snapchat',
    -- the same four platforms, but ranking their creators: fans bid, and the
    -- person ranked is not the person paying
    'x-influencers', 'tiktok-influencers', 'youtube-influencers',
    'facebook-influencers',
    -- gaming
    'playstation', 'xbox', 'nintendo', 'games',
    -- sport
    'nba-teams', 'nba-players', 'nhl-teams', 'nhl-players',
    'football-clubs', 'football-players', 'f1-drivers',
    -- crypto
    'crypto', 'memecoins', 'exchanges', 'gifts',
    -- culture, business, life
    'artists', 'podcasts', 'startups', 'restaurants', 'cities', 'pets'
  ]::text[])
);
