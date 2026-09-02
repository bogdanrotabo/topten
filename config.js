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
     It answers free for some handles and 403 "requires a pro plan" for
     others, per handle rather than per network — so half the faces on the
     boards are currently missing and the drawn badge stands in for them.

     Paste the key from unavatar's dashboard here and they come back. The
     parameter name is what their dashboard calls it: it is apiKey on the
     plans documented today, and the second value exists so a rename on
     their side is one word here rather than a code change.

     Public by design, like everything else in this file — the key travels
     in the image URL, which is visible to anyone who opens the page. Do not
     put a key here that can do anything but fetch avatars. */
  UNAVATAR_KEY: "",
  UNAVATAR_KEY_PARAM: "apiKey"
};
