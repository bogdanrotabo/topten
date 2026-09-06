/* Google Analytics, kept in a file of its own so no page carries an inline
   script and the content security policy can stay a flat script-src 'self'
   plus the one host that serves gtag. */
window.dataLayer = window.dataLayer || [];
function gtag() { window.dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', (window.TOPTEN_CONFIG || {}).GA_MEASUREMENT_ID, { anonymize_ip: true });
