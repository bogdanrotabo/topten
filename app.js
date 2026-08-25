/* TopTen.one — pay-to-rank boards. Vanilla, no build step.
   The client renders and validates; only the Stripe webhook can move money. */
(() => {
  'use strict';

  const CFG = window.TOPTEN_CONFIG || {};
  const MIN_CENTS = 200;                 // Stripe fee floor: $2
  // Stripe refuses a custom_unit_amount above $10,000 per payment unless the
  // account asks support to raise it. Totals are cumulative, so this caps a
  // single payment, never how high a listing can climb.
  const MAX_CENTS = 1000000;
  const ACTIVE_DAYS = 30;
  const LS_LAST = 'topten:last-listing';
  const LS_AMOUNT = 'topten:last-amount';
  const LS_KEYS = 'topten:keys';

  /* Without accounts there is no owner, so holding a secret is the only thing
     that can stand in for one. The browser mints it when the listing is
     submitted and keeps it here; the server never gives it back. Clearing site
     data loses the ability to edit, which is why the thank-you page hands over
     a link that carries it. */
  function loadKeys() {
    try { return JSON.parse(localStorage.getItem(LS_KEYS) || '{}'); } catch { return {}; }
  }

  function saveKey(id, token) {
    try {
      const keys = loadKeys();
      keys[id] = token;
      localStorage.setItem(LS_KEYS, JSON.stringify(keys));
    } catch { /* private mode: editing simply will not be offered */ }
  }

  const keyFor = id => loadKeys()[id] || null;

  /** #manage=<id>:<token> hands the key to another browser, then gets wiped. */
  function absorbManageLink() {
    const m = /^#manage=([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(location.hash || '');
    if (!m) return;
    saveKey(m[1], m[2]);
    history.replaceState({}, '', location.pathname + location.search);
  }

  const PLATFORMS = [
    { slug: 'x',         name: 'X',         color: '#e7e9ea', hosts: ['x.com', 'twitter.com'] },
    { slug: 'instagram', name: 'Instagram', color: '#e1306c', hosts: ['instagram.com'] },
    { slug: 'tiktok',    name: 'TikTok',    color: '#fe2c55', hosts: ['tiktok.com'] },
    { slug: 'youtube',   name: 'YouTube',   color: '#ff0000', hosts: ['youtube.com', 'youtu.be'] },
    { slug: 'facebook',  name: 'Facebook',  color: '#1877f2', hosts: ['facebook.com', 'fb.com'] },
    { slug: 'telegram',  name: 'Telegram',  color: '#26a5e4', hosts: ['t.me', 'telegram.me'] },
    { slug: 'snapchat',  name: 'Snapchat',  color: '#fffc00', hosts: ['snapchat.com'] },
    { slug: 'twitch',    name: 'Twitch',    color: '#9146ff', hosts: ['twitch.tv'] },
    { slug: 'linkedin',  name: 'LinkedIn',  color: '#0a66c2', hosts: ['linkedin.com'] },
    { slug: 'threads',   name: 'Threads',   color: '#c9c9c9', hosts: ['threads.net', 'threads.com'] }
  ];

  const BY_SLUG = Object.fromEntries(PLATFORMS.map(p => [p.slug, p]));

  // The platforms' own marks, used to say which board a listing sits on.
  // Single-path where the brand allows it, so they scale down to 12px cleanly.
  const ICONS = {
    x: '<path fill="currentColor" d="M18.9 2H22l-7 8.1L23.3 22h-6.5l-5-6.6-5.8 6.6H2.9l7.5-8.6L2 2h6.6l4.6 6.1zm-1.1 18h1.8L8.3 3.9H6.4z"/>',
    instagram: '<path fill="currentColor" d="M12 2c2.7 0 3 0 4.1.1 1 0 1.7.2 2.3.4.6.3 1.1.6 1.6 1.1s.8 1 1.1 1.6c.2.6.4 1.3.4 2.3.1 1.1.1 1.4.1 4.1s0 3-.1 4.1c0 1-.2 1.7-.4 2.3-.3.6-.6 1.1-1.1 1.6s-1 .8-1.6 1.1c-.6.2-1.3.4-2.3.4-1.1.1-1.4.1-4.1.1s-3 0-4.1-.1c-1 0-1.7-.2-2.3-.4-.6-.3-1.1-.6-1.6-1.1s-.8-1-1.1-1.6c-.2-.6-.4-1.3-.4-2.3C2 15 2 14.7 2 12s0-3 .1-4.1c0-1 .2-1.7.4-2.3.3-.6.6-1.1 1.1-1.6s1-.8 1.6-1.1c.6-.2 1.3-.4 2.3-.4C8.6 2 8.9 2 12 2m0 1.8c-2.7 0-3 0-4 .1-.9 0-1.4.2-1.7.3-.4.2-.7.4-1 .7s-.5.6-.7 1c-.1.3-.3.8-.3 1.7-.1 1-.1 1.3-.1 4s0 3 .1 4c0 .9.2 1.4.3 1.7.2.4.4.7.7 1s.6.5 1 .7c.3.1.8.3 1.7.3 1 .1 1.3.1 4 .1s3 0 4-.1c.9 0 1.4-.2 1.7-.3.4-.2.7-.4 1-.7s.5-.6.7-1c.1-.3.3-.8.3-1.7.1-1 .1-1.3.1-4s0-3-.1-4c0-.9-.2-1.4-.3-1.7a2.8 2.8 0 0 0-1.7-1.7c-.3-.1-.8-.3-1.7-.3-1-.1-1.3-.1-4-.1m0 3.1a5.1 5.1 0 1 1 0 10.2 5.1 5.1 0 0 1 0-10.2m0 1.8a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6m5.3-3.2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4"/>',
    tiktok: '<path fill="currentColor" d="M16.6 5.8a4.8 4.8 0 0 1-1.1-1.2A4.6 4.6 0 0 1 14.7 2h-3.3v13.1a2.7 2.7 0 1 1-1.9-2.6V9.2a6 6 0 1 0 5.2 5.9V8.8A7.5 7.5 0 0 0 19 10.2V6.9a4.4 4.4 0 0 1-2.4-1.1"/>',
    youtube: '<path fill="currentColor" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.3 5 12 5 12 5s-6.3 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8A26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.7 19 12 19 12 19s6.3 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8M10 15V9l5.2 3z"/>',
    twitch: '<path fill="currentColor" d="M4.3 3 3 6.4v12.2h4.2V21h2.3l2.3-2.4h3.4L20 14.3V3zm14 10.5-2.6 2.6h-3.9l-2.3 2.3v-2.3H6.9V4.7h11.4zM15.4 7.6v4.7h-1.7V7.6zm-4.5 0v4.7H9.2V7.6z"/>',
    linkedin: '<path fill="currentColor" d="M20.4 3H3.6a.6.6 0 0 0-.6.6v16.8a.6.6 0 0 0 .6.6h16.8a.6.6 0 0 0 .6-.6V3.6a.6.6 0 0 0-.6-.6M8.3 18.3H5.5V9.7h2.8zM6.9 8.5a1.6 1.6 0 1 1 0-3.3 1.6 1.6 0 0 1 0 3.3m11.4 9.8h-2.8v-4.2c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2v4.3H9.7V9.7h2.7v1.2h.1a3 3 0 0 1 2.6-1.4c2.8 0 3.3 1.9 3.3 4.3z"/>',
    threads: '<path fill="currentColor" d="M16.7 11.1h-.2c-.2-3-1.8-4.8-4.6-4.8a4.6 4.6 0 0 0-3.9 2l1.5 1a2.8 2.8 0 0 1 2.4-1.2c.8 0 1.5.3 1.9.7.3.4.5.9.6 1.5a12 12 0 0 0-2.1-.2c-2.7 0-4.4 1.6-4.3 3.7a3.2 3.2 0 0 0 1.3 2.4 3.8 3.8 0 0 0 2.5.7 3.6 3.6 0 0 0 2.8-1.4 4.5 4.5 0 0 0 .8-2c.7.4 1.2 1 1.5 1.7.3 1 .4 2.7-1 4.2-1.2 1.2-2.8 1.7-5 1.7-2.5 0-4.4-.8-5.6-2.4A8.7 8.7 0 0 1 3.5 12c0-2.7.6-4.8 1.7-6.2 1.3-1.6 3-2.4 5.5-2.4s4.5.8 5.7 2.5a7 7 0 0 1 1.2 2.5l1.8-.5a8.9 8.9 0 0 0-1.5-3.2C16.3 2.6 13.9 1.5 10.7 1.5 7.6 1.5 5.2 2.6 3.6 4.8 2.2 6.7 1.5 9.2 1.5 12s.7 5.2 2.1 7.1c1.7 2.2 4.1 3.3 7.1 3.3 2.8 0 4.7-.7 6.3-2.3 2.2-2.2 2.1-4.9 1.4-6.5a5.3 5.3 0 0 0-1.7-2.5m-4.8 4.1a1.9 1.9 0 0 1-1.3-.4 1.3 1.3 0 0 1-.5-1.1c0-.8.6-1.7 2.5-1.7a10 10 0 0 1 2 .2c-.2 2.3-1.4 3-2.7 3"/>',
    facebook: '<path fill="currentColor" d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.3 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12"/>',
    telegram: '<path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m4.6 6.8-1.5 7.3c-.1.5-.4.6-.8.4l-2.3-1.7-1.1 1.1c-.1.1-.2.2-.5.2l.2-2.5 4.4-4c.2-.2-.1-.3-.3-.1l-5.4 3.4-2.3-.7c-.5-.2-.5-.5.1-.8l9-3.4c.4-.2.8.1.5.8"/>',
    snapchat: '<path fill="currentColor" d="M12 2.2c2.7 0 4.6 2 4.8 4.7v2c.3.1.7 0 1-.1.4-.2.9 0 1.1.4.2.4 0 .9-.4 1.1-.5.2-1 .4-1.5.5-.2.1-.3.3-.2.5.5 1.5 1.6 2.7 3 3.4.3.2.4.5.3.8-.3.8-1.4 1.1-2.2 1.2l-.2.9c-.1.2-.3.4-.5.4-.5 0-1-.1-1.5 0-.5.1-.9.4-1.3.7-.6.5-1.4.8-2.2.8s-1.6-.3-2.2-.8c-.4-.3-.8-.6-1.3-.7-.5-.1-1 0-1.5 0-.2 0-.4-.2-.5-.4l-.2-.9c-.8-.1-1.9-.4-2.2-1.2-.1-.3 0-.6.3-.8 1.4-.7 2.5-1.9 3-3.4.1-.2 0-.4-.2-.5-.5-.1-1-.3-1.5-.5-.4-.2-.6-.7-.4-1.1.2-.4.7-.6 1.1-.4.3.1.7.2 1 .1v-2c.2-2.7 2.1-4.7 4.8-4.7"/>'
  };

  /* The marks that are not one colour. Drawn full-size on the tiles and tabs
     because "official logo" means the real thing, not a tinted silhouette.
     TikTok is three offset copies of the note; Instagram is its gradient. */
  const ICONS_FULL = {
    tiktok:
      '<path fill="#25f4ee" d="M15.6 5.8a4.8 4.8 0 0 1-1.1-1.2A4.6 4.6 0 0 1 13.7 2h-3.3v13.1a2.7 2.7 0 1 1-1.9-2.6V9.2a6 6 0 1 0 5.2 5.9V8.8A7.5 7.5 0 0 0 18 10.2V6.9a4.4 4.4 0 0 1-2.4-1.1"/>' +
      '<path fill="#fe2c55" d="M17.6 6.8a4.8 4.8 0 0 1-1.1-1.2A4.6 4.6 0 0 1 15.7 3h-3.3v13.1a2.7 2.7 0 1 1-1.9-2.6v-3.3a6 6 0 1 0 5.2 5.9V9.8A7.5 7.5 0 0 0 20 11.2V7.9a4.4 4.4 0 0 1-2.4-1.1"/>' +
      '<path fill="#fff" d="M16.6 5.8a4.8 4.8 0 0 1-1.1-1.2A4.6 4.6 0 0 1 14.7 2h-3.3v13.1a2.7 2.7 0 1 1-1.9-2.6V9.2a6 6 0 1 0 5.2 5.9V8.8A7.5 7.5 0 0 0 19 10.2V6.9a4.4 4.4 0 0 1-2.4-1.1"/>',
    instagram:
      '<path fill="url(#tt-ig)" d="M12 2c2.7 0 3 0 4.1.1 1 0 1.7.2 2.3.4.6.3 1.1.6 1.6 1.1s.8 1 1.1 1.6c.2.6.4 1.3.4 2.3.1 1.1.1 1.4.1 4.1s0 3-.1 4.1c0 1-.2 1.7-.4 2.3-.3.6-.6 1.1-1.1 1.6s-1 .8-1.6 1.1c-.6.2-1.3.4-2.3.4-1.1.1-1.4.1-4.1.1s-3 0-4.1-.1c-1 0-1.7-.2-2.3-.4-.6-.3-1.1-.6-1.6-1.1s-.8-1-1.1-1.6c-.2-.6-.4-1.3-.4-2.3C2 15 2 14.7 2 12s0-3 .1-4.1c0-1 .2-1.7.4-2.3.3-.6.6-1.1 1.1-1.6s1-.8 1.6-1.1c.6-.2 1.3-.4 2.3-.4C8.6 2 8.9 2 12 2m0 1.8c-2.7 0-3 0-4 .1-.9 0-1.4.2-1.7.3-.4.2-.7.4-1 .7s-.5.6-.7 1c-.1.3-.3.8-.3 1.7-.1 1-.1 1.3-.1 4s0 3 .1 4c0 .9.2 1.4.3 1.7.2.4.4.7.7 1s.6.5 1 .7c.3.1.8.3 1.7.3 1 .1 1.3.1 4 .1s3 0 4-.1c.9 0 1.4-.2 1.7-.3.4-.2.7-.4 1-.7s.5-.6.7-1c.1-.3.3-.8.3-1.7.1-1 .1-1.3.1-4s0-3-.1-4c0-.9-.2-1.4-.3-1.7a2.8 2.8 0 0 0-1.7-1.7c-.3-.1-.8-.3-1.7-.3-1-.1-1.3-.1-4-.1m0 3.1a5.1 5.1 0 1 1 0 10.2 5.1 5.1 0 0 1 0-10.2m0 1.8a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6m5.3-3.2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4"/>',

    // These four are a coloured container with a white glyph in it. Drawing
    // them as one flat colour loses the glyph entirely.
    youtube:
      '<path fill="#ff0000" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.3 5 12 5 12 5s-6.3 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8A26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.7 19 12 19 12 19s6.3 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8"/>' +
      '<path fill="#fff" d="M10 15V9l5.2 3z"/>',
    facebook:
      '<circle cx="12" cy="12" r="10" fill="#1877f2"/>' +
      '<path fill="#fff" d="M15.1 21.8v-6.9h2.3l.5-2.9h-2.8v-1.9c0-.8.4-1.6 1.7-1.6h1.3V5.9s-1.2-.2-2.3-.2c-2.3 0-3.9 1.4-3.9 4v2.3H9.2v2.9h2.7v6.9a10 10 0 0 0 3.2 0"/>',
    telegram:
      '<circle cx="12" cy="12" r="10" fill="#26a5e4"/>' +
      '<path fill="#fff" d="m16.6 8.8-1.5 7.2c-.1.5-.4.6-.8.4l-2.3-1.7-1.1 1.1c-.1.1-.2.2-.5.2l.2-2.5 4.4-4c.2-.2-.1-.3-.3-.1l-5.4 3.4-2.3-.7c-.5-.2-.5-.5.1-.8l9-3.4c.4-.2.8.1.5.9"/>',
    linkedin:
      '<rect x="2" y="2" width="20" height="20" rx="3" fill="#0a66c2"/>' +
      '<path fill="#fff" d="M8.4 18.3H5.6V9.8h2.8zM7 8.6a1.6 1.6 0 1 1 0-3.3 1.6 1.6 0 0 1 0 3.3m11.4 9.7h-2.8V14c0-1 0-2.3-1.4-2.3s-1.6 1-1.6 2.2v4.4H9.8V9.8h2.7V11a3 3 0 0 1 2.7-1.5c2.8 0 3.3 1.9 3.3 4.3z"/>',
    snapchat:
      '<path fill="#fffc00" d="M12 2.2c2.7 0 4.6 2 4.8 4.7v2c.3.1.7 0 1-.1.4-.2.9 0 1.1.4.2.4 0 .9-.4 1.1-.5.2-1 .4-1.5.5-.2.1-.3.3-.2.5.5 1.5 1.6 2.7 3 3.4.3.2.4.5.3.8-.3.8-1.4 1.1-2.2 1.2l-.2.9c-.1.2-.3.4-.5.4-.5 0-1-.1-1.5 0-.5.1-.9.4-1.3.7-.6.5-1.4.8-2.2.8s-1.6-.3-2.2-.8c-.4-.3-.8-.6-1.3-.7-.5-.1-1 0-1.5 0-.2 0-.4-.2-.5-.4l-.2-.9c-.8-.1-1.9-.4-2.2-1.2-.1-.3 0-.6.3-.8 1.4-.7 2.5-1.9 3-3.4.1-.2 0-.4-.2-.5-.5-.1-1-.3-1.5-.5-.4-.2-.6-.7-.4-1.1.2-.4.7-.6 1.1-.4.3.1.7.2 1 .1v-2c.2-2.7 2.1-4.7 4.8-4.7"/>',
    twitch:
      '<path fill="#9146ff" d="M4.3 3 3 6.4v12.2h4.2V21h2.3l2.3-2.4h3.4L20 14.3V3zm14 10.5-2.6 2.6h-3.9l-2.3 2.3v-2.3H6.9V4.7h11.4zM15.4 7.6v4.7h-1.7V7.6zm-4.5 0v4.7H9.2V7.6z"/>',
    x:
      '<path fill="#fff" d="M18.9 2H22l-7 8.1L23.3 22h-6.5l-5-6.6-5.8 6.6H2.9l7.5-8.6L2 2h6.6l4.6 6.1zm-1.1 18h1.8L8.3 3.9H6.4z"/>',
    threads:
      '<path fill="#fff" d="M16.7 11.1h-.2c-.2-3-1.8-4.8-4.6-4.8a4.6 4.6 0 0 0-3.9 2l1.5 1a2.8 2.8 0 0 1 2.4-1.2c.8 0 1.5.3 1.9.7.3.4.5.9.6 1.5a12 12 0 0 0-2.1-.2c-2.7 0-4.4 1.6-4.3 3.7a3.2 3.2 0 0 0 1.3 2.4 3.8 3.8 0 0 0 2.5.7 3.6 3.6 0 0 0 2.8-1.4 4.5 4.5 0 0 0 .8-2c.7.4 1.2 1 1.5 1.7.3 1 .4 2.7-1 4.2-1.2 1.2-2.8 1.7-5 1.7-2.5 0-4.4-.8-5.6-2.4A8.7 8.7 0 0 1 3.5 12c0-2.7.6-4.8 1.7-6.2 1.3-1.6 3-2.4 5.5-2.4s4.5.8 5.7 2.5a7 7 0 0 1 1.2 2.5l1.8-.5a8.9 8.9 0 0 0-1.5-3.2C16.3 2.6 13.9 1.5 10.7 1.5 7.6 1.5 5.2 2.6 3.6 4.8 2.2 6.7 1.5 9.2 1.5 12s.7 5.2 2.1 7.1c1.7 2.2 4.1 3.3 7.1 3.3 2.8 0 4.7-.7 6.3-2.3 2.2-2.2 2.1-4.9 1.4-6.5a5.3 5.3 0 0 0-1.7-2.5m-4.8 4.1a1.9 1.9 0 0 1-1.3-.4 1.3 1.3 0 0 1-.5-1.1c0-.8.6-1.7 2.5-1.7a10 10 0 0 1 2 .2c-.2 2.3-1.4 3-2.7 3"/>'
  };

  const $ = sel => document.querySelector(sel);
  const view = $('#view');
  const modal = $('#modal');
  const panel = $('#modal-panel');
  const sticky = $('#sticky');

  /* ------------------------------------------------------------- helpers */

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /**
   * `full` draws the platform's real colours — three-tone TikTok, the
   * Instagram gradient — where there is room for them. Everywhere else the
   * mark inherits currentColor so it can be tinted or dimmed.
   */
  const icon = (slug, full) => {
    const body = (full && ICONS_FULL[slug]) || ICONS[slug] || '';
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  };

  function money(cents) {
    const n = Number(cents || 0) / 100;
    return '$' + n.toLocaleString('en-US', {
      minimumFractionDigits: n % 1 ? 2 : 0,
      maximumFractionDigits: 2
    });
  }

  /** Smallest whole-dollar amount strictly greater than `cents`. */
  const nextDollarAbove = cents => Math.floor(Number(cents || 0) / 100) * 100 + 100;

  const clampMin = cents => Math.max(MIN_CENTS, Math.round(cents));

  function avatarUrl(platform, handle) {
    const h = String(handle || '').replace(/^@/, '');
    return `https://unavatar.io/${encodeURIComponent(platform)}/${encodeURIComponent(h)}?fallback=false`;
  }

  const FALLBACK_AV = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><rect width="44" height="44" rx="22" fill="#171a22"/><circle cx="22" cy="17" r="7" fill="#2b303b"/><path d="M8 42c2-8 7-12 14-12s12 4 14 12z" fill="#2b303b"/></svg>');

  /**
   * crypto.randomUUID() only exists in a secure context, and GitHub Pages
   * answers on plain http until Enforce HTTPS is on. Anyone who reached the
   * site over http used to get a TypeError here, which left the pay button
   * frozen on "Setting up…". crypto.getRandomValues is not gated the same way,
   * so build the v4 uuid by hand when the shortcut is missing.
   */
  function uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    const b = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(b);
    } else {
      for (let i = 0; i < 16; i++) b[i] = (Math.random() * 256) | 0;
    }
    b[6] = (b[6] & 0x0f) | 0x40;   // version 4
    b[8] = (b[8] & 0x3f) | 0x80;   // variant 10
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  /* -------------------------------------------------------- url handling */

  // Path segments that introduce a profile rather than being one. They are
  // per platform on purpose: /user/ names a channel on YouTube and nothing on X,
  // so a shared list would read x.com/user/status/123 as the profile "user".
  const PREFIXES = {
    youtube:  new Set(['c', 'user', 'channel']),
    linkedin: new Set(['in', 'company', 'school']),
    facebook: new Set(['people', 'pg']),
    snapchat: new Set(['add', 't'])
  };

  // A segment sitting after the handle that means "one piece of content".
  const POST_MARKER = new Set([
    'status', 'statuses', 'video', 'post', 'posts', 'photo', 'photos',
    'reel', 'reels', 'p', 'permalink'
  ]);

  /**
   * Normalize a pasted profile URL and pull the handle out of it.
   * Returns { ok, url, handle } or { ok:false, error }.
   */
  function parseProfile(raw, slug) {
    const p = BY_SLUG[slug];
    if (!p) return { ok: false, error: 'Pick a platform first.' };

    let input = String(raw || '').trim();
    if (!input) return { ok: false, error: '' };
    if (!/^https?:\/\//i.test(input)) input = 'https://' + input.replace(/^\/+/, '');

    let u;
    try { u = new URL(input); } catch { return { ok: false, error: 'That is not a link.' }; }

    let host = u.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, '');
    const hostOk = p.hosts.some(h => host === h || host.endsWith('.' + h));
    if (!hostOk) {
      return { ok: false, error: `That link is not ${p.name}. Expected ${p.hosts.join(' or ')}.` };
    }
    // Collapse the accepted aliases onto one canonical host so twitter.com and
    // x.com cannot hold two listings for the same person.
    host = p.hosts[0];

    const segments = u.pathname.split('/').map(s => decodeURIComponent(s).trim()).filter(Boolean);

    // facebook.com/profile.php?id=123 is the only profile shape that lives in
    // the query string, so it is the only query we keep.
    let keptQuery = '';
    if (slug === 'facebook' && /^profile\.php$/i.test(segments[0] || '')) {
      const id = u.searchParams.get('id');
      if (!id || !/^\d+$/.test(id)) return { ok: false, error: 'That Facebook link has no profile id.' };
      keptQuery = '?id=' + id;
      const url = `https://${host}/profile.php${keptQuery}`;
      return { ok: true, url, handle: '@' + id };
    }

    if (!segments.length) return { ok: false, error: `That is the ${p.name} homepage, not a profile.` };

    // youtube.com/watch, /shorts, /playlist point at content, not a person.
    if (slug === 'youtube' && ['watch', 'shorts', 'playlist', 'results'].includes(segments[0].toLowerCase())) {
      return { ok: false, error: 'Link the channel, not a video.' };
    }
    if (slug === 'x' && ['i', 'home', 'search', 'explore', 'messages'].includes(segments[0].toLowerCase())) {
      return { ok: false, error: 'Link the profile, not a page.' };
    }
    if (slug === 'instagram' && ['p', 'reel', 'reels', 'explore', 'stories'].includes(segments[0].toLowerCase())) {
      return { ok: false, error: 'Link the profile, not a post.' };
    }

    // Keep the meaningful part of the path: /in/name, /channel/UC…, /@name, /name
    const prefixes = PREFIXES[slug] || new Set();
    const kept = [];
    for (const seg of segments) {
      const low = seg.toLowerCase();
      if (!kept.length && prefixes.has(low)) { kept.push(low); continue; }
      kept.push(seg);
      break;
    }

    const last = kept[kept.length - 1];
    if (!last || prefixes.has(last.toLowerCase())) {
      return { ok: false, error: 'No profile name in that link.' };
    }
    if (!/^[@]?[A-Za-z0-9._\-]{1,40}$/.test(last)) {
      return { ok: false, error: 'That does not look like a profile name.' };
    }

    // /bogdan/status/123 is a post by @bogdan, not a way to list @bogdan.
    if (POST_MARKER.has((segments[kept.length] || '').toLowerCase())) {
      return { ok: false, error: 'Link the profile, not a post.' };
    }

    const url = `https://${host}/${kept.join('/')}`.replace(/\/+$/, '');
    const handle = last.startsWith('@') ? last : '@' + last;

    return { ok: true, url, handle };
  }

  /* ----------------------------------------------------------- supabase */

  let sb = null;
  let connectionError = '';

  function initSupabase() {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
      connectionError = 'config';
      return null;
    }
    if (!window.supabase) { connectionError = 'sdk'; return null; }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 4 } }
    });
    return sb;
  }

  /* -------------------------------------------------------------- state */

  const state = {
    boards: Object.fromEntries(PLATFORMS.map(p => [p.slug, []])),
    platform: 'x',
    online: 1,
    loaded: false,
    prevRanks: {}
  };

  async function loadBoards() {
    if (!sb) return;
    const { data, error } = await sb
      .from('board')
      .select('id,platform,handle,url,tagline,link,total_cents,last_paid_at,rank')
      .order('platform', { ascending: true })
      .order('rank', { ascending: true })
      .limit(2000);

    if (error) { console.error('board load failed', error); connectionError = 'query'; return; }

    const next = Object.fromEntries(PLATFORMS.map(p => [p.slug, []]));
    for (const row of data || []) {
      if (next[row.platform]) next[row.platform].push(row);
    }
    for (const slug of Object.keys(next)) {
      next[slug].sort((a, b) =>
        b.total_cents - a.total_cents ||
        new Date(a.last_paid_at) - new Date(b.last_paid_at));
    }
    state.boards = next;
    state.loaded = true;
  }

  const board = slug => state.boards[slug] || [];
  const topCents = slug => board(slug)[0]?.total_cents || 0;
  const cutoffCents = slug => board(slug)[9]?.total_cents || 0;

  /** Where `totalCents` would land on `slug`. Ties lose: an equal total that is
      already on the board was paid earlier and keeps the higher position. */
  function rankFor(slug, totalCents, exceptId) {
    let ahead = 0;
    for (const row of board(slug)) {
      if (row.id === exceptId) continue;
      if (row.total_cents >= totalCents) ahead++;
    }
    return ahead + 1;
  }

  function stats() {
    let count = 0, total = 0, top = 0;
    for (const slug of Object.keys(state.boards)) {
      for (const r of state.boards[slug]) {
        count++;
        total += Number(r.total_cents);
        if (r.total_cents > top) top = r.total_cents;
      }
    }
    return { count, total, top };
  }

  /* ---------------------------------------------------------- rendering */

  function renderStats() {
    const s = stats();
    return `
    <div class="stats">
      <div class="stat"><span class="stat__v">${s.count}</span><span class="stat__k">Listings</span></div>
      <div class="stat"><span class="stat__v">${money(s.total)}</span><span class="stat__k">On the boards</span></div>
      <div class="stat"><span class="stat__v">${money(s.top)}</span><span class="stat__k">Highest</span></div>
      <div class="stat stat--live"><span class="stat__v"><span class="pulse"></span>${state.online}</span><span class="stat__k">Online</span></div>
    </div>`;
  }

  function renderTabs() {
    // Always two rows, however many platforms there are: eight lands as 4+4,
    // ten would land as 5+5. Nothing scrolls out of sight either way.
    const cols = Math.ceil(PLATFORMS.length / 2);
    return `
    <div class="tabs"><div class="shell"><div class="tabs__grid" role="tablist" style="--tab-cols:${cols}">
      ${PLATFORMS.map(p => {
        const on = p.slug === state.platform;
        const n = board(p.slug).length;
        return `<button class="tab" role="tab" aria-selected="${on}" data-tab="${p.slug}"
                  style="--tab-brand:${p.color}" title="${esc(p.name)}">${icon(p.slug, true)}<span class="tab__name">${esc(p.name)}</span>${n ? `<span class="tab__n">${n}</span>` : ''}</button>`;
      }).join('')}
    </div></div></div>`;
  }

  function renderRow(row, idx) {
    const rank = idx + 1;
    const cls = ['row', 'row--top', rank === 1 ? 'row--1' : ''].filter(Boolean).join(' ');
    return `
    <div class="${cls}" data-row="${esc(row.id)}" title="${esc(row.handle)} — ${money(row.total_cents)}">
      <span class="row__rank">${rank}</span>
      <span class="row__brand" style="color:${BY_SLUG[row.platform]?.color || 'var(--dim)'}">${icon(row.platform, true)}</span>
      <img class="row__av" loading="lazy" width="34" height="34" alt=""
           src="${esc(avatarUrl(row.platform, row.handle))}" onerror="this.onerror=null;this.src='${FALLBACK_AV}'">
      <span class="row__handle"><a href="${esc(row.url)}" target="_blank" rel="nofollow noopener">${esc(row.handle)}</a></span>
      <span class="row__amt">${money(row.total_cents)}</span>
      <button class="row__add" data-open="${esc(row.id)}" aria-label="See ${esc(row.handle)}">Details</button>
    </div>`;
  }

  /**
   * An unclaimed place. Showing it beats hiding it, but only one empty place
   * can honestly carry a price: the first one after the last listing. Paying
   * the minimum lands you exactly there. Any place below it is unreachable —
   * whatever you pay, you land at the first gap — and any place above it costs
   * whatever it takes to pass the listing sitting in it, which is a price the
   * occupied tiles already show.
   */
  function renderFreeSlot(rank, slug) {
    const taken = board(slug).length;
    const label = rank === taken + 1 ? money(MIN_CENTS) : 'Open';
    return `
    <div class="row row--free" title="Place ${rank} is open">
      <span class="row__rank">${rank}</span>
      <span class="row__brand" style="color:${BY_SLUG[slug]?.color || 'var(--dim)'}">${icon(slug, true)}</span>
      <span class="row__av"></span>
      <span class="row__slot">${esc(label)}</span>
      <button class="row__add" data-claim="1" aria-label="Claim place ${rank}">Claim</button>
    </div>`;
  }

  function renderBoard() {
    const slug = state.platform;
    const p = BY_SLUG[slug];
    const rows = board(slug);
    const lead = rows[0];

    if (connectionError === 'config') {
      return `<div class="shell board"><div class="empty">
        <h3>Not connected yet</h3>
        <p>Fill in <code>config.js</code> with the Supabase URL, the anon key and the Stripe payment link, then reload.</p>
      </div></div>`;
    }

    const head = lead ? `
      <div class="tobeat">
        <div>
          <span class="tobeat__k">Holding #1 on ${esc(p.name)}</span>
          <span class="tobeat__v">${money(lead.total_cents)}</span>
          <span class="tobeat__who">${esc(lead.handle)}</span>
        </div>
        <button class="tobeat__cta" data-claim="1">Beat it for ${money(clampMin(nextDollarAbove(lead.total_cents)))}</button>
      </div>` : `
      <div class="tobeat">
        <div>
          <span class="tobeat__k">Nobody on ${esc(p.name)} yet</span>
          <span class="tobeat__v">${money(MIN_CENTS)}</span>
          <span class="tobeat__who">takes #1 right now</span>
        </div>
        <button class="tobeat__cta" data-claim="1">Take #1</button>
      </div>`;

    const rest = rows.slice(10);

    // Always ten tiles. A half-drawn board reads as broken; ten places with
    // gaps reads as an invitation, and each gap prints its own price.
    const tiles = [];
    for (let i = 0; i < 10; i++) {
      tiles.push(rows[i] ? renderRow(rows[i], i) : renderFreeSlot(i + 1, slug));
    }
    const body = `<div class="rows">${tiles.join('')}</div>`;

    const gap = rows.length >= 10 ? clampMin(nextDollarAbove(cutoffCents(slug))) : MIN_CENTS;

    const waiting = rest.length ? `
      <details class="waiting">
        <summary>
          <span>Waiting list · ${rest.length}</span>
          <span class="waiting__gap">${money(gap)} to reach #10</span>
        </summary>
        ${rest.map((r, i) => `
          <div class="wrow">
            <span class="wrow__rank">${i + 11}</span>
            <span class="wrow__h">${esc(r.handle)}</span>
            <span class="wrow__a">${money(r.total_cents)}</span>
            <button class="wrow__add" data-add="${esc(r.id)}">Add</button>
          </div>`).join('')}
      </details>` : '';

    return `<div class="shell board" style="--brand:${p.color}">${head}${body}${waiting}</div>`;
  }

  function renderHome() {
    view.innerHTML = `
      <div class="shell">
        <section class="hero">
          <h1>TopTen<em>.one</em></h1>
          <p class="hero__tag">Be the one.</p>
          <p class="hero__sub">Pay to be seen. Top 10 per platform. No algorithm.</p>
        </section>
        ${renderStats()}
      </div>
      ${renderTabs()}
      <div id="board-slot">${renderBoard()}</div>`;
    sticky.hidden = false;
    $('#cta-claim').textContent = board(state.platform).length
      ? `Take #1 on ${BY_SLUG[state.platform].name} for ${money(clampMin(nextDollarAbove(topCents(state.platform))))}`
      : 'Claim a spot';
    document.title = `Top 10 on ${BY_SLUG[state.platform].name} — TopTen.one`;
    // Baseline for the outbid animation. Must happen after the platform is
    // settled, or the first live change has nothing to compare against.
    snapshotRanks();
  }

  /** Re-render only the board, animating rows whose position moved. */
  function refreshBoard() {
    const slot = $('#board-slot');
    if (!slot) return;
    const before = state.prevRanks;
    slot.innerHTML = renderBoard();

    const now = {};
    board(state.platform).forEach((r, i) => { now[r.id] = i + 1; });
    for (const [id, rank] of Object.entries(now)) {
      const was = before[id];
      if (was === undefined || was === rank) continue;
      const el = slot.querySelector(`[data-row="${CSS.escape(id)}"]`);
      if (el) el.classList.add(rank < was ? 'row--bumped' : 'row--sunk');
    }
    state.prevRanks = now;

    const statsEl = document.querySelector('.stats');
    if (statsEl) statsEl.outerHTML = renderStats();
    PLATFORMS.forEach(p => {
      const tab = document.querySelector(`[data-tab="${p.slug}"]`);
      if (!tab) return;
      const n = board(p.slug).length;
      let badge = tab.querySelector('.tab__n');
      // A board that just got its first listing has no badge to update yet.
      if (n && !badge) {
        badge = document.createElement('span');
        badge.className = 'tab__n';
        tab.appendChild(badge);
      }
      if (badge) {
        if (n) badge.textContent = String(n);
        else badge.remove();
      }
    });
    const cta = $('#cta-claim');
    if (cta) cta.textContent = board(state.platform).length
      ? `Take #1 on ${BY_SLUG[state.platform].name} for ${money(clampMin(nextDollarAbove(topCents(state.platform))))}`
      : 'Claim a spot';
  }

  /** Remember where every listing sits, so the next refresh can animate movement. */
  function snapshotRanks() {
    state.prevRanks = {};
    board(state.platform).forEach((r, i) => { state.prevRanks[r.id] = i + 1; });
  }

  /* ------------------------------------------------------------- modals */

  function openModal(html) {
    panel.innerHTML = html;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    const first = panel.querySelector('input, button');
    if (first) setTimeout(() => first.focus(), 40);
  }

  function closeModal() {
    modal.hidden = true;
    panel.innerHTML = '';
    document.body.style.overflow = '';
  }

  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  /** Build the price ladder for a platform. `current` is the listing's existing
      total when adding money, 0 when submitting something new. */
  function ladder(slug, current, exceptId) {
    const rows = board(slug).filter(r => r.id !== exceptId);
    const opts = [];
    const push = (label, note, targetTotal) => {
      const wanted = clampMin(targetTotal - current);
      const delta = Math.min(wanted, MAX_CENTS);
      // A position can cost more than Stripe allows in one go. Say so rather
      // than offering a button that dies at checkout.
      opts.push({
        label,
        note: delta < wanted ? `${note} — more than one payment` : note,
        delta
      });
    };

    if (rows[0] && rows[0].total_cents >= current) {
      push('Take #1', exceptId ? 'Pass everyone above you' : 'Straight to the top of the board',
        nextDollarAbove(rows[0].total_cents));
    } else {
      push('Take #1', rows.length ? 'You are already #1 — extend the lead' : 'The board is empty',
        Math.max(nextDollarAbove(current), current + MIN_CENTS));
    }

    if (exceptId) {
      const myIndex = board(slug).findIndex(r => r.id === exceptId);
      const above = myIndex > 0 ? board(slug)[myIndex - 1] : null;
      if (above) {
        push(`Beat #${myIndex}`, `Pass ${above.handle}`, nextDollarAbove(above.total_cents));
      }
    } else if (rows[2]) {
      push('Take #3', `Pass ${rows[2].handle}`, nextDollarAbove(rows[2].total_cents));
    }

    if (rows.length >= 10) {
      const inTop = board(slug).findIndex(r => r.id === exceptId);
      if (!exceptId || inTop < 0 || inTop >= 10) {
        push('Enter the Top 10', `Pass ${rows[9].handle}`, nextDollarAbove(rows[9].total_cents));
      }
    } else if (!exceptId) {
      push('Enter the Top 10', 'Fewer than ten listings — a spot is open', MIN_CENTS);
    }

    // Same price twice reads as a bug; keep the first (better) label.
    const seen = new Set();
    return opts.filter(o => (seen.has(o.delta) ? false : seen.add(o.delta)));
  }

  function amountBlock(slug, current, exceptId) {
    const opts = ladder(slug, current, exceptId);
    return `
      <div class="amounts" id="amounts">
        ${opts.map((o, i) => `
          <button type="button" class="amt" data-amt="${o.delta}" aria-pressed="${i === 0}">
            <span><span class="amt__label">${esc(o.label)}</span><span class="amt__note">${esc(o.note)}</span></span>
            <span class="amt__price">${current ? '+' : ''}${money(o.delta)}</span>
          </button>`).join('')}
        <div class="free" id="free" aria-pressed="false">
          <span class="free__cur">$</span>
          <input id="free-input" type="number" inputmode="decimal" min="2" step="1"
                 max="${MAX_CENTS / 100}"
                 placeholder="Any amount" aria-label="Custom amount in US dollars">
        </div>
      </div>
      <div class="verdict" id="verdict"></div>
      <p class="finelist" id="amount-echo" style="margin:-6px 0 10px;text-align:center"></p>`;
  }

  function submitModal(preslug) {
    state.draft = { slug: preslug || state.platform, url: '', handle: '', tagline: '', cents: 0 };
    const slug = state.draft.slug;
    openModal(`
      <div class="modal__head">
        <div>
          <h2 id="modal-title">Claim a spot</h2>
          <p>Paste a profile, pick an amount. The money is the rank.</p>
        </div>
        <button class="modal__x" data-close aria-label="Close">&times;</button>
      </div>

      <div class="field">
        <label>Platform</label>
        <div class="picker" id="picker">
          ${PLATFORMS.map(p => `
            <button type="button" class="pick" data-pick="${p.slug}" aria-pressed="${p.slug === slug}"
                    style="--pick-brand:${p.color}" title="${esc(p.name)}"
                    aria-label="${esc(p.name)}">${icon(p.slug, true)}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label for="url-input">Profile link</label>
        <input class="input" id="url-input" type="url" inputmode="url" autocomplete="off"
               spellcheck="false" placeholder="https://x.com/yourname">
        <div class="hint" id="url-hint"></div>
      </div>

      <div class="field">
        <label for="tag-input">Tagline <span style="text-transform:none;letter-spacing:0">— optional, 80 characters</span></label>
        <input class="input" id="tag-input" maxlength="80" placeholder="One line about you">
      </div>

      <div class="field">
        <label for="link-input">Your link <span style="text-transform:none;letter-spacing:0">— optional</span></label>
        <input class="input" id="link-input" type="url" inputmode="url" maxlength="200"
               spellcheck="false" placeholder="https://your-business.com">
        <div class="hint" id="link-hint">Your site, shop or business. Shown on your listing.</div>
      </div>

      <div class="field">
        <label>Amount</label>
        ${amountBlock(slug, 0, null)}
      </div>

      <button class="btn" id="go" disabled>Continue to payment</button>
      <ul class="finelist">
        <li>Payments are final. No refunds.</li>
        <li>A listing stays on the board for 30 days after its last payment.</li>
        <li>Anyone can add money to any listing, including yours.</li>
        <li>Checkout is handled by Stripe, billed as Rotabo.</li>
      </ul>`);

    wireAmounts(slug, 0, null);
    wireSubmit();
  }

  /**
   * Tapping a tile opens this. The tile is 70px wide and can only carry a
   * rank, a face and a number; everything the listing is actually paying to
   * say — the tagline they wrote, the profile they bought the place for, the
   * site they want you to go to next — lives here.
   */
  function listingModal(row) {
    const p = BY_SLUG[row.platform];
    const pos = board(row.platform).findIndex(r => r.id === row.id) + 1;
    const report = `mailto:${CFG.CONTACT_EMAIL || 'hello@topten.one'}?subject=${encodeURIComponent('Report listing ' + row.id)}&body=${encodeURIComponent('Listing: ' + row.id + '\nProfile: ' + row.url + '\n\nWhy this should be reviewed:\n')}`;
    const badge = `/badge/?p=${row.platform}&h=${encodeURIComponent(row.handle)}`;

    openModal(`
      <div class="modal__head">
        <div>
          <h2 id="modal-title">${esc(row.handle)}</h2>
          <p><span class="detail__brand" style="color:${p.color}">${icon(row.platform, true)}</span> ${esc(p.name)} · #${pos} with ${money(row.total_cents)}</p>
        </div>
        <button class="modal__x" data-close aria-label="Close">&times;</button>
      </div>

      <div class="detail">
        <img class="detail__av" width="64" height="64" alt=""
             src="${esc(avatarUrl(row.platform, row.handle))}"
             onerror="this.onerror=null;this.src='${FALLBACK_AV}'">
        <div class="detail__body">
          ${row.tagline
            ? `<p class="detail__tagline">${esc(row.tagline)}</p>`
            : `<p class="detail__tagline detail__tagline--none">No tagline on this listing.</p>`}
        </div>
      </div>

      <div class="detail__links">
        <a class="detail__link" href="${esc(row.url)}" target="_blank" rel="nofollow noopener">
          <span class="detail__link-k">${esc(p.name)} profile</span>
          <span class="detail__link-v">${esc(row.handle)}</span>
        </a>
        ${row.link ? `
        <a class="detail__link" href="${esc(row.link)}" target="_blank" rel="nofollow noopener">
          <span class="detail__link-k">Their link</span>
          <span class="detail__link-v">${esc(prettyLink(row.link))}</span>
        </a>` : ''}
      </div>

      <button class="btn" data-add="${esc(row.id)}">Add money to ${esc(row.handle)}</button>
      ${keyFor(row.id) ? `<button class="btn btn--ghost" style="margin-top:8px" data-edit="${esc(row.id)}">Edit what this says</button>` : ''}

      <ul class="finelist" style="display:flex;gap:14px;justify-content:center">
        <li><a href="${badge}" data-link>Badge</a></li>
        <li><a href="${esc(report)}">Report</a></li>
      </ul>`);
  }

  /**
   * Only reachable by someone whose browser holds this listing's key, so the
   * money, the rank and the moderation flag are not on the form at all — the
   * two fields here are the only ones the server will let the key change.
   */
  function editModal(row) {
    const token = keyFor(row.id);
    if (!token) return;
    openModal(`
      <div class="modal__head">
        <div>
          <h2 id="modal-title">Edit ${esc(row.handle)}</h2>
          <p>Change what your listing says. Rank and total stay exactly as they are.</p>
        </div>
        <button class="modal__x" data-close aria-label="Close">&times;</button>
      </div>

      <div class="field">
        <label for="edit-tag">Tagline <span style="text-transform:none;letter-spacing:0">— 80 characters</span></label>
        <input class="input" id="edit-tag" maxlength="80" value="${esc(row.tagline || '')}"
               placeholder="One line about you">
      </div>

      <div class="field">
        <label for="edit-link">Your link</label>
        <input class="input" id="edit-link" type="url" inputmode="url" maxlength="200"
               spellcheck="false" value="${esc(row.link || '')}"
               placeholder="https://your-business.com">
        <div class="hint" id="edit-hint">Leave either one empty to remove it.</div>
      </div>

      <button class="btn" id="edit-save">Save</button>`);

    $('#edit-save').addEventListener('click', async () => {
      const btn = $('#edit-save');
      const hint = $('#edit-hint');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        let link = $('#edit-link').value.trim();
        if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
        const { data, error } = await sb.rpc('update_listing', {
          p_id: row.id,
          p_token: token,
          p_tagline: $('#edit-tag').value.trim() || null,
          p_link: link || null
        });
        if (error) throw error;
        if (!data?.ok) {
          hint.className = 'hint hint--bad';
          hint.textContent = data?.reason === 'bad_link'
            ? 'That link is not a web address.'
            : 'This listing cannot be edited from this browser.';
          btn.disabled = false;
          btn.textContent = 'Save';
          return;
        }
        await loadBoards();
        refreshBoard();
        closeModal();
      } catch (err) {
        console.error('edit failed', err);
        hint.className = 'hint hint--bad';
        hint.textContent = 'Could not save. Check your connection and try again.';
        btn.disabled = false;
        btn.textContent = 'Save';
      }
    });
  }

  /** example.com/shop rather than https://www.example.com/shop?utm=… */
  function prettyLink(u) {
    try {
      const url = new URL(u);
      const path = url.pathname.replace(/\/$/, '');
      return (url.hostname.replace(/^www\./, '') + path).slice(0, 42);
    } catch { return u.slice(0, 42); }
  }

  function addMoneyModal(row) {
    state.draft = { slug: row.platform, listingId: row.id, current: row.total_cents, cents: 0 };
    const pos = board(row.platform).findIndex(r => r.id === row.id) + 1;
    openModal(`
      <div class="modal__head">
        <div>
          <h2 id="modal-title">Add money to ${esc(row.handle)}</h2>
          <p>Currently ${money(row.total_cents)} · #${pos} on ${esc(BY_SLUG[row.platform].name)}.
             Money adds to the total, and the total is the rank.</p>
        </div>
        <button class="modal__x" data-close aria-label="Close">&times;</button>
      </div>

      <div class="field">
        <label>Amount to add</label>
        ${amountBlock(row.platform, row.total_cents, row.id)}
      </div>

      <button class="btn" id="go">Continue to payment</button>
      <ul class="finelist">
        <li>Payments are final. No refunds.</li>
        <li>This resets the listing's 30-day clock.</li>
        <li>Checkout is handled by Stripe, billed as Rotabo.</li>
      </ul>`);

    wireAmounts(row.platform, row.total_cents, row.id);
    $('#go').addEventListener('click', () => goToStripe(row.id));
  }

  function wireAmounts(slug, current, exceptId) {
    const wrap = $('#amounts');
    const free = $('#free');
    const freeInput = $('#free-input');
    const verdict = $('#verdict');

    const setVerdict = cents => {
      state.draft.cents = cents;
      if (!cents || cents < MIN_CENTS) {
        verdict.className = 'verdict verdict--bad';
        verdict.textContent = `Minimum ${money(MIN_CENTS)}.`;
        // Below the floor is never payable, whichever modal is open.
        const go = $('#go');
        if (go) go.disabled = true;
        return;
      }
      if (cents > MAX_CENTS) {
        verdict.className = 'verdict verdict--bad';
        verdict.textContent =
          `Stripe caps one payment at ${money(MAX_CENTS)}. Pay again after this one — totals add up.`;
        const go = $('#go');
        if (go) go.disabled = true;
        return;
      }
      const total = current + cents;
      const r = rankFor(slug, total, exceptId);
      verdict.className = 'verdict';
      verdict.innerHTML = r <= 10
        ? `This puts you at <b>#${r}</b> on ${esc(BY_SLUG[slug].name)}`
        : `This puts you at <b>#${r}</b> — ${money(clampMin(nextDollarAbove(cutoffCents(slug)) - current))} reaches the Top 10`;
      const go = $('#go');
      if (go) {
        go.disabled = exceptId ? false : !state.draft.url;
        // Stripe cannot be handed the amount through a payment link, so the
        // buyer types it there. Put the figure on the button and repeat it on
        // the next screen rather than sending them to a form showing $0.00.
        go.textContent = `Continue — pay ${money(cents)}`;
      }
      const echo = $('#amount-echo');
      if (echo) echo.textContent = `Stripe will ask you to type the amount. Enter ${money(cents)}.`;
    };

    wrap.addEventListener('click', e => {
      const btn = e.target.closest('[data-amt]');
      if (!btn) return;
      wrap.querySelectorAll('[data-amt]').forEach(b => b.setAttribute('aria-pressed', b === btn));
      free.setAttribute('aria-pressed', 'false');
      freeInput.value = '';
      setVerdict(Number(btn.dataset.amt));
    });

    freeInput.addEventListener('input', () => {
      wrap.querySelectorAll('[data-amt]').forEach(b => b.setAttribute('aria-pressed', 'false'));
      free.setAttribute('aria-pressed', 'true');
      const dollars = parseFloat(freeInput.value);
      setVerdict(Number.isFinite(dollars) ? Math.round(dollars * 100) : 0);
    });

    const first = wrap.querySelector('[data-amt]');
    if (first) setVerdict(Number(first.dataset.amt));
  }

  function wireSubmit() {
    const urlInput = $('#url-input');
    const hint = $('#url-hint');
    const tag = $('#tag-input');

    const validate = () => {
      const res = parseProfile(urlInput.value, state.draft.slug);
      if (!urlInput.value.trim()) {
        hint.className = 'hint'; hint.textContent = '';
        urlInput.removeAttribute('aria-invalid');
        state.draft.url = '';
      } else if (res.ok) {
        hint.className = 'hint hint--good';
        hint.textContent = `${res.handle} · ${res.url}`;
        urlInput.removeAttribute('aria-invalid');
        state.draft.url = res.url;
        state.draft.handle = res.handle;
      } else {
        hint.className = 'hint hint--bad';
        hint.textContent = res.error;
        urlInput.setAttribute('aria-invalid', 'true');
        state.draft.url = '';
      }
      $('#go').disabled = !state.draft.url || state.draft.cents < MIN_CENTS;
    };

    urlInput.addEventListener('input', validate);
    tag.addEventListener('input', () => { state.draft.tagline = tag.value.trim(); });

    // The database refuses anything that is not an http(s) URL, so say so here
    // rather than letting the insert fail after they have committed to paying.
    const linkInput = $('#link-input');
    const linkHint = $('#link-hint');
    linkInput.addEventListener('input', () => {
      let v = linkInput.value.trim();
      if (!v) {
        state.draft.link = '';
        linkInput.removeAttribute('aria-invalid');
        linkHint.className = 'hint';
        linkHint.textContent = 'Your site, shop or business. Shown on your listing.';
      } else {
        if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
        let ok = false;
        try { ok = /^[a-z0-9][a-z0-9._-]*\.[a-z]{2,}$/i.test(new URL(v).hostname); } catch { ok = false; }
        state.draft.link = ok ? v : '';
        linkInput.toggleAttribute('aria-invalid', !ok);
        linkHint.className = ok ? 'hint hint--good' : 'hint hint--bad';
        linkHint.textContent = ok ? v : 'That is not a web address.';
      }
      validate();
    });

    $('#picker').addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      state.draft.slug = b.dataset.pick;
      $('#picker').querySelectorAll('[data-pick]').forEach(x => x.setAttribute('aria-pressed', x === b));
      urlInput.placeholder = `https://${BY_SLUG[state.draft.slug].hosts[0]}/yourname`;
      // The ladder is per platform, so rebuild it when the platform changes.
      const field = $('#amounts').parentElement;
      field.innerHTML = `<label>Amount</label>${amountBlock(state.draft.slug, 0, null)}`;
      wireAmounts(state.draft.slug, 0, null);
      validate();
    });

    $('#go').addEventListener('click', createAndPay);
  }

  /* ------------------------------------------------------------ payment */

  async function createAndPay() {
    const go = $('#go');
    const restore = () => { go.disabled = false; go.textContent = 'Continue to payment'; };
    go.disabled = true;
    go.textContent = 'Setting up…';

    const { slug, url, handle, tagline, link } = state.draft;

    // Anything unexpected in here used to leave the button stuck on
    // "Setting up…" with no way forward. Never strand the buyer.
    try {
      const id = uuid();
      const token = uuid();

      // Insert without asking for the row back: the RLS SELECT policy hides an
      // unpaid listing, so a returning insert would fail even on success.
      const { error } = await sb.from('listings').insert({
        id, platform: slug, url, handle,
        tagline: tagline || null,
        link: link || null,
        edit_token: token
      });

      if (error) {
        const duplicate = error.code === '23505' || /duplicate key/i.test(error.message || '');
        if (!duplicate) throw error;

        const { data: existing } = await sb.rpc('lookup_listing', { p_platform: slug, p_url: url });
        if (!existing) {
          go.textContent = 'That profile cannot be listed';
          return;
        }
        const row = board(slug).find(r => r.id === existing);
        if (row) { addMoneyModal(row); return; }
        goToStripe(existing);             // listed, but not on the board yet
        return;
      }

      // Keep the key before leaving for Stripe, or the listing is uneditable
      // the moment the redirect happens.
      saveKey(id, token);
      goToStripe(id);
    } catch (err) {
      console.error('could not start checkout', err);
      restore();
      const hint = $('#verdict');
      if (hint) {
        hint.className = 'verdict verdict--bad';
        hint.textContent = 'Could not reach the payment page. Check your connection and try again.';
      }
    }
  }

  function goToStripe(listingId) {
    const link = CFG.STRIPE_PAYMENT_LINK;
    if (!link) { alert('Payments are not configured yet.'); return; }
    // The success URL cannot be trusted to carry the id back, so remember it.
    try { localStorage.setItem(LS_LAST, listingId); } catch { /* private mode */ }
    // Stripe payment links cannot be pre-filled with a custom amount, so the
    // buyer types it on Stripe's page. Carry it across so the amount they
    // picked here is the amount they see there.
    try { localStorage.setItem(LS_AMOUNT, String(state.draft?.cents || 0)); } catch { /* ignore */ }
    const sep = link.includes('?') ? '&' : '?';
    window.location.href = `${link}${sep}client_reference_id=${encodeURIComponent(listingId)}`;
  }

  /* ------------------------------------------------------------- thanks */

  async function renderThanks() {
    sticky.hidden = true;
    const params = new URLSearchParams(location.search);
    let id = params.get('listing') || '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      try { id = localStorage.getItem(LS_LAST) || ''; } catch { id = ''; }
    }

    view.innerHTML = `<div class="shell center-wrap">
      <h2 style="margin:0;letter-spacing:-.02em">Payment received</h2>
      <p style="color:var(--muted)">Putting you on the board…</p>
      <div class="spinner"></div>
    </div>`;
    document.title = 'Thanks — TopTen.one';

    if (!id || !sb) return thanksFallback();

    // The webhook usually lands in a second or two; give it twenty.
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const { data } = await sb.from('board')
        .select('id,platform,handle,total_cents,rank').eq('id', id).maybeSingle();
      if (data) return thanksSuccess(data);
      await new Promise(r => setTimeout(r, 1500));
    }
    thanksFallback();
  }

  function thanksSuccess(row) {
    const p = BY_SLUG[row.platform];
    const badge = `/badge/?p=${row.platform}&h=${encodeURIComponent(String(row.handle).replace(/^@/, ''))}`;
    const shareText = `I'm #${row.rank} on ${p.name}`;
    view.innerHTML = `<div class="shell center-wrap">
      <span style="color:var(--muted);text-transform:uppercase;letter-spacing:.12em;font-size:12px">You are</span>
      <div class="bigrank">#${row.rank}</div>
      <p style="margin:0;font-size:19px;font-weight:700">${esc(row.handle)} on ${esc(p.name)}</p>
      <p style="color:var(--muted);margin:6px 0 0">${money(row.total_cents)} on the board</p>
      <div class="share">
        <a href="${esc(postOnXUrl(shareText, badgeUrl(row.platform, row.handle)))}" target="_blank" rel="noopener">Post on X</a>
        <a href="${badge}" data-link>Get the badge</a>
        <a href="/?p=${row.platform}" data-link>Back to the board</a>
      </div>
      ${keyFor(row.id) ? `
      <p class="finelist" style="max-width:36ch;margin-top:22px">
        This browser can edit your listing. To edit it from another device, keep
        this link — anyone who has it can change your tagline and link.
        <button id="copy-manage" style="display:block;margin:8px auto 0;padding:7px 13px;border-radius:999px;border:1px solid var(--line);color:var(--muted);font-weight:700">Copy my edit link</button>
      </p>` : ''}
    </div>`;

    const copyBtn = $('#copy-manage');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const manage = `${location.origin}/?p=${row.platform}#manage=${row.id}:${keyFor(row.id)}`;
        try { await navigator.clipboard.writeText(manage); copyBtn.textContent = 'Copied'; }
        catch { copyBtn.textContent = 'Copy failed'; }
      });
    }
    document.title = `#${row.rank} on ${p.name} — TopTen.one`;
    confetti();
  }

  function thanksFallback() {
    view.innerHTML = `<div class="shell center-wrap">
      <h2 style="letter-spacing:-.02em">Payment received</h2>
      <p style="color:var(--muted);max-width:38ch">
        The board has not caught up yet. It usually takes a few seconds —
        open a board and your listing will be there.
      </p>
      <div class="share"><a href="/" data-link>Back to the boards</a></div>
    </div>`;
  }

  function confetti() {
    const c = $('#confetti');
    if (!c || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    c.hidden = false;
    const ctx = c.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    c.style.width = innerWidth + 'px'; c.style.height = innerHeight + 'px';
    ctx.scale(dpr, dpr);

    const colors = ['#ffc233', '#ffffff', '#fe2c55', '#9146ff', '#3ddc84'];
    const bits = Array.from({ length: 110 }, () => ({
      x: Math.random() * innerWidth,
      y: -20 - Math.random() * innerHeight * 0.4,
      w: 5 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      vy: 2 + Math.random() * 3.4,
      vx: -1.2 + Math.random() * 2.4,
      rot: Math.random() * Math.PI,
      vr: -0.12 + Math.random() * 0.24,
      color: colors[(Math.random() * colors.length) | 0]
    }));

    const stop = Date.now() + 4200;
    (function frame() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const b of bits) {
        b.x += b.vx; b.y += b.vy; b.rot += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y); ctx.rotate(b.rot);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }
      if (Date.now() < stop) requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, innerWidth, innerHeight); c.hidden = true; }
    })();
  }

  /* -------------------------------------------------------------- badge */

  function badgeParams() {
    const params = new URLSearchParams(location.search);
    let slug = params.get('p') || '';
    let handle = params.get('h') || '';
    if (!slug || !handle) {
      // /badge/<platform>/<handle> — served through the 404 fallback.
      const parts = location.pathname.split('/').filter(Boolean);
      if (parts[0] === 'badge') { slug = parts[1] || ''; handle = decodeURIComponent(parts[2] || ''); }
    }
    return { slug, handle: handle.startsWith('@') || !handle ? handle : '@' + handle };
  }

  /* Always the live domain, never location.origin: a badge shared from
     localhost or from plain http would post a link nobody else can open.
     The @ comes off so the address reads as one clickable topten.one URL
     rather than trailing a %40 that some clients cut the link at. */
  const SITE = 'https://topten.one';

  function badgeUrl(slug, handle) {
    return `${SITE}/badge/?p=${encodeURIComponent(slug)}&h=${encodeURIComponent(String(handle).replace(/^@/, ''))}`;
  }

  /* X renamed the endpoint: /intent/tweet is legacy and can land on the app's
     home instead of the composer. /intent/post is the current one. */
  function postOnXUrl(text, url) {
    return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  }

  function badgeSvg(rank, handle, platformName, color, amount) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 315" width="600" height="315" role="img" aria-label="#${rank} on ${platformName}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#12141b"/><stop offset="1" stop-color="#07080b"/>
    </linearGradient>
  </defs>
  <rect width="600" height="315" fill="url(#bg)"/>
  <rect x="0" y="0" width="600" height="4" fill="${color}"/>
  <text x="40" y="62" fill="#6b7280" font-family="system-ui,sans-serif" font-size="15" letter-spacing="3">TOPTEN.ONE</text>
  <text x="40" y="176" fill="#ffc233" font-family="ui-monospace,monospace" font-size="112" font-weight="800" letter-spacing="-6">#${rank}</text>
  <text x="40" y="222" fill="#f2f3f5" font-family="system-ui,sans-serif" font-size="27" font-weight="700">${esc(handle)}</text>
  <text x="40" y="252" fill="${color}" font-family="system-ui,sans-serif" font-size="17" font-weight="600">on ${esc(platformName)}</text>
  <text x="40" y="288" fill="#6b7280" font-family="ui-monospace,monospace" font-size="15">${esc(amount)} · Be the one.</text>
