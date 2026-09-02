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

  /* unavatar fetches the profile picture for every social listing, and its
     paid tier cannot be used from this file.

     Their documentation is explicit: the key travels as an "x-api-key"
     request header, and a browser cannot put a header on an <img>. An
     earlier version of this config hung the key on the URL as a query
     parameter, which unavatar ignores — it would have looked configured and
     changed nothing.

     The key also arrives only after payment; there is no free API key, and
     anonymous traffic is 25 requests a day per visitor IP with cache hits
     free. That is why some handles resolve and others answer 403.

     So the paid tier needs a proxy: something server-side that holds the key,
     sets the header, and hands back the image, with the page asking it for
     /avatar/<network>/<handle> instead of unavatar directly. Set the base URL
     of that proxy here once it exists and every avatar goes through it. Empty
     means the page asks unavatar directly, anonymously, which is what it does
     today. */
  UNAVATAR_PROXY: ""
};
