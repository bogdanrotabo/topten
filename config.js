/* TopTen.one — the only file with environment values. Fill in what is blank, then deploy.
   Everything here is public by design: the anon key is protected by RLS,
   the Stripe Payment Link is meant to be opened by anyone. No secrets belong here. */
window.TOPTEN_CONFIG = {
  // Supabase project "topten" (eu-central-1) — already wired up.
  SUPABASE_URL: "https://iezclmijwrtjibgflfqj.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllemNsbWlqd3J0amliZ2ZsZnFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDA0ODMsImV4cCI6MjEwMzIxNjQ4M30.BmuhHNFFG28hlI0UkaFMXsEWkbYk0W_9VIlZVI_VKEA",

  // Printed by scripts/stripe-setup.sh once you drop a restricted key into .env.
  // Until this is set, the pay buttons say payments are not configured.
  STRIPE_PAYMENT_LINK: "https://buy.stripe.com/28EdR2eZoaV76yy2C00co0d",

  // Google Analytics 4, property "TopTen.one", stream 15497843288.
  // Its own property, not a second stream on Rotabo's — mixing two sites into
  // one property makes every report meaningless. Empty disables analytics.
  GA_MEASUREMENT_ID: "G-NYF4ZEZPZ9",

  // Where reports and contact go.
  CONTACT_EMAIL: "hello@topten.one",

  /* unavatar, which fetches the profile picture for every social listing.

     A publishable token, and it belongs in the URL: that is what unavatar's
     own onboarding shows and what the pk_ prefix means. Anonymous requests
     are 25 a day per visitor IP with cache hits free, which is why some
     handles resolved and others answered 403 EPRO before this existed.

     Public, like everything else in this file — anyone who opens the page can
     read it and spend against the same quota. That is the trade a publishable
     key is for. If it is ever abused, roll it in unavatar's dashboard and
     paste the new one here.

     An earlier version of this comment said the key had to be an x-api-key
     header and therefore needed a server-side proxy. The header works, but so
     does the token in the query, and the second needs nothing built. */
  UNAVATAR_TOKEN: "pk_z1Zqr3XZBaxMvWoHH8SnCG"
};