</svg>`;
  }

  async function renderBadge() {
    sticky.hidden = true;
    const { slug, handle } = badgeParams();
    const p = BY_SLUG[slug];

    if (!p || !handle) {
      view.innerHTML = `<div class="shell center-wrap"><h2>No badge here</h2>
        <p style="color:var(--muted)">That link is missing a platform or a handle.</p>
        <div class="share"><a href="/" data-link>Back to the boards</a></div></div>`;
      return;
    }

    if (!state.loaded) await loadBoards();
    const idx = board(slug).findIndex(r => r.handle.toLowerCase() === handle.toLowerCase());
    const row = idx >= 0 ? board(slug)[idx] : null;
    const rank = idx >= 0 ? idx + 1 : null;

    document.title = rank ? `#${rank} on ${p.name} — TopTen.one` : `${handle} — TopTen.one`;

    if (!row) {
      view.innerHTML = `<div class="shell center-wrap"><h2>${esc(handle)} is not on the ${esc(p.name)} board</h2>
        <p style="color:var(--muted)">It may have expired, or it was never paid for.</p>
        <div class="share"><a href="/?p=${slug}" data-link>See the board</a></div></div>`;
      return;
    }

    const svg = badgeSvg(rank, row.handle, p.name, p.color, money(row.total_cents));
    const shareText = `${row.handle} is #${rank} on ${p.name}`;
    const shareUrl = badgeUrl(slug, row.handle);

    view.innerHTML = `<div class="shell badgewrap">
      <div class="badgecard" id="badgecard">${svg}</div>
      <div class="share">
        <a href="${esc(postOnXUrl(shareText, shareUrl))}" target="_blank" rel="noopener">Post on X</a>
        <button id="dl">Download PNG</button>
        <button id="copy">Copy link</button>
        <a href="/?p=${slug}" data-link>See the board</a>
      </div>
      <p class="finelist" style="max-width:40ch;margin:16px auto 0;text-align:center">
        X shows the link, not the picture. Download the PNG and attach it to the
        post if you want the badge itself in the timeline.
      </p>
    </div>`;

    $('#dl').addEventListener('click', () => downloadPng(svg, `topten-${slug}-${rank}.png`));
    $('#copy').addEventListener('click', async e => {
      try { await navigator.clipboard.writeText(location.href); e.target.textContent = 'Copied'; }
      catch { e.target.textContent = 'Copy failed'; }
    });
  }

  function downloadPng(svg, filename) {
    const img = new Image();
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 1200; c.height = 630;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 1200, 630);
      URL.revokeObjectURL(url);
      c.toBlob(b => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, 'image/png');
    };
    img.onerror = () => alert('Could not render the badge.');
    img.src = url;
  }

  /* ------------------------------------------------------------ routing */

  function route() {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/thanks') return renderThanks();
    if (path === '/badge' || path.startsWith('/badge/')) return renderBadge();

    const p = new URLSearchParams(location.search).get('p');
    if (p && BY_SLUG[p]) state.platform = p;
    renderHome();
  }

  function navigate(href) {
    history.pushState({}, '', href);
    route();
    scrollTo({ top: 0, behavior: 'instant' });
  }

  addEventListener('popstate', route);

  document.addEventListener('click', e => {
    const link = e.target.closest('a[data-link]');
    if (link && link.origin === location.origin) {
      e.preventDefault();
      navigate(link.getAttribute('href'));
      return;
    }
    if (e.target.closest('[data-close]')) { closeModal(); return; }

    const tab = e.target.closest('[data-tab]');
    if (tab) {
      state.platform = tab.dataset.tab;
      history.replaceState({}, '', `/?p=${state.platform}`);
      renderHome();
      return;
    }

    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const row = Object.values(state.boards).flat().find(r => r.id === edit.dataset.edit);
      if (row) editModal(row);
      return;
    }

    const open = e.target.closest('[data-open]');
    if (open) {
      const row = Object.values(state.boards).flat().find(r => r.id === open.dataset.open);
      if (row) listingModal(row);
      return;
    }

    const add = e.target.closest('[data-add]');
    if (add) {
      const row = Object.values(state.boards).flat().find(r => r.id === add.dataset.add);
      if (row) addMoneyModal(row);
      return;
    }

    if (e.target.closest('[data-claim]')) { submitModal(state.platform); return; }
  });

  $('#cta-claim').addEventListener('click', () => submitModal(state.platform));
  $('#foot-contact').addEventListener('click', e => {
    e.preventDefault();
    location.href = `mailto:${CFG.CONTACT_EMAIL || 'hello@topten.one'}`;
  });

  // The share bar is static markup on every page, so wire it from here.
  document.addEventListener('click', async e => {
    const copy = e.target.closest('[data-share-copy]');
    if (!copy) return;
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(SITE + '/');
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy link'; }, 1800);
    } catch {
      copy.textContent = 'Copy failed';
    }
  });

  /* ------------------------------------------------------ live plumbing */

  const refresh = debounce(async () => { await loadBoards(); if (!modal.hidden) return; refreshBoard(); }, 450);

  function subscribe() {
    if (!sb) return;
    sb.channel('listings-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, refresh)
      .subscribe();

    const presence = sb.channel('who', { config: { presence: { key: uuid() } } });
    presence
      .on('presence', { event: 'sync' }, () => {
        state.online = Object.keys(presence.presenceState()).length || 1;
        const el = document.querySelector('.stat--live .stat__v');
        if (el) el.innerHTML = `<span class="pulse"></span>${state.online}`;
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') presence.track({ at: Date.now() }); });
  }

  function loadAnalytics() {
    const id = CFG.GA_MEASUREMENT_ID;
    if (!id) return;
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', id);
  }

  /* --------------------------------------------------------------- boot */

  (async function start() {
    absorbManageLink();
    initSupabase();
    loadAnalytics();
    if (sb) await loadBoards();
    route();
    subscribe();
    // Expired listings drop off silently, so re-read on a slow timer too.
    setInterval(() => { if (modal.hidden && document.visibilityState === 'visible') refresh(); }, 60000);
  })();

  // Exposed for the verification checklist.
  window.TopTen = { parseProfile, nextDollarAbove, clampMin, rankFor, money, PLATFORMS, state };
})();
