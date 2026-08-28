-- Three console boards beside the ten social ones: PlayStation, Xbox and
-- Nintendo. GTA 6 lands on 19 November 2026 on PS5 and Xbox Series X|S --
-- not on Nintendo, which is here for everything else a Switch plays.
--
-- The `url` column keeps its job unchanged. Its purpose was never "an
-- address" but "one listing per identity per platform", which is what the
-- unique key enforces, and a gamertag is an identity. Where the console has
-- a public profile the identity is that URL and the board links it:
-- psnprofiles.com for PSN, account.xbox.com for a gamertag. Nintendo has no
-- public profile at all, so a friend code is stored as slug:key -- the same
-- folded form the league boards use -- and rendered as text rather than as a
-- link that goes nowhere.

alter table public.listings drop constraint if exists listings_platform_check;

alter table public.listings add constraint listings_platform_check
  check (platform in (
    'x','instagram','tiktok','youtube','twitch',
    'linkedin','threads','facebook','telegram','snapchat',
    'playstation','xbox','nintendo'
  ));
