-- Ten boards, not eight. The name is TopTen.one; the platform list should
-- read like one too. Snapchat and Telegram both expose linkable public
-- profiles, which is the only thing a board needs from a platform.
alter table public.listings drop constraint if exists listings_platform_check;

alter table public.listings add constraint listings_platform_check
  check (platform in (
    'x','instagram','tiktok','youtube','twitch',
    'linkedin','threads','facebook','snapchat','telegram'
  ));
