-- Four league boards: NBA and NHL, teams and players kept apart. A top ten
-- holding both the Lakers and LeBron is not a ranking of anything.
--
-- These are fan boards. Nobody listed here owns the listing or touches the
-- money -- there is no account to link and no profile to claim, so the
-- identity is the name, folded down to slug:key (lower case, accents off,
-- punctuation out, spaces collapsed). That fold is what stops "LeBron James"
-- and "lebron  james" becoming two rows with the same man's fans split
-- across both.

alter table public.listings drop constraint if exists listings_platform_check;

alter table public.listings add constraint listings_platform_check
  check (platform in (
    'x','instagram','tiktok','youtube','twitch',
    'linkedin','threads','facebook','telegram','snapchat',
    'playstation','xbox','nintendo',
    'nba-teams','nba-players','nhl-teams','nhl-players'
  ));
