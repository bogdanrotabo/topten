/* TopTen.one — the only file with environment values. Everything here is
   public by design: the anon key is protected by RLS and by column privileges
   that keep the edit token and the Stripe session ids out of its reach, and
   the Payment Link is meant to be opened by anyone. No secrets belong here. */
window.TOPTEN_CONFIG = {
  // Supabase project "topten" (eu-central-1).
  SUPABASE_URL: "https://iezclmijwrtjibgflfqj.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllemNsbWlqd3J0amliZ2ZsZnFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDA0ODMsImV4cCI6MjEwMzIxNjQ4M30.BmuhHNFFG28hlI0UkaFMXsEWkbYk0W_9VIlZVI_VKEA",

  // The one Payment Link, with a free amount. The payer types the figure on
  // Stripe's page; what it buys is decided by the webhook, which compares it
  // against whatever the sitting king paid.
  //
  // The link is opened plain, with no query string. It used to carry a
  // client_reference_id naming which listing to credit, and there are no
  // listings to name any more.
  STRIPE_PAYMENT_LINK: "https://buy.stripe.com/28EdR2eZoaV76yy2C00co0d",

  // Google Analytics 4, property "TopTen.one", stream 15497843288.
  // Empty disables analytics entirely — no script is loaded.
  GA_MEASUREMENT_ID: "G-NYF4ZEZPZ9",

  // Where contact and any complaint about what a king has written goes.
  CONTACT_EMAIL: "hello@topten.one"
};
