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
  // Mirrors the CHECK constraint on listings.tagline. The database truncates
  // silently past this, so the forms must never let anyone reach it unaware.
  const TAG_MAX = 80;
  // The thirty days a listing stays on a board are enforced by the `board`
  // view (last_paid_at > now() - '30 days'), not here. A constant sitting in
  // this file looks like the place to change that number and is not: editing
  // it would move nothing, and the board would go on expiring at thirty while
  // whoever changed it believed otherwise.
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
    if (!m) return false;
    saveKey(m[1], m[2]);
    history.replaceState({}, '', location.pathname + location.search);
    return true;
  }

  /* Called at boot, and again whenever only the hash changes. Boot alone was
     not enough: opening a manage link while already on the site is a
     same-document navigation — nothing reloads, so nothing ran, and the link
     did nothing at all without saying so. That is the one case where somebody
     is most likely to try it, because the thank-you page hands them the link
     on the site itself.

     Re-rendering after absorbing is what puts the Edit button on their
     listing; without it the key is saved and the page still shows no way in
     until the next reload. */
  addEventListener('hashchange', () => { if (absorbManageLink()) route(); });

  /* Two to forty characters of a person's or a team's name: letters from any
     alphabet, spaces, and the punctuation names actually carry -- Shaquille
     O'Neal, Karl-Anthony Towns, Nikola Jokic. Digits are out, because a name
     with a number in it is a handle, and this is not a handle board. */
  const NAME_RE = /^(?=.{2,40}$)[\p{L}][\p{L}.'’-]*(?: [\p{L}.'’-]+){0,5}$/u;

  /* A coin is not a person. It carries digits ("0x0.ai"), a dollar sign
     ("$WIF"), and is very often one lower-case word somebody typed at two in
     the morning -- so NAME_RE, which forbids all three, would throw out half
     the market. What stays enforced is that it is a name and not a sentence:
     forty characters, no slashes, no URL. */
  const COIN_RE = /^(?=.{1,40}$)\$?[\p{L}\p{N}][\p{L}\p{N}.\-_' ]*$/u;

  /* Titles, which is what most of the newer boards list: a game, a city, a
     restaurant, a podcast. Same shape as a name but digits are allowed and
     ampersands survive, because "Grand Theft Auto VI", "Bar 1969" and
     "Ben & Jerry's" are all how the thing is actually written. */
  const TITLE_RE = /^(?=.{2,40}$)[\p{L}\p{N}][\p{L}\p{N}.,'’&\- ]*$/u;

  /* A handle on the four big platforms: two to thirty characters, letters,
     digits, dot, underscore, hyphen, and an optional @ people type out of
     habit. Deliberately not NAME_RE -- a creator's handle is not their name,
     and half of them carry a number. */
  const HANDLE_RE = /^@?[A-Za-z0-9][A-Za-z0-9._-]{1,29}$/;

  /* The profile the handle points at. Lower-cased on the way in, because the
     unique key is (platform, url) and @MrBeast and @mrbeast are one creator
     on every one of these platforms -- two rows for one person is the single
     thing a board of real people must not do. */
  const creatorAt = base => tag => base + tag.replace(/^@/, '').toLowerCase();

  /* One name, one row. Lower case, accents off, punctuation out, spaces
     collapsed -- so "LeBron James", "lebron  james" and "Montreal" against
     "Montreal" all agree, and the fans bidding for one man are never split
     across three rows. Only the key underneath is folded; what everybody
     reads on the board is a proper spelling. */
  const fold = s => String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[$.'’-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  /* Every club in both leagues: name, the abbreviation the sport itself uses,
     and the two colours the club plays in.

     Not the crests. A club crest is registered artwork and this site takes
     money, which is the one combination the leagues actually send letters
     about. Colours are not ownable and the abbreviations are how the sport
     writes itself down -- put together they read at a glance across a list of
     thirty-two, which is the whole job of a mark this size.

     They are not listings either. The board shows what has been paid for and
     nothing else, so thirty-two unpaid rows would be invisible -- the view
     filters on last_paid_at. What the list solves is spelling: a fan should
     not have to know how to write "Vegas Golden Knights", and thirty people
     typing one club three ways is how a team's fans end up split across
     three rows. Picked from the list, they agree by default. */
  const ROSTERS = {
    'nba-teams': [
      ['Atlanta Hawks',          'ATL', '#e03a3e', '#c1d32f'],
      ['Boston Celtics',         'BOS', '#007a33', '#ba9653'],
      ['Brooklyn Nets',          'BKN', '#000000', '#ffffff'],
      ['Charlotte Hornets',      'CHA', '#1d1160', '#00788c'],
      ['Chicago Bulls',          'CHI', '#ce1141', '#000000'],
      ['Cleveland Cavaliers',    'CLE', '#860038', '#fdbb30'],
      ['Dallas Mavericks',       'DAL', '#00538c', '#b8c4ca'],
      ['Denver Nuggets',         'DEN', '#0e2240', '#fec524'],
      ['Detroit Pistons',        'DET', '#c8102e', '#1d42ba'],
      ['Golden State Warriors',  'GSW', '#1d428a', '#ffc72c'],
      ['Houston Rockets',        'HOU', '#ce1141', '#000000'],
      ['Indiana Pacers',         'IND', '#002d62', '#fdbb30'],
      ['LA Clippers',            'LAC', '#c8102e', '#1d428a'],
      ['Los Angeles Lakers',     'LAL', '#552583', '#fdb927'],
      ['Memphis Grizzlies',      'MEM', '#5d76a9', '#12173f'],
      ['Miami Heat',             'MIA', '#98002e', '#f9a01b'],
      ['Milwaukee Bucks',        'MIL', '#00471b', '#eee1c6'],
      ['Minnesota Timberwolves', 'MIN', '#0c2340', '#78be20'],
      ['New Orleans Pelicans',   'NOP', '#0c2340', '#c8102e'],
      ['New York Knicks',        'NYK', '#006bb6', '#f58426'],
      ['Oklahoma City Thunder',  'OKC', '#007ac1', '#ef3b24'],
      ['Orlando Magic',          'ORL', '#0077c0', '#c4ced4'],
      ['Philadelphia 76ers',     'PHI', '#006bb6', '#ed174c'],
      ['Phoenix Suns',           'PHX', '#1d1160', '#e56020'],
      ['Portland Trail Blazers', 'POR', '#e03a3e', '#000000'],
      ['Sacramento Kings',       'SAC', '#5a2d81', '#c4ced4'],
      ['San Antonio Spurs',      'SAS', '#c4ced4', '#000000'],
      ['Toronto Raptors',        'TOR', '#ce1141', '#000000'],
      ['Utah Jazz',              'UTA', '#002b5c', '#f9a01b'],
      ['Washington Wizards',     'WAS', '#002b5c', '#e31837']
    ],
    'nhl-teams': [
      ['Anaheim Ducks',          'ANA', '#f47a38', '#b9975b'],
      ['Boston Bruins',          'BOS', '#000000', '#ffb81c'],
      ['Buffalo Sabres',         'BUF', '#002654', '#fcb514'],
      ['Calgary Flames',         'CGY', '#c8102e', '#f1be48'],
      ['Carolina Hurricanes',    'CAR', '#cc0000', '#000000'],
      ['Chicago Blackhawks',     'CHI', '#cf0a2c', '#ff671f'],
      ['Colorado Avalanche',     'COL', '#6f263d', '#236192'],
      ['Columbus Blue Jackets',  'CBJ', '#002654', '#ce1126'],
      ['Dallas Stars',           'DAL', '#006847', '#8f8f8c'],
      ['Detroit Red Wings',      'DET', '#ce1126', '#ffffff'],
      ['Edmonton Oilers',        'EDM', '#041e42', '#ff4c00'],
      ['Florida Panthers',       'FLA', '#041e42', '#c8102e'],
      ['Los Angeles Kings',      'LAK', '#111111', '#a2aaad'],
      ['Minnesota Wild',         'MIN', '#154734', '#a6192e'],
      ['Montreal Canadiens',     'MTL', '#af1e2d', '#192168'],
      ['Nashville Predators',    'NSH', '#041e42', '#ffb81c'],
      ['New Jersey Devils',      'NJD', '#ce1126', '#000000'],
      ['New York Islanders',     'NYI', '#00539b', '#f47d30'],
      ['New York Rangers',       'NYR', '#0038a8', '#ce1126'],
      ['Ottawa Senators',        'OTT', '#c52032', '#c2912c'],
      ['Philadelphia Flyers',    'PHI', '#f74902', '#000000'],
      ['Pittsburgh Penguins',    'PIT', '#000000', '#fcb514'],
      ['San Jose Sharks',        'SJS', '#006d75', '#ea7200'],
      ['Seattle Kraken',         'SEA', '#001628', '#99d9d9'],
      ['St. Louis Blues',        'STL', '#002f87', '#fcb514'],
      ['Tampa Bay Lightning',    'TBL', '#002868', '#ffffff'],
      ['Toronto Maple Leafs',    'TOR', '#00205b', '#ffffff'],
      ['Utah Mammoth',           'UTA', '#71afe5', '#010101'],
      ['Vancouver Canucks',      'VAN', '#00205b', '#00843d'],
      ['Vegas Golden Knights',   'VGK', '#333f42', '#b4975a'],
      ['Washington Capitals',    'WSH', '#041e42', '#c8102e'],
      ['Winnipeg Jets',          'WPG', '#041e42', '#55b5e5']
    ],
    /* Ten names to start each player board: the shirt number, the colours of
       the club, and the club itself beside the name.

       Not a photograph. A player's face is licensed by the league and by the
       agencies that shoot it, and putting a real athlete's likeness on a site
       that takes money is the textbook right-of-publicity claim -- the one
       thing here that could cost real money. A number on a coloured disc says
       "McDavid, Edmonton, 97" to anyone who follows the sport, and belongs to
       nobody. If the faces are ever wanted for real, the way in is a licence,
       or a photo the fan uploads and warrants they may use.

       Unlike the clubs, this list is not the whole of anything. A league has
       exactly thirty-two teams and never a thirty-third; it has seven hundred
       players and "the best ten" is an argument, not a fact. So these are
       offered and nothing more -- type any name and it is taken. What settles
       the board is the money, the same as everywhere else on this site. */
  };

  /* Four accessors rather than four index numbers scattered about: the shape
     of a roster row is stated once here and nowhere else. */
  const teamName = t => t[0];
  const teamMark = t => t[1];
  const teamInk  = t => t[2];
  const teamTrim = t => t[3];
  const teamClub = t => t[4] || '';
  const teamNo   = t => t[5] || '';

  /* Only the two club boards are closed sets. A league has thirty-two teams
     and never a thirty-third, so anything else typed there is a mistake worth
     refusing. The player boards are open: their ten are a starting point, and
     a fan who wants somebody outside it must be able to say so. */
  const CLOSED_LIST = new Set(['nba-teams', 'nhl-teams']);


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
    { slug: 'threads',   name: 'Threads',   color: '#c9c9c9', hosts: ['threads.net', 'threads.com'] },

    /* The gaming boards. These do not take a profile URL, because two of the
       three have no public profile page a player could paste: Xbox hides
       profiles behind a sign-in and Nintendo has nothing but a friend code.
       The identity on a console is the tag itself, so that is what the form
       asks for -- see parseProfile, which branches on this `tag` block.

       `profile` is what the board links the name to. Null means there is
       nowhere to link, and the name renders as plain text instead. */
    { slug: 'playstation', name: 'PlayStation', color: '#0070d1', fan: true, tag: {
        label: 'PSN Online ID',
        hint:  '3 to 16 characters: letters, digits, hyphen and underscore',
        re:    /^[A-Za-z0-9][A-Za-z0-9_-]{2,15}$/,
        // psnprofiles is not Sony, but it is where a PSN ID actually resolves
        // to something a stranger can open.
        profile: id => `https://psnprofiles.com/${encodeURIComponent(id)}`
      } },
    { slug: 'xbox', name: 'Xbox', color: '#107c10', fan: true, tag: {
        label: 'Gamertag',
        hint:  '3 to 15 characters: letters, digits and single spaces',
        re:    /^[A-Za-z0-9][A-Za-z0-9 ]{1,13}[A-Za-z0-9]$|^[A-Za-z0-9]{3}$/,
        profile: t => `https://account.xbox.com/en-us/profile?gamertag=${encodeURIComponent(t)}`
      } },
    { slug: 'nintendo', name: 'Nintendo', color: '#e60012', fan: true, tag: {
        label: 'Friend Code',
        hint:  'SW-1234-5678-9012',
        re:    /^SW-\d{4}-\d{4}-\d{4}$/i,
        profile: null
      } },

    /* The leagues. A team and a player are both just names -- there is no
       account to link and nothing the person listed controls, which is the
       whole point: fans bid, the player never touches it.

       Teams and players are separate boards rather than one per league,
       because a top ten holding both the Lakers and LeBron is not a ranking
       of anything. */
    { slug: 'nba-teams', name: 'NBA Teams', color: '#c8102e', fan: true, tag: {
        label: 'Team name',
        hint:  'Los Angeles Lakers',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'nba-players', name: 'NBA Players', color: '#5b8ae6', fan: true, tag: {
        label: 'Player name',
        hint:  'LeBron James',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'nhl-teams', name: 'NHL Teams', color: '#d9dde2', fan: true, tag: {
        label: 'Team name',
        hint:  'Toronto Maple Leafs',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'nhl-players', name: 'NHL Players', color: '#4a7fe0', fan: true, tag: {
        label: 'Player name',
        hint:  'Connor McDavid',
        re:    NAME_RE,
        profile: null
      } },

    /* Crypto. Three boards, not one, because they answer three questions
       that have nothing to do with each other: what the market rates, what
       the internet is laughing at this week, and who is actually handing
       something out. Put Bitcoin on the same sheet as a dog coin launched
       this morning and the ranking says nothing about either.

       No profile to paste. A coin has no page its holders control -- the
       same ticker exists on twenty chains and the official site is a claim
       like any other -- so what is typed is the coin's own name, and the
       optional link is where the project wants people to go. */
    { slug: 'crypto', name: 'Crypto', color: '#f7931a', fan: true, tag: {
        label: 'Coin',
        hint:  'Bitcoin',
        re:    COIN_RE,
        profile: null
      } },
    { slug: 'memecoins', name: 'Memecoins', color: '#c2a633', fan: true, tag: {
        label: 'Memecoin',
        hint:  'Dogecoin',
        re:    COIN_RE,
        profile: null
      } },
    /* The places the coins are actually traded. A fourth crypto board rather
       than rows on the first one: an exchange is a company with a desk, a
       licence and a support queue, and putting Binance in the same ranking as
       a dog coin ranks neither. */
    { slug: 'exchanges', name: 'Exchanges', color: '#2775ca', fan: true,
      noun: 'exchange', tag: {
        label: 'Exchange',
        hint:  'Binance',
        re:    COIN_RE,
        profile: null
      } },
    /* The only board where the listing is an offer rather than a name: the
       project says what it is giving, and the link is where to claim it.
       Not a fan board -- nobody bids for somebody else's airdrop. */
    { slug: 'gifts', name: 'Gifts & Airdrops', color: '#16c784', tag: {
        label: 'Project',
        hint:  'Jupiter',
        re:    COIN_RE,
        profile: null
      } },

    /* Ten more, chosen for one thing: somebody already argues about the
       ranking for free. Where that argument is about somebody else -- a
       club, a driver, a band, a city, a dog -- the board is a fan board and
       the money is a vote. Where it is about the payer's own thing -- a
       startup, a restaurant, a podcast -- it is advertising, and they list
       themselves. Those are two different sentences on the button, which is
       what `fan` decides. */

    { slug: 'football-clubs', name: 'Football Clubs', color: '#22a06b', fan: true,
      noun: 'club', tag: {
        label: 'Club',
        hint:  'Real Madrid',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'football-players', name: 'Football Players', color: '#5ec269', fan: true, tag: {
        label: 'Player name',
        hint:  'Lionel Messi',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'f1-drivers', name: 'F1 Drivers', color: '#e10600', fan: true, tag: {
        label: 'Driver',
        hint:  'Max Verstappen',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'artists', name: 'Artists', color: '#ec4899', fan: true,
      noun: 'artist', tag: {
        label: 'Artist or band',
        hint:  'Fleetwood Mac',
        re:    TITLE_RE,
        profile: null
      } },
    { slug: 'games', name: 'Games', color: '#7c5cff', fan: true,
      noun: 'game', tag: {
        label: 'Game',
        hint:  'Elden Ring',
        re:    TITLE_RE,
        profile: null
      } },
    { slug: 'cities', name: 'Cities', color: '#64748b', fan: true,
      noun: 'city', tag: {
        label: 'City',
        hint:  'Lisbon',
        re:    TITLE_RE,
        profile: null
      } },
    { slug: 'pets', name: 'Pets', color: '#f97316', fan: true,
      noun: 'pet', tag: {
        label: 'Name',
        hint:  'Bruno',
        re:    TITLE_RE,
        profile: null
      } },

    /* The three that list themselves. No `fan`: the button says take #1,
       not bid for somebody. */
    { slug: 'startups', name: 'Startups', color: '#0ea5e9', tag: {
        label: 'Startup',
        hint:  'Acme Robotics',
        re:    TITLE_RE,
        profile: null
      } },
    { slug: 'restaurants', name: 'Restaurants', color: '#b45309', tag: {
        label: 'Restaurant',
        hint:  'Trattoria Bruno',
        re:    TITLE_RE,
        profile: null
      } },
    /* Five more, all fan boards: the thing ranked is never the thing paying.
       Cars and boats are marques rather than models — somebody bids for
       Porsche, not for one particular 911 — and both are lists people already
       argue about for free, which is the only test a board has to pass. */
    { slug: 'actors', name: 'Actors', color: '#e11d48', fan: true,
      noun: 'actor', tag: {
        label: 'Actor',
        hint:  'Meryl Streep',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'movies', name: 'Movies', color: '#4338ca', fan: true,
      noun: 'film', tag: {
        label: 'Film',
        hint:  'The Godfather',
        re:    TITLE_RE,
        profile: null
      } },
    { slug: 'cars', name: 'Cars', color: '#b91c1c', fan: true,
      noun: 'marque', tag: {
        label: 'Make',
        hint:  'Porsche',
        re:    TITLE_RE,
        profile: null
      } },
    { slug: 'boats', name: 'Boats', color: '#0369a1', fan: true,
      noun: 'yard', tag: {
        label: 'Builder',
        hint:  'Sunseeker',
        re:    TITLE_RE,
        profile: null
      } },
    { slug: 'golf-players', name: 'Golf Players', color: '#4d7c0f', fan: true, tag: {
        label: 'Player name',
        hint:  'Tiger Woods',
        re:    NAME_RE,
        profile: null
      } },

    /* Fighting, in three boards rather than one, and the reason is the same
       one that split the parties from the politicians: they are different
       questions with different answers.

       UFC is a promotion and its roster is a roster -- who is on top there
       this year. MMA is the sport, which is older and wider than that one
       company, and a list of it that left out Fedor because he never signed
       would be a list about contracts rather than fighting. Boxing is not
       mixed martial arts at all and shares nothing but a ring.

       Names overlap between the first two, and should: a fighter can be the
       best in the UFC and among the best there has ever been. Two rows on
       two boards for one man is two different claims. */
    { slug: 'ufc-fighters', name: 'UFC Fighters', color: '#d20a0a', fan: true,
      noun: 'fighter', tag: {
        label: 'Fighter',
        hint:  'Jon Jones',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'mma-fighters', name: 'MMA Fighters', color: '#0f766e', fan: true,
      noun: 'fighter', tag: {
        label: 'Fighter',
        hint:  'Fedor Emelianenko',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'boxers', name: 'Boxers', color: '#a16207', fan: true,
      noun: 'boxer', tag: {
        label: 'Boxer',
        hint:  'Muhammad Ali',
        re:    NAME_RE,
        profile: null
      } },

    /* The three promotions that are not the UFC. A fighter can be on the MMA
       board and on the board of whoever pays them, and those are different
       arguments: one is about the sport, the other about the roster. */
    { slug: 'bellator', name: 'Bellator Fighters', color: '#c2410c', fan: true,
      noun: 'fighter', tag: {
        label: 'Fighter',
        hint:  'Patricio Freire',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'one-championship', name: 'ONE Fighters', color: '#b91c1c', fan: true,
      noun: 'fighter', tag: {
        label: 'Fighter',
        hint:  'Rodtang Jitmuangnon',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'pfl', name: 'PFL Fighters', color: '#1d4ed8', fan: true,
      noun: 'fighter', tag: {
        label: 'Fighter',
        hint:  'Kayla Harrison',
        re:    NAME_RE,
        profile: null
      } },
    /* Politics, in two boards rather than one, and never as a poll.
    
       "Republicans vs Democrats" as a single board is two rows and nothing to
       rank. Parties and people are separate questions with separate answers,
       and both are lists that argue with themselves for free — which is the
       only test a board has to pass.
    
       What these two carry that no other board needs is a notice: money paid
       here is not a donation, a contribution or a vote. It buys a position in
       a private ranking on this website and nothing else. That is stated on
       the board itself rather than in the small print, because the small
       print is not where somebody about to pay is looking. */
    { slug: 'us-parties', name: 'U.S. Political Parties', color: '#7f1d1d',
      fan: true, noun: 'party', notice: true, tag: {
        label: 'Party',
        hint:  'Libertarian Party',
        re:    TITLE_RE,
        profile: null
      } },

    /* Movements, under the parties and deliberately not inside the USA group:
       a party belongs to a country and a movement does not. MAGA and the Tea
       Party are American, Solidarity was Polish, the Yellow Vests French, and
       Fridays for Future belongs to nobody. Filing them under a flag would be
       the first thing wrong with the board.

       It carries the same notice the political boards do, for the same reason:
       money paid here buys a place in a private ranking and nothing else. */
    { slug: 'movements', name: 'Movements', color: '#4338ca',
      fan: true, noun: 'movement', notice: true, tag: {
        label: 'Movement',
        hint:  'Fridays for Future',
        re:    TITLE_RE,
        profile: null
      } },
    { slug: 'us-politicians', name: 'U.S. Political Figures', color: '#1e3a8a',
      fan: true, noun: 'name', notice: true, tag: {
        label: 'Name',
        hint:  'Abraham Lincoln',
        re:    NAME_RE,
        profile: null
      } },

    /* The Union's politics, in the two boards the American politics has: the
       parties -- the European parties and the groups they sit in -- and the
       figures, who are every sitting Member of the European Parliament, from
       the Parliament's own list by way of scripts/build-eu-parliament.mjs,
       with the portrait Wikidata holds for each. The same notice as the
       American boards, for the same reason: money paid here buys a place in
       a private ranking and nothing else. */
    { slug: 'eu-parties', name: 'EU Political Parties', color: '#003399',
      fan: true, noun: 'party', notice: true, tag: {
        label: 'Party',
        hint:  'Renew Europe',
        re:    TITLE_RE,
        profile: null
      } },
    { slug: 'eu-politicians', name: 'EU Political Figures', color: '#2952c9',
      fan: true, noun: 'name', notice: true, tag: {
        label: 'Name',
        hint:  'Roberta Metsola',
        re:    NAME_RE,
        profile: null
      } },
    /* The rich, by country: twenty boards under one heading, each asking who
       should be #1 among a country's billionaires. Fan boards like the
       players and the politicians -- the person ranked is not the person
       paying -- with the same open name field, and a list that comes from
       Forbes's own feed by way of scripts/build-rich-rosters.mjs rather than
       from anybody's memory of who is rich this year.

       Citizenship draws the borders, because that is how the source draws
       them; the Emirates board also takes the people who live there, and the
       builder says why. The chip label is the country alone, since the
       heading already says Billionaires and the flag says the rest. */
    { slug: 'us-billionaires', name: 'U.S. Billionaires', chip: 'USA', color: '#1d4ed8',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Warren Buffett',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'uk-billionaires', name: 'UK Billionaires', chip: 'UK', color: '#012169',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'James Dyson',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'switzerland-billionaires', name: 'Swiss Billionaires', chip: 'Switzerland', color: '#da291c',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Ernesto Bertarelli',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'uae-billionaires', name: 'UAE Billionaires', chip: 'UAE', color: '#00732f',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Hussain Sajwani',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'japan-billionaires', name: 'Japanese Billionaires', chip: 'Japan', color: '#bc002d',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Masayoshi Son',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'australia-billionaires', name: 'Australian Billionaires', chip: 'Australia', color: '#00008b',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Gina Rinehart',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'china-billionaires', name: 'Chinese Billionaires', chip: 'China', color: '#de2910',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Jack Ma',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'israel-billionaires', name: 'Israeli Billionaires', chip: 'Israel', color: '#0038b8',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Eyal Ofer',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'india-billionaires', name: 'Indian Billionaires', chip: 'India', color: '#ff9933',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Mukesh Ambani',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'germany-billionaires', name: 'German Billionaires', chip: 'Germany', color: '#dd0000',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Dieter Schwarz',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'france-billionaires', name: 'French Billionaires', chip: 'France', color: '#0055a4',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Bernard Arnault',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'canada-billionaires', name: 'Canadian Billionaires', chip: 'Canada', color: '#d80621',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Tobi Lütke',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'italy-billionaires', name: 'Italian Billionaires', chip: 'Italy', color: '#009246',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Giovanni Ferrero',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'brazil-billionaires', name: 'Brazilian Billionaires', chip: 'Brazil', color: '#009c3b',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Jorge Paulo Lemann',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'russia-billionaires', name: 'Russian Billionaires', chip: 'Russia', color: '#0039a6',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Vladimir Potanin',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'saudi-arabia-billionaires', name: 'Saudi Billionaires', chip: 'Saudi Arabia', color: '#006c35',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Alwaleed bin Talal',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'singapore-billionaires', name: 'Singapore Billionaires', chip: 'Singapore', color: '#ef3340',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Forrest Li',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'south-korea-billionaires', name: 'South Korean Billionaires', chip: 'South Korea', color: '#0047a0',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Jay Y. Lee',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'spain-billionaires', name: 'Spanish Billionaires', chip: 'Spain', color: '#aa151b',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Amancio Ortega',
        re:    NAME_RE,
        profile: null
      } },
    { slug: 'mexico-billionaires', name: 'Mexican Billionaires', chip: 'Mexico', color: '#006847',
      fan: true, noun: 'name', tag: {
        label: 'Name',
        hint:  'Carlos Slim',
        re:    NAME_RE,
        profile: null
      } },

    { slug: 'podcasts', name: 'Podcasts', color: '#0d9488', tag: {
        label: 'Podcast',
        hint:  'The Weekly Show',
        re:    TITLE_RE,
        profile: null
      } },

    /* The four influencer boards, which are not the four platform boards
       they sit next to. On /x/ you list your own profile and the money buys
       your own place; on /x-influencers/ the person ranked is not the person
       paying, and what the board settles is an argument that already happens
       for free every day -- who the biggest creator on the platform is.

       Same identity either way: a handle, turned into the real profile link
       so the row goes somewhere. */
    { slug: 'x-influencers', name: 'X Influencers', color: '#e7e9ea',
      fan: true, noun: 'creator', face: 'x', tag: {
        label: 'Handle on X',
        hint:  '@MrBeast',
        re:    HANDLE_RE,
        profile: creatorAt('https://x.com/')
      } },
    { slug: 'instagram-influencers', name: 'Instagram Influencers', color: '#d62976',
      fan: true, noun: 'creator', face: 'instagram', tag: {
        label: 'Handle on Instagram',
        hint:  '@cristiano',
        re:    HANDLE_RE,
        profile: creatorAt('https://www.instagram.com/')
      } },
    { slug: 'tiktok-influencers', name: 'TikTok Influencers', color: '#fe2c55',
      fan: true, noun: 'creator', face: 'tiktok', tag: {
        label: 'Handle on TikTok',
        hint:  '@khaby.lame',
        re:    HANDLE_RE,
        profile: creatorAt('https://www.tiktok.com/@')
      } },
    { slug: 'youtube-influencers', name: 'YouTube Influencers', color: '#ff0000',
      fan: true, noun: 'creator', face: 'youtube', tag: {
        label: 'Handle on YouTube',
        hint:  '@MrBeast',
        re:    HANDLE_RE,
        profile: creatorAt('https://www.youtube.com/@')
      } },
    { slug: 'facebook-influencers', name: 'Facebook Influencers', color: '#1877f2',
      fan: true, noun: 'creator', face: 'facebook', tag: {
        label: 'Page or handle',
        hint:  '@leomessi',
        re:    HANDLE_RE,
        profile: creatorAt('https://www.facebook.com/')
      } }
  ];


  /**
   * A map that can only answer for keys we put in it.
   *
   * These are looked up with strings taken straight off the URL, and
   * `Object.fromEntries` hands back an object with `Object.prototype` behind
   * it. So `BY_SLUG['constructor']` was truthy, `/constructor` set the platform
   * to "constructor", `state.boards['constructor']` returned the `Object`
   * function instead of falling back to `[]`, and `rows.slice(10)` threw. The
   * whole board vanished for anyone who opened that address — no tabs, no rows,
   * no stats. A null prototype has nothing to inherit and nothing to leak.
   */
  const slugMap = pairs => Object.assign(Object.create(null), Object.fromEntries(pairs));

  const BY_SLUG = slugMap(PLATFORMS.map(p => [p.slug, p]));

  // The platforms' own marks, used to say which board a listing sits on.
  // Single-path where the brand allows it, so they scale down to 12px cleanly.
  /* Thirteen stripes and a canton, drawn to read at 15px: fifty stars at that
     size is a grey smudge, so the canton carries nine — enough to be a field
     of stars and not a fake count anyone would mistake for the real one. */
  /* Twelve stars in a ring on blue. Twelve is the number on the flag and
     twelve dots is what a ring of stars is at 15px; drawn as circles, the
     way the American canton's are. */
  const EU_FLAG =
    '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#003399"/>' +
    '<g fill="#ffcc00"><circle cx="17.00" cy="12.00" r=".62"/><circle cx="16.33" cy="14.50" r=".62"/><circle cx="14.50" cy="16.33" r=".62"/><circle cx="12.00" cy="17.00" r=".62"/><circle cx="9.50" cy="16.33" r=".62"/><circle cx="7.67" cy="14.50" r=".62"/><circle cx="7.00" cy="12.00" r=".62"/><circle cx="7.67" cy="9.50" r=".62"/><circle cx="9.50" cy="7.67" r=".62"/><circle cx="12.00" cy="7.00" r=".62"/><circle cx="14.50" cy="7.67" r=".62"/><circle cx="16.33" cy="9.50" r=".62"/></g>' +
    '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>';
  const US_FLAG =
    '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#f2f2f2"/>' +
    '<g fill="#b22234">' +
    '<rect x="1.6" y="4.4" width="20.8" height="2.17"/><rect x="1.6" y="8.74" width="20.8" height="2.17"/>' +
    '<rect x="1.6" y="13.08" width="20.8" height="2.17"/><rect x="1.6" y="17.42" width="20.8" height="2.18"/>' +
    '</g>' +
    '<rect x="1.6" y="4.4" width="9.4" height="8.68" fill="#3c3b6e"/>' +
    '<g fill="#fff">' +
    '<circle cx="3.7" cy="6.3" r=".62"/><circle cx="6.3" cy="6.3" r=".62"/><circle cx="8.9" cy="6.3" r=".62"/>' +
    '<circle cx="3.7" cy="8.74" r=".62"/><circle cx="6.3" cy="8.74" r=".62"/><circle cx="8.9" cy="8.74" r=".62"/>' +
    '<circle cx="3.7" cy="11.18" r=".62"/><circle cx="6.3" cy="11.18" r=".62"/><circle cx="8.9" cy="11.18" r=".62"/>' +
    '</g>' +
    '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>';

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
    snapchat: '<path fill="currentColor" d="M12 2.2c2.7 0 4.6 2 4.8 4.7v2c.3.1.7 0 1-.1.4-.2.9 0 1.1.4.2.4 0 .9-.4 1.1-.5.2-1 .4-1.5.5-.2.1-.3.3-.2.5.5 1.5 1.6 2.7 3 3.4.3.2.4.5.3.8-.3.8-1.4 1.1-2.2 1.2l-.2.9c-.1.2-.3.4-.5.4-.5 0-1-.1-1.5 0-.5.1-.9.4-1.3.7-.6.5-1.4.8-2.2.8s-1.6-.3-2.2-.8c-.4-.3-.8-.6-1.3-.7-.5-.1-1 0-1.5 0-.2 0-.4-.2-.5-.4l-.2-.9c-.8-.1-1.9-.4-2.2-1.2-.1-.3 0-.6.3-.8 1.4-.7 2.5-1.9 3-3.4.1-.2 0-.4-.2-.5-.5-.1-1-.3-1.5-.5-.4-.2-.6-.7-.4-1.1.2-.4.7-.6 1.1-.4.3.1.7.2 1 .1v-2c.2-2.7 2.1-4.7 4.8-4.7"/>',
    playstation: '<path fill="currentColor" d="M9.5 3.4v15.9l3.6 1.1V7.6c0-.6.3-1 .8-.8.6.2.7.7.7 1.3v4.7c2.2 1.1 4 0 4-2.9 0-3-1-4.3-4-5.3-1.2-.4-3.4-1-5.1-1.2m4.8 14.4 5.8-2.1c.7-.2.8-.6.2-.8s-1.6-.2-2.3 0l-3.7 1.3v-2.1l.2-.1s.7-.2 1.6-.3c1-.1 2.1 0 3 .1 1 .1 1.4.3 1.9.5.4.2.5.6-.1 1-.6.4-6.6 2.6-6.6 2.6zM4.3 17.6c-1-.3-1.2-.9-.7-1.3.4-.3 1.1-.5 1.1-.5l4.4-1.6v1.8l-3.2 1.1c-.6.2-.7.5-.2.7.5.1 1.3.1 1.9-.1l1.5-.5v1.6c-1.6.3-3.3.2-4.8-.2z"/>',
    xbox: '<path fill="currentColor" d="M6.3 3.7a10 10 0 0 1 11.4 0c.4.3.2.5-.1.4-1.6-.6-4.1.6-5.6 1.8-1.5-1.2-4-2.4-5.6-1.8-.3.1-.5-.1-.1-.4M12 8.6c2.7 2.6 6.6 7.3 6 9.7A10 10 0 0 1 12 22a10 10 0 0 1-6-3.7c-.6-2.4 3.3-7.1 6-9.7M4.4 5.6c.5-.1 2 .5 4 2.7C5.8 11 3 15 3.4 17A10 10 0 0 1 4.4 5.6m15.2 0A10 10 0 0 1 20.6 17c.4-2-2.4-6-5-8.7 2-2.2 3.5-2.8 4-2.7"/>',
    nintendo: '<path fill="currentColor" d="M4.5 2h4.3v20H4.5A2.5 2.5 0 0 1 2 19.5v-15A2.5 2.5 0 0 1 4.5 2m2.1 3.3a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2M15.2 2h4.3A2.5 2.5 0 0 1 22 4.5v15a2.5 2.5 0 0 1-2.5 2.5h-4.3zm2.2 12.1a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4"/>',
    /* The two sports, drawn rather than borrowed. A league crest is
       registered artwork and this site takes money for rank -- the ball and
       the sticks say basketball and hockey just as fast, and belong to
       nobody. Both boards of a sport share its mark; what tells teams from
       players is the label under it. */
    'nba-teams': '<circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 2.8v18.4M2.8 12h18.4M5.5 5.5c2.3 2 3.7 4.4 3.7 6.5s-1.4 4.5-3.7 6.5M18.5 5.5c-2.3 2-3.7 4.4-3.7 6.5s1.4 4.5 3.7 6.5"/>',
    'nba-players': '<circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 2.8v18.4M2.8 12h18.4M5.5 5.5c2.3 2 3.7 4.4 3.7 6.5s-1.4 4.5-3.7 6.5M18.5 5.5c-2.3 2-3.7 4.4-3.7 6.5s1.4 4.5 3.7 6.5"/>',
    'nhl-teams': '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 3.4 14.4 13H19M19 3.4 9.6 13H5"/><ellipse cx="12" cy="18.6" rx="5" ry="2.1" fill="currentColor"/>',
    'nhl-players': '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 3.4 14.4 13H19M19 3.4 9.6 13H5"/><ellipse cx="12" cy="18.6" rx="5" ry="2.1" fill="currentColor"/>',
    /* Crypto, drawn for the same reason as the leagues: every coin logo on
       the market is somebody's registered mark, and this site sells rank.
       A coin, a coin grinning, a box with a ribbon -- each reads at 20px and
       belongs to nobody. */
    crypto: '<circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M12 6.4v11.2M9.6 9.2h4.2a1.9 1.9 0 0 1 0 3.8H9.6h4.5a1.9 1.9 0 0 1 0 3.8H9.6"/>',
    memecoins: '<circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M8 14.2a4.6 4.6 0 0 0 8 0"/>',
    /* Two arrows crossing: the thing an exchange does, and the one drawing
       that is nobody's registered mark. */
    /* Drawn, like every other board whose subject is somebody's registered
       mark. A car badge and a shipyard's crest are trademarks; a clapperboard
       and a hull are not. */
    actors: '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M3.4 8.6h17.2v12H3.4zM3.4 8.6 6 3.6l3.6 4M9.6 8.6 12.2 3.6l3.6 4M15.8 8.6l2.6-5 2.2 3.4v1.6"/>',
    movies: '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M3.4 4.4h17.2v15.2H3.4z"/><path fill="none" stroke="currentColor" stroke-width="1.5" d="M7.4 4.4v15.2M16.6 4.4v15.2M3.4 12h17.2"/><path fill="currentColor" d="M4.6 6h1.6v1.6H4.6zM4.6 9h1.6v1.6H4.6zM4.6 13.4h1.6V15H4.6zM4.6 16.4h1.6V18H4.6zM17.8 6h1.6v1.6h-1.6zM17.8 9h1.6v1.6h-1.6zM17.8 13.4h1.6V15h-1.6zM17.8 16.4h1.6V18h-1.6z"/>',
    cars: '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M3 15.4v-2.2l1.8-4A2.4 2.4 0 0 1 7 7.6h10a2.4 2.4 0 0 1 2.2 1.6l1.8 4v2.2a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 15.4z"/><path fill="none" stroke="currentColor" stroke-width="1.5" d="M4.8 13.2h14.4"/><circle cx="7.2" cy="16.6" r="1.9" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16.8" cy="16.6" r="1.9" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    boats: '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M3 16.4h18l-2.4 4H5.4zM12 3.2v10.6M12 13.8H5.6L12 3.2M12.8 13.8h5.6l-5.6-7.4z"/>',
    /* The flag, for both American boards. It is the one mark that says which
       country's politics this is without taking sides inside it — and unlike
       a party emblem it belongs to nobody, being a work of the United States
       government and a national flag besides. The ballot box and the lectern
       it replaces said "politics" but not "American politics", which is the
       distinction the next country's boards will need. */
    'us-parties': US_FLAG,
    'us-politicians': US_FLAG,
    'eu-parties': EU_FLAG,
    'eu-politicians': EU_FLAG,
    /* Twenty flags, for the twenty billionaire boards, on the same frame as
       the one above and drawn the same way: what reads at 15px, and no more.
       The Union Jack keeps its crosses and loses their offset; Australia's
       canton is that jack at half size with the stars as stars; China's are
       stars, Israel's is the shield and the stripes, India's the wheel as a
       ring. Saudi Arabia's script is a stroke where the words would be,
       because the words are the creed and a fake rendering of them is worse
       than a gesture at where they sit. Nothing here belongs to anybody: a
       national flag is nobody's mark. */
    'us-billionaires': US_FLAG,
    'uk-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#012169"/><polygon points="1.6,4.4 1.6,6.38 19.69,19.6 22.4,19.6 22.4,17.62 4.31,4.4" fill="#fff"/><polygon points="1.6,19.6 4.31,19.6 22.4,6.38 22.4,4.4 19.69,4.4 1.6,17.62" fill="#fff"/><polygon points="1.6,4.4 1.6,5.17 21.34,19.6 22.4,19.6 22.4,18.83 2.66,4.4" fill="#c8102e"/><polygon points="1.6,19.6 2.66,19.6 22.4,5.17 22.4,4.4 21.34,4.4 1.6,18.83" fill="#c8102e"/><rect x="9.4" y="4.4" width="5.2" height="15.2" fill="#fff"/><rect x="1.6" y="9.4" width="20.8" height="5.2" fill="#fff"/><rect x="10.45" y="4.4" width="3.1" height="15.2" fill="#c8102e"/><rect x="1.6" y="10.45" width="20.8" height="3.1" fill="#c8102e"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'switzerland-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#da291c"/><rect x="10.2" y="6.6" width="3.6" height="10.8" fill="#fff"/><rect x="6.6" y="10.2" width="10.8" height="3.6" fill="#fff"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'uae-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#fff"/><rect x="6.8" y="4.4" width="15.6" height="5.07" fill="#00732f"/><rect x="6.8" y="14.53" width="15.6" height="5.07" fill="#000"/><rect x="1.6" y="4.4" width="5.2" height="15.2" fill="#ff0000"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'japan-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#fff"/><circle cx="12" cy="12" r="4.5" fill="#bc002d"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'australia-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#00008b"/><polygon points="1.6,4.4 1.6,5.23 10.86,12 12,12 12,11.17 2.74,4.4" fill="#fff"/><polygon points="1.6,12 2.74,12 12,5.23 12,4.4 10.86,4.4 1.6,11.17" fill="#fff"/><polygon points="1.6,4.4 1.6,4.73 11.56,12 12,12 12,11.67 2.04,4.4" fill="#c8102e"/><polygon points="1.6,12 2.04,12 12,4.73 12,4.4 11.56,4.4 1.6,11.67" fill="#c8102e"/><rect x="5.71" y="4.4" width="2.18" height="7.6" fill="#fff"/><rect x="1.6" y="7.11" width="10.4" height="2.18" fill="#fff"/><rect x="6.15" y="4.4" width="1.3" height="7.6" fill="#c8102e"/><rect x="1.6" y="7.55" width="10.4" height="1.3" fill="#c8102e"/><polygon points="6.8,13.85 7.21,15.04 8.4,14.62 7.73,15.69 8.8,16.36 7.54,16.49 7.69,17.75 6.8,16.85 5.91,17.75 6.06,16.49 4.8,16.36 5.87,15.69 5.2,14.62 6.39,15.04" fill="#fff"/><polygon points="17.2,5.65 17.38,6.22 17.94,6.01 17.61,6.51 18.13,6.81 17.53,6.86 17.61,7.46 17.2,7.02 16.79,7.46 16.87,6.86 16.27,6.81 16.79,6.51 16.46,6.01 17.02,6.22" fill="#fff"/><polygon points="14.6,10.95 14.78,11.52 15.34,11.31 15.01,11.81 15.53,12.11 14.93,12.16 15.01,12.76 14.6,12.32 14.19,12.76 14.27,12.16 13.67,12.11 14.19,11.81 13.86,11.31 14.42,11.52" fill="#fff"/><polygon points="19.6,9.55 19.78,10.12 20.34,9.91 20.01,10.41 20.53,10.71 19.93,10.76 20.01,11.36 19.6,10.92 19.19,11.36 19.27,10.76 18.67,10.71 19.19,10.41 18.86,9.91 19.42,10.12" fill="#fff"/><polygon points="17.2,16.45 17.38,17.02 17.94,16.81 17.61,17.31 18.13,17.61 17.53,17.66 17.61,18.26 17.2,17.82 16.79,18.26 16.87,17.66 16.27,17.61 16.79,17.31 16.46,16.81 17.02,17.02" fill="#fff"/><circle cx="18.5" cy="12.9" r="0.45" fill="#fff"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'china-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#de2910"/><polygon points="5.9,6.3 6.61,8.33 8.75,8.37 7.04,9.67 7.66,11.73 5.9,10.5 4.14,11.73 4.76,9.67 3.05,8.37 5.19,8.33" fill="#ffde00"/><polygon points="10.4,5.25 10.62,5.89 11.3,5.91 10.76,6.32 10.96,6.97 10.4,6.58 9.84,6.97 10.04,6.32 9.5,5.91 10.18,5.89" fill="#ffde00"/><polygon points="12.2,7.05 12.42,7.69 13.1,7.71 12.56,8.12 12.76,8.77 12.2,8.38 11.64,8.77 11.84,8.12 11.3,7.71 11.98,7.69" fill="#ffde00"/><polygon points="12.2,9.65 12.42,10.29 13.1,10.31 12.56,10.72 12.76,11.37 12.2,10.98 11.64,11.37 11.84,10.72 11.3,10.31 11.98,10.29" fill="#ffde00"/><polygon points="10.4,11.45 10.62,12.09 11.3,12.11 10.76,12.52 10.96,13.17 10.4,12.78 9.84,13.17 10.04,12.52 9.5,12.11 10.18,12.09" fill="#ffde00"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'israel-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#fff"/><rect x="1.6" y="6.1" width="20.8" height="2" fill="#0038b8"/><rect x="1.6" y="15.9" width="20.8" height="2" fill="#0038b8"/><path d="M12 9.1l2.6 4.5H9.4zM12 14.9l2.6-4.5H9.4z" fill="none" stroke="#0038b8" stroke-width=".85" stroke-linejoin="round"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'india-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#fff"/><rect x="1.6" y="4.4" width="20.8" height="5.07" fill="#ff9933"/><rect x="1.6" y="14.53" width="20.8" height="5.07" fill="#138808"/><circle cx="12" cy="12" r="2" fill="none" stroke="#000080" stroke-width=".55"/><circle cx="12" cy="12" r="0.4" fill="#000080"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'germany-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#000"/><rect x="1.6" y="4.4" width="20.8" height="5.07" fill="#000"/><rect x="1.6" y="9.47" width="20.8" height="5.07" fill="#dd0000"/><rect x="1.6" y="14.53" width="20.8" height="5.07" fill="#ffce00"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'france-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#fff"/><rect x="1.6" y="4.4" width="6.93" height="15.2" fill="#0055a4"/><rect x="8.53" y="4.4" width="6.93" height="15.2" fill="#fff"/><rect x="15.47" y="4.4" width="6.93" height="15.2" fill="#ef4135"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'canada-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#fff"/><rect x="1.6" y="4.4" width="5.2" height="15.2" fill="#d80621"/><rect x="17.2" y="4.4" width="5.2" height="15.2" fill="#d80621"/><polygon points="12,7.8 12.9,9.5 14.3,9 13.8,10.8 16.2,9.9 15.6,11.6 16.8,12 14.2,14.2 14.6,15.2 12.4,14.8 12.4,16.6 11.6,16.6 11.6,14.8 9.4,15.2 9.8,14.2 7.2,12 8.4,11.6 7.8,9.9 10.2,10.8 9.7,9 11.1,9.5" fill="#d80621"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'italy-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#fff"/><rect x="1.6" y="4.4" width="6.93" height="15.2" fill="#009246"/><rect x="8.53" y="4.4" width="6.93" height="15.2" fill="#fff"/><rect x="15.47" y="4.4" width="6.93" height="15.2" fill="#ce2b37"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'brazil-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#009c3b"/><polygon points="12,5.4 20.8,12 12,18.6 3.2,12" fill="#ffdf00"/><circle cx="12" cy="12" r="3.1" fill="#002776"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'russia-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#fff"/><rect x="1.6" y="4.4" width="20.8" height="5.07" fill="#fff"/><rect x="1.6" y="9.47" width="20.8" height="5.07" fill="#0039a6"/><rect x="1.6" y="14.53" width="20.8" height="5.07" fill="#d52b1e"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'saudi-arabia-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#006c35"/><path d="M5.8 10.3c1.2-2 2.4 1.1 3.7-.3s2.2 1.5 3.6.1 2.3 1.3 3.7-.2 1.2 1 1.9.4" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round"/><path d="M5.8 14.9h12.4" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/><rect x="16.1" y="13.6" width="0.8" height="2.6" fill="#fff"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'singapore-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#fff"/><rect x="1.6" y="4.4" width="20.8" height="7.6" fill="#ef3340"/><circle cx="5.8" cy="8.2" r="2.3" fill="#fff"/><circle cx="6.75" cy="8" r="1.9" fill="#ef3340"/><circle cx="9.1" cy="6.95" r="0.4" fill="#fff"/><circle cx="10.29" cy="7.81" r="0.4" fill="#fff"/><circle cx="9.83" cy="9.21" r="0.4" fill="#fff"/><circle cx="8.37" cy="9.21" r="0.4" fill="#fff"/><circle cx="7.91" cy="7.81" r="0.4" fill="#fff"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'south-korea-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#fff"/><path d="M8.7 12a3.3 3.3 0 0 1 6.6 0z" fill="#cd2e3a"/><path d="M8.7 12a3.3 3.3 0 0 0 6.6 0z" fill="#0047a0"/><g transform="translate(4.9 7.3) rotate(-34)"><path d="M-1.15-.8h2.3M-1.15 0h2.3M-1.15.8h2.3" fill="none" stroke="#000" stroke-width=".62"/></g><g transform="translate(19.1 7.3) rotate(34)"><path d="M-1.15-.8h2.3M-1.15 0h2.3M-1.15.8h2.3" fill="none" stroke="#000" stroke-width=".62"/></g><g transform="translate(4.9 16.7) rotate(34)"><path d="M-1.15-.8h2.3M-1.15 0h2.3M-1.15.8h2.3" fill="none" stroke="#000" stroke-width=".62"/></g><g transform="translate(19.1 16.7) rotate(-34)"><path d="M-1.15-.8h2.3M-1.15 0h2.3M-1.15.8h2.3" fill="none" stroke="#000" stroke-width=".62"/></g><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'spain-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#f1bf00"/><rect x="1.6" y="4.4" width="20.8" height="3.8" fill="#aa151b"/><rect x="1.6" y="15.8" width="20.8" height="3.8" fill="#aa151b"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'mexico-billionaires': '<rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="#fff"/><rect x="1.6" y="4.4" width="6.93" height="15.2" fill="#006847"/><rect x="8.53" y="4.4" width="6.93" height="15.2" fill="#fff"/><rect x="15.47" y="4.4" width="6.93" height="15.2" fill="#ce1126"/><circle cx="12" cy="11.6" r="1.5" fill="#8c5a2b"/><ellipse cx="12" cy="13.5" rx="1.3" ry=".5" fill="#4d7c2a"/><rect x="1.6" y="4.4" width="20.8" height="15.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>',
    'golf-players': '<circle cx="17.4" cy="6.4" r="3.1" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M6.2 3.4v14.4M6.2 3.4l7.4 2.4-7.4 2.6"/><ellipse cx="10" cy="19.4" rx="6.4" ry="1.9" fill="none" stroke="currentColor" stroke-width="1.5"/>',

    /* The cage, a pair of gloves, and one glove. Drawn rather than borrowed,
       for the same reason the leagues are: a promotion's mark is registered
       artwork and this site takes money for rank. An octagon says UFC to
       anybody who has seen one and belongs to nobody. */
    'ufc-fighters': '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M8.4 2.4h7.2l5.2 5.2v7.2l-5.2 5.2H8.4l-5.2-5.2V7.6z"/>',

    /* A megaphone. A raised fist is the obvious glyph for a movement and it
       belongs to one half of them; a megaphone is what all of them do. */
    'movements': '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M20.4 4.6v14.8l-11-3.9V8.5z"/>'
      + '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M9.4 8.5H5.8A2.2 2.2 0 0 0 3.6 10.7v2.6a2.2 2.2 0 0 0 2.2 2.2h3.6"/>'
      + '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M6.6 15.5l1.5 4.2"/>',
    'mma-fighters': '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M6.2 12V9.8a2.1 2.1 0 0 1 4.2 0V9a2.1 2.1 0 0 1 4.2 0v.8a2.1 2.1 0 0 1 4.2 0v4.9a4.5 4.5 0 0 1-4.5 4.5h-3.4a4.7 4.7 0 0 1-4.7-4.7z"/>' + '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M6.4 13.2h4a1.8 1.8 0 0 1 0 3.6H6.6"/>',
    'boxers': '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M7.4 7.2a4.6 4.6 0 0 1 9.2 0v3.9a5 5 0 0 1-.9 2.9l-.5.7v3.6a1.7 1.7 0 0 1-1.7 1.7h-3a1.7 1.7 0 0 1-1.7-1.7v-3.6l-.5-.7a5 5 0 0 1-.9-2.9V9.6"/><path fill="none" stroke="currentColor" stroke-width="1.6" d="M7.4 9.6H6.2a1.9 1.9 0 0 0 0 3.8h1.2"/>',

    /* ONE and PFL are drawn: neither has a freely licensed mark anywhere, and
       the only thing Commons offers under "PFL logo" is a Ukrainian football
       league. A circle broken by a bar for ONE, whose whole identity is the
       word; a shield for the PFL, whose logo is one. */
    'one-championship': '<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.7"/>'
      + '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 7.4v9.2"/>',
    'pfl': '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M12 2.6l7.4 2.6v6.2c0 4.2-3 7.6-7.4 9.4-4.4-1.8-7.4-5.2-7.4-9.4V5.2z"/>'
      + '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M9.3 9.2h5.4M9.3 12.4h3.6"/>',
    exchanges: '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 8.4h13.2l-3.4-3.4M20 15.6H6.8l3.4 3.4"/>',
    gifts: '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M3.4 10.6h17.2v3H3.4zM4.8 13.6h14.4v7H4.8zM12 10.6v10"/><path fill="none" stroke="currentColor" stroke-width="1.7" d="M12 10.6S10.9 6.4 8.7 6.4a2.1 2.1 0 0 0 0 4.2zM12 10.6s1.1-4.2 3.3-4.2a2.1 2.1 0 0 1 0 4.2z"/>',
    /* The ten newest boards. Same rule as the leagues and the coins: a crest,
       a team badge, a record label's mark and a city's coat of arms are all
       registered artwork, so each board gets a drawn object instead -- a
       shield, a ball, a flag, a microphone. They read at 15px, which is the
       size a filter chip gives them, and belong to nobody. */
    'football-clubs': '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M12 2.8 4.6 5.4v7.1c0 4.2 3 7 7.4 8.7 4.4-1.7 7.4-4.5 7.4-8.7V5.4z"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M12 8.4v6M9 11.4h6"/>',
    'football-players': '<circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" d="m12 7.4 3.5 2.5-1.3 4.1H9.8L8.5 9.9zM12 2.9v4.5M4 9.6l4.5.3M20 9.6l-4.5.3M7.2 19.6l2.6-5.6M16.8 19.6l-2.6-5.6"/>',
    'f1-drivers': '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M5 3.6v17"/><path fill="currentColor" d="M6.6 4.2h4.6v3.4H6.6zM11.2 7.6h4.6V11h-4.6zM15.8 4.2h4.6v3.4h-4.6zM6.6 11h4.6v3.4H6.6zM11.2 14.4h4.6v3.4h-4.6zM15.8 11h4.6v3.4h-4.6z"/>',
    artists: '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M12 3.2a2.9 2.9 0 0 1 2.9 2.9v5.4a2.9 2.9 0 0 1-5.8 0V6.1A2.9 2.9 0 0 1 12 3.2zM6.4 11.2a5.6 5.6 0 0 0 11.2 0M12 16.8v4M9.2 20.8h5.6"/>',
    games: '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M8.2 7.4h7.6a5 5 0 0 1 4.9 4l.9 4.6a2.6 2.6 0 0 1-4.7 2l-1.5-2.2H8.6L7.1 18a2.6 2.6 0 0 1-4.7-2l.9-4.6a5 5 0 0 1 4.9-4z"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M7.2 11v2.6M5.9 12.3h2.6"/><circle cx="16.2" cy="11.6" r="1.1" fill="currentColor"/><circle cx="18.1" cy="13.6" r="1.1" fill="currentColor"/>',
    cities: '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M3.2 20.8V9.6l5-2.6v13.8M8.2 20.8V4.2l6.4 2.8v13.8M14.6 20.8v-8l6.2 2v6z"/><path fill="currentColor" d="M5.3 11.8h1.5v1.5H5.3zM5.3 15.2h1.5v1.5H5.3zM10.4 8.4h1.5v1.6h-1.5zM10.4 12.2h1.5v1.6h-1.5zM10.4 16h1.5v1.6h-1.5z"/>',
    pets: '<ellipse cx="12" cy="16.4" rx="4.1" ry="3.4" fill="currentColor"/><ellipse cx="6.2" cy="11.4" rx="2.2" ry="2.7" fill="currentColor"/><ellipse cx="17.8" cy="11.4" rx="2.2" ry="2.7" fill="currentColor"/><ellipse cx="9.4" cy="6.8" rx="2.1" ry="2.6" fill="currentColor"/><ellipse cx="14.6" cy="6.8" rx="2.1" ry="2.6" fill="currentColor"/>',
    startups: '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M12 2.6c3 2.3 4.7 5.7 4.7 9.4l-1.4 4.4H8.7l-1.4-4.4c0-3.7 1.7-7.1 4.7-9.4z"/><circle cx="12" cy="10" r="2.1" fill="none" stroke="currentColor" stroke-width="1.5"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M8.7 16.4 6.2 19l2.8.5.6 2.1 2-3.2M15.3 16.4 17.8 19l-2.8.5-.6 2.1-2-3.2"/>',
    restaurants: '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M6.6 2.8v6.6a2.4 2.4 0 0 0 4.8 0V2.8M9 2.8v6M17.4 2.8c-1.6 1.4-2.4 3.4-2.4 5.6 0 1.7.8 2.6 2.4 2.8M6.6 12.2v9M17.4 11.2v10"/>',
    /* The influencer boards borrow their platform's own mark: that is the
       thing being pointed at, and a second drawing of it would only be a
       worse one. */
    'x-influencers': '',
    'instagram-influencers': '',
    'tiktok-influencers': '',
    'youtube-influencers': '',
    'facebook-influencers': '',
    podcasts: '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M4.4 15.2v-3a7.6 7.6 0 0 1 15.2 0v3"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M4.4 13.6h1.8a1.4 1.4 0 0 1 1.4 1.4v3.4a1.4 1.4 0 0 1-1.4 1.4H4.4a1.4 1.4 0 0 1-1.4-1.4V15a1.4 1.4 0 0 1 1.4-1.4zM19.6 13.6h-1.8a1.4 1.4 0 0 0-1.4 1.4v3.4a1.4 1.4 0 0 0 1.4 1.4h1.8a1.4 1.4 0 0 0 1.4-1.4V15a1.4 1.4 0 0 0-1.4-1.4z"/>'
  };

  /* Filled in after the fact: an object literal cannot refer to itself while
     it is still being written, and these four are the platform's own mark. */
  for (const [copie, sursa] of [
    ['x-influencers', 'x'], ['instagram-influencers', 'instagram'],
    ['tiktok-influencers', 'tiktok'],
    ['youtube-influencers', 'youtube'], ['facebook-influencers', 'facebook']
  ]) ICONS[copie] = ICONS[sursa];

  /* The marks that are not one colour. Drawn full-size on the tiles and tabs
     because "official logo" means the real thing, not a tinted silhouette.
     TikTok is three offset copies of the note; Instagram is its gradient. */
  /* The one board mark that is a real logo rather than a drawing, and the
     reason it can be is the same reason fifteen club crests can: it is public
     domain on Commons, tagged PD-textlogo. It is also nearly three times as
     wide as it is tall, which every other mark here is not -- see WIDE. */
  const ICONS_FULL = {
    /* Bellator's wordmark, public domain on Commons and five times wider than
       it is tall. Its own file carries no fill at all, so the letters take the
       board's colour rather than the black they are drawn in -- which is what
       keeps them visible on the dark theme, where black is nothing. */
    'bellator': '<path fill="currentColor" d="M94.4,24.4c27.9-16,59.9-24.5,92-24.4c30.3-0.2,60.5,7.4,87.2,21.5c-8.8,17-17.7,34-26.8,50.8 c-24.2-12.9-52.6-17.7-79.6-13.5c-28,4.2-54.4,18-73.9,38.5c-22.8,23.6-36.1,56.3-35.8,89.1c-0.2,26.3,8.3,52.3,23.1,73.9 c-15.7,10.9-31.4,21.9-47.1,32.7C14.9,266.5,3.3,235,0.7,202.6c-3.2-36.6,4.7-74,22.6-106.1C39.8,66.6,64.7,41.3,94.4,24.4z"/><path fill="currentColor" d="M1144.5,130.9c19.9,0,39.8,0,59.7,0c7.2,21.3,14.3,42.5,21.4,63.8c1.3-0.6,1.4-2.1,1.9-3.2 c7.1-20.2,14.5-40.3,21.6-60.5c19.4-0.1,38.7,0,58.1,0c-4.4,8.2-3.6,17.7-3.7,26.7c0,21,0,42,0,63c0,8.1-0.3,16.6,3.7,24 c-16.9,0.2-33.8,0.2-50.6,0c3.9-7.7,3.6-16.6,3.5-25c-0.1-21.5,0.1-42.9-0.1-64.4c-10.7,29.7-21,59.6-31.5,89.4 c-10,0.1-20.1,0.2-30.2,0c-10.2-29.8-20.2-59.6-30.5-89.3c-0.3,29.8-0.1,59.5-0.1,89.3c-6.3,0.2-12.7,0.1-19,0c0-31,0-62,0-92.9 C1148.9,144.5,1149.2,136.7,1144.5,130.9z"/><path fill="currentColor" d="M1318.5,130.9c19.9,0,39.8,0,59.7,0c7.3,21.4,14.5,42.9,21.6,64.4c3.3-7.4,5.6-15.3,8.5-22.9 c4.9-13.8,9.9-27.6,14.8-41.4c19.4-0.1,38.8,0,58.1,0c-4.3,7.8-3.7,17-3.7,25.6c0,23.3,0,46.7,0,70c0,6.1,0.7,12.5,3.7,17.9 c-16.9,0.1-33.8,0.2-50.6,0c4.1-8,3.5-17.2,3.6-25.9c-0.1-21.1,0.1-42.3-0.1-63.4c-10.8,29.7-21,59.6-31.5,89.4 c-10.1,0.1-20.1,0.2-30.2,0c-10.2-29.7-20.1-59.5-30.5-89.2c-0.3,29.7-0.1,59.4-0.1,89.2c-6.3,0.2-12.7,0.1-19,0 c0-32.6,0-65.3,0-97.9C1322.8,141.1,1322,135.3,1318.5,130.9z"/><path fill="currentColor" d="M1533.2,130.9c17,0,34,0,51,0c12.6,30.4,25.1,60.9,37.7,91.3c3,8.1,6.9,15.9,12.6,22.4c-19,0-38,0.1-57-0.1 c3-4.4,3.1-10.1,1.2-15c-2.1-5.2-4.3-10.3-6.6-15.4c-16.6,0.1-33.3-0.2-49.9,0.2c-2.4,5.6-5.4,10.9-7.9,16.5 c-2,4.5-1.5,9.9,1.4,13.9c-10.8,0-21.5,0-32.3,0c4.2-5.5,8.4-11.1,11.4-17.4c14.3-29.9,28.6-59.9,42.9-89.8 C1536.2,135.3,1534.5,133.2,1533.2,130.9 M1545.1,165.2c-4.5,10-9.1,19.9-13.6,29.9c11,0,22,0,33,0c-4.7-12.8-10.5-25.1-15.6-37.7 C1547.2,159.7,1546.3,162.5,1545.1,165.2z"/><path fill="currentColor" d="M96.1,101.1c20.9-22.2,50.1-36.4,80.5-38.7c23.5-2,47.4,3.1,68.4,13.9c-3.3,6-6.4,12.1-9.6,18.1 c-22.4-11.9-49.2-15.2-73.8-9c-26.6,6.5-50.3,24.2-64.3,47.7c-10.9,18-16,39.4-14.6,60.4c1.2,18.8,7.7,37.2,18.5,52.5 c-5.8,4.1-11.6,8.2-17.4,12.1c0-0.4-0.1-1.2-0.1-1.6c-16.7-24-24.1-54.2-20.9-83.2C65.5,146.5,77.5,120.7,96.1,101.1z"/><path fill="currentColor" d="M249.1,91.6c1.3-2,2.6-4,4-6c11.3,7.5,21.3,16.8,29.5,27.6c-1.9,1.4-3.8,2.9-5.7,4.4C269.1,107.5,259.7,98.7,249.1,91.6z"/><path fill="currentColor" d="M1609.5,124.2c5.1,0,10.2,0,15.3,0c0,0.9,0,2.6,0,3.4c-1.8,0-3.6,0-5.4,0c0,3.8,0,7.7,0,11.5c-1.5,0-3,0-4.4,0 c0-3.8,0-7.7,0-11.5c-1.8,0-3.7,0-5.5,0C1609.5,126.8,1609.5,125,1609.5,124.2z"/><path fill="currentColor" d="M1627.4,124.2c2,0,4,0,6,0.1c1.3,3.1,2.8,6.2,4.2,9.2c1.4-3.1,2.8-6.3,4.3-9.4c1.9,0,3.8,0.1,5.7,0.1c0,5,0,9.9,0,14.9 c-1.5,0-2.9,0-4.3,0c0-3.2,0-6.5-0.1-9.7c-1.4,3.3-3,6.5-4.5,9.8c-0.7,0-2-0.1-2.6-0.1c-1.8-3.1-3.2-6.3-4.4-9.6 c-0.4,3.2-0.4,6.5-0.3,9.7c-1.3,0-2.7,0-3.9,0C1627.4,134.2,1627.5,129.2,1627.4,124.2z"/><path fill="currentColor" d="M131.2,130.9c31.1,0.1,62.1,0,93.2,0c8.5,0.1,18.1,0.9,24.3,7.4c5.5,6,4.9,14.7,4.9,22.2c-0.1,6.4,0.9,14-4.1,19 c-5.5,5.1-13.4,4.8-20.2,6.1c6.5,1.2,13.5,1.4,19.3,4.8c3.5,2,5,6.3,5,10.1c0.1,7.3,0.1,14.6,0,21.9c-0.1,6-1.8,12.6-6.7,16.4 c-6.3,4.9-14.7,5.5-22.4,5.7c-31.1,0-62.3,0-93.4,0c2.6-5.3,3.5-11.2,3.5-17c0-22.8,0-45.6,0-68.4c14.5-0.1,29,0,43.4,0 c0,5.8,0,11.5,0,17.3c8.8,0,17.6,0,26.4,0c2.2,0.1,5.1-0.6,5.5-3.1c0.6-4.5,0.1-9.1,0.3-13.6c-0.1-2.4,0.3-4.9-0.5-7.2 c-0.9-2.5-4-2.5-6.3-2.6c-22.9,0-45.9,0-68.8,0C134.7,143.3,133.9,136.8,131.2,130.9 M178,195.2c0,10.1,0,20.3,0,30.4 c9.2-0.1,18.3,0.1,27.5-0.1c2.4,0.1,4.6-1.6,4.6-4.1c0.3-6.3,0-12.6,0.1-18.9c-0.1-2.1,0.2-4.7-1.5-6.3c-1.5-1.1-3.5-1-5.2-1.1 C195,195.2,186.5,195.2,178,195.2z"/><path fill="currentColor" d="M265.8,130.9c32.8,0,65.5,0,98.3,0c1.2,7.3,2.4,14.6,3.5,21.9c-6.2-2-12.7-3.1-19.3-3c-26.4,0-52.7,0-79.1,0 C269.2,143.4,268.6,136.8,265.8,130.9z"/><path fill="currentColor" d="M379.3,130.9c16.8,0,33.6,0,50.4,0c-3,5.7-3.6,12.3-3.6,18.6c0,25.4,0,50.7,0,76.1c12.1,0,24.2,0,36.3,0 c6.3-0.1,12.8-0.8,18.6-3.6c-1.3,7.5-2.5,15-3.7,22.5c-32.7,0-65.3,0-98,0c2.9-5.9,3.6-12.6,3.6-19.1c0-25.3,0-50.6,0-75.9 C382.8,143.2,382,136.7,379.3,130.9z"/><path fill="currentColor" d="M487.6,130.8c16.8,0,33.6,0,50.4,0c-3,6.1-3.6,13-3.5,19.7c0,25,0,50.1,0,75.1c12,0,24,0,36,0c6.4-0.1,13.1-0.7,18.9-3.7 c-1.3,7.5-2.5,15.1-3.8,22.6c-32.7,0-65.3,0-98,0c2.7-5.6,3.5-11.8,3.5-17.9c0-25,0-50,0-75.1C491.2,144.5,490.8,137.2,487.6,130.8 z"/><path fill="currentColor" d="M639.9,130.9c17.1,0,34.2,0,51.3,0c13.5,32.6,26.9,65.2,40.4,97.7c2.4,5.8,5.9,11.2,10.1,16c-19,0-38,0-57.1,0 c2.7-4.2,3.1-9.3,1.6-13.9c-2-5.6-4.7-11-6.8-16.5c-16.6-0.1-33.2,0-49.8,0c-2.6,5.2-5.1,10.4-7.7,15.6c-2.3,4.7-2.2,10.6,0.9,14.9 c-10.8,0-21.5,0-32.3,0c9.6-11,14.8-24.8,21.2-37.8c11-23.1,22.1-46.3,33.1-69.4C643.1,135.2,641.4,133.1,639.9,130.9 M653,162.9 c-4.9,10.7-9.7,21.4-14.6,32.2c11.1-0.1,22.3,0.2,33.4-0.1c-5.5-12.5-10.7-25.1-16-37.7C654.5,159,653.8,161,653,162.9z"/><path fill="currentColor" d="M722.8,130.9c31.9,0,63.8,0,95.7,0c4.1,0.2,8.3-0.4,12.3,0.3c1.3,7.7,2.3,15.5,3.6,23.3c-4-2.5-8.4-4.4-13.1-4.5 c-7.6-0.2-15.2,0-22.8-0.1c0,24.6,0,49.2,0,73.7c0,7.1,0.3,14.5,3.6,21c-16.8,0-33.6,0-50.4,0c2.9-5.9,3.5-12.6,3.5-19.1 c0-25.2,0-50.4,0-75.6c-7.8,0.1-15.6-0.2-23.4,0.1c-4.5,0.2-8.7,2.1-12.5,4.4C720.4,146.5,721.6,138.7,722.8,130.9z"/><path fill="currentColor" d="M854.9,134.9c5.5-3.4,12.2-4.1,18.5-4.1c21.3,0,42.7-0.1,64.1,0c7.5,0,15.7,1.8,20.9,7.6c5.8,6.5,7.1,15.6,7.3,24 c0,17,0,34,0,51c-0.3,8.3-1.7,17.3-7.5,23.7c-5.2,5.6-13.2,7.3-20.6,7.4c-22,0-44,0-66.1,0c-8.3,0-17.5-2.3-22.4-9.5 c-6.4-9.2-5.9-20.9-5.8-31.5c0.2-14.8-0.4-29.7,0.3-44.5c14.4,0.2,28.8-0.1,43.1,0.2c-0.1,20.1-0.1,40.3,0,60.4 c-0.1,3.2,2.6,5.8,5.7,5.9c6.3,0.4,12.7,0,19.1,0.2c2.9-0.1,6,0.3,8.5-1.4c2.1-1.5,2.3-4.3,2.3-6.6c0-19.7,0-39.3,0-59 c-0.1-2.2,0.1-4.8-1.5-6.6c-1.8-2.1-4.8-2.2-7.4-2.2c-22.9,0-45.8,0-68.7,0C846.4,143.9,849.6,138.1,854.9,134.9z"/><path fill="currentColor" d="M972.8,130.9c32.2,0.1,64.4,0,96.6,0.1c8.1,0.3,17.6,1.8,22.4,9.2c5.2,8.1,3.4,18.2,3.8,27.4c-0.3,7.2,1.1,15-2.6,21.6 c-3,5-9.4,5.8-14.6,6c4.5,10.2,9.7,20.2,14.5,30.3c3.3,6.4,5.6,13.4,10.2,19.1c-16.2,0-32.3,0-48.5,0 c-6.9-16.3-13.6-32.8-20.6-49.1c-4.3-0.7-8.8,0-13.2-0.3c-0.1,10.5,0,20.9,0,31.4c0,6.1,0.8,12.4,3.5,18c-16.8,0-33.6,0-50.5,0 c4.5-9,3.4-19.3,3.5-29c0.1-18.9-0.2-37.7,0.1-56.6c14.4,0.2,28.8,0,43.3,0.1c0,5.8,0,11.5,0,17.3c8.9,0,17.8,0.1,26.7-0.1 c2.2,0.1,4.5-1.3,4.6-3.7c0.3-6.3,0.3-12.6,0-18.9c-0.1-2.9-3.2-3.9-5.6-3.8c-23-0.1-46,0-69.1,0 C977.4,143.3,976.8,136.4,972.8,130.9z"/><path fill="currentColor" d="M269.2,159.1c14.5-0.1,28.9-0.1,43.4-0.1c0,5.7,0,11.5,0,17.2c11,0,21.9,0,32.9,0c6,0,11.9-1.2,17.5-3 c-0.1,8.3,0,16.6,0,24.9c-5.7-1.9-11.6-2.9-17.6-3c-11-0.1-21.9,0-32.9,0c0,10.1,0,20.3,0,30.4c12.9,0,25.9,0,38.8,0 c6.2,0,12.4-1,18.3-3c-1.3,7.3-2.6,14.7-4,22c-33.4-0.1-66.7,0-100.1,0c3.1-6.2,3.6-13.2,3.6-20 C269.2,202.8,269.3,180.9,269.2,159.1z"/><path fill="currentColor" d="M95.7,266.1c1.8-1.6,3.6-3.2,5.5-4.8c17.8,20.4,43,34.2,69.8,37.9c26,3.7,53.2-2,75.5-15.9c9.3-5.7,17.6-12.8,25-20.9 c1.8,1.6,3.5,3.2,5.3,4.8c-19.1,21.4-45.9,35.7-74.3,39.3c-24.8,3.3-50.7-1.4-72.7-13.3C116.8,286.4,105.3,277.1,95.7,266.1z"/>',
    'ufc-fighters': '<path fill="#d20a0a" d=" M 135.91 0.00 L 334.60 0.00 C 295.13 141.90 255.88 283.86 216.45 425.78 C 214.77 430.82 214.72 436.66 217.82 441.19 C 222.83 448.79 232.35 451.80 241.04 452.28 C 251.36 452.55 261.68 452.32 272.01 452.40 C 283.21 452.34 294.84 452.76 305.48 448.69 C 312.84 445.81 317.37 438.55 319.34 431.19 C 359.30 287.47 399.08 143.70 439.10 0.00 L 636.62 0.00 C 594.62 151.00 552.77 302.04 510.82 453.06 C 506.30 469.09 502.04 485.20 497.34 501.18 C 491.29 520.62 481.30 539.53 465.42 552.70 C 453.68 562.69 438.98 568.35 424.16 571.96 C 403.20 577.19 381.56 578.58 360.08 580.00 L 104.20 580.00 C 78.95 578.42 53.09 572.63 32.04 557.98 C 18.23 548.61 7.12 534.81 2.60 518.59 C 0.37 511.62 0.81 504.21 0.85 497.00 C 0.89 488.41 3.84 480.25 6.00 472.04 C 49.63 314.70 93.30 157.36 136.91 0.01 L 135.91 0.00 Z"/><path fill="#d20a0a" d=" M 730.61 0.00 L 1157.59 0.00 C 1145.73 42.45 1134.02 84.95 1122.21 127.42 C 979.87 127.45 837.54 127.44 695.20 127.43 C 706.99 84.95 718.71 42.45 730.61 0.00 Z"/><path fill="#d20a0a" d=" M 1350.38 0.00 L 1674.29 0.00 C 1669.62 19.27 1663.78 38.27 1658.65 57.43 C 1652.17 80.76 1645.69 104.09 1639.22 127.42 C 1569.14 127.44 1499.05 127.42 1428.97 127.43 C 1418.71 127.52 1408.04 127.43 1398.39 131.40 C 1390.53 134.72 1386.44 142.95 1384.45 150.80 C 1358.88 243.01 1333.28 335.23 1307.73 427.45 C 1305.87 433.18 1307.46 439.73 1311.73 443.97 C 1318.00 450.38 1327.37 452.39 1336.04 452.39 C 1412.37 452.41 1488.70 452.39 1565.03 452.41 C 1553.25 494.94 1541.44 537.47 1529.64 580.00 L 1205.22 580.00 C 1180.92 578.46 1156.12 573.09 1135.49 559.60 C 1121.95 550.94 1110.56 538.36 1105.11 523.09 C 1100.11 509.98 1100.53 495.37 1104.31 482.01 C 1140.98 349.87 1177.66 217.73 1214.35 85.59 C 1219.67 66.15 1228.16 46.98 1242.50 32.47 C 1251.97 22.76 1263.99 15.80 1276.82 11.56 C 1300.50 3.58 1325.61 1.64 1350.38 0.00 Z"/><path fill="#d20a0a" d=" M 670.69 215.39 C 813.05 215.37 955.41 215.38 1097.77 215.39 C 1085.96 257.97 1074.14 300.54 1062.32 343.11 C 985.82 343.14 909.33 343.11 832.83 343.13 C 810.91 422.08 789.04 501.04 767.12 579.99 L 768.47 580.00 L 569.52 580.00 C 603.31 458.48 636.96 336.93 670.69 215.39 Z"/>',
    tiktok:
      '<path fill="#25f4ee" d="M15.6 5.8a4.8 4.8 0 0 1-1.1-1.2A4.6 4.6 0 0 1 13.7 2h-3.3v13.1a2.7 2.7 0 1 1-1.9-2.6V9.2a6 6 0 1 0 5.2 5.9V8.8A7.5 7.5 0 0 0 18 10.2V6.9a4.4 4.4 0 0 1-2.4-1.1"/>' +
      '<path fill="#fe2c55" d="M17.6 6.8a4.8 4.8 0 0 1-1.1-1.2A4.6 4.6 0 0 1 15.7 3h-3.3v13.1a2.7 2.7 0 1 1-1.9-2.6v-3.3a6 6 0 1 0 5.2 5.9V9.8A7.5 7.5 0 0 0 20 11.2V7.9a4.4 4.4 0 0 1-2.4-1.1"/>' +
      '<path fill="var(--mark-ink,#fff)" d="M16.6 5.8a4.8 4.8 0 0 1-1.1-1.2A4.6 4.6 0 0 1 14.7 2h-3.3v13.1a2.7 2.7 0 1 1-1.9-2.6V9.2a6 6 0 1 0 5.2 5.9V8.8A7.5 7.5 0 0 0 19 10.2V6.9a4.4 4.4 0 0 1-2.4-1.1"/>',
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
    /* These two are one-colour marks and the colour is the page's, not
       theirs: X is black on white and white on black, and so is Threads.
       Hard-coded #fff was correct while the site only had a dark theme and
       invisible the moment it got a light one. */
    x:
      '<path fill="var(--mark-ink,#fff)" d="M18.9 2H22l-7 8.1L23.3 22h-6.5l-5-6.6-5.8 6.6H2.9l7.5-8.6L2 2h6.6l4.6 6.1zm-1.1 18h1.8L8.3 3.9H6.4z"/>',
    /* The three consoles in their own colours. The shapes were already the
       real marks — what they were missing is the colour, which is half of
       what makes a mark recognisable at 26px in a grid of thirty-four. */
    playstation:
      '<path fill="#0070d1" d="M9.5 3.4v15.9l3.6 1.1V7.6c0-.6.3-1 .8-.8.6.2.7.7.7 1.3v4.7c2.2 1.1 4 0 4-2.9 0-3-1-4.3-4-5.3-1.2-.4-3.4-1-5.1-1.2m4.8 14.4 5.8-2.1c.7-.2.8-.6.2-.8s-1.6-.2-2.3 0l-3.7 1.3v-2.1l.2-.1s.7-.2 1.6-.3c1-.1 2.1 0 3 .1 1 .1 1.4.3 1.9.5.4.2.5.6-.1 1-.6.4-6.6 2.6-6.6 2.6zM4.3 17.6c-1-.3-1.2-.9-.7-1.3.4-.3 1.1-.5 1.1-.5l4.4-1.6v1.8l-3.2 1.1c-.6.2-.7.5-.2.7.5.1 1.3.1 1.9-.1l1.5-.5v1.6c-1.6.3-3.3.2-4.8-.2z"/>',
    xbox:
      '<path fill="#107c10" d="M6.3 3.7a10 10 0 0 1 11.4 0c.4.3.2.5-.1.4-1.6-.6-4.1.6-5.6 1.8-1.5-1.2-4-2.4-5.6-1.8-.3.1-.5-.1-.1-.4M12 8.6c2.7 2.6 6.6 7.3 6 9.7A10 10 0 0 1 12 22a10 10 0 0 1-6-3.7c-.6-2.4 3.3-7.1 6-9.7M4.4 5.6c.5-.1 2 .5 4 2.7C5.8 11 3 15 3.4 17A10 10 0 0 1 4.4 5.6m15.2 0A10 10 0 0 1 20.6 17c.4-2-2.4-6-5-8.7 2-2.2 3.5-2.8 4-2.7"/>',
    nintendo:
      '<path fill="#e60012" d="M4.5 2h4.3v20H4.5A2.5 2.5 0 0 1 2 19.5v-15A2.5 2.5 0 0 1 4.5 2m2.1 3.3a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2M15.2 2h4.3A2.5 2.5 0 0 1 22 4.5v15a2.5 2.5 0 0 1-2.5 2.5h-4.3zm2.2 12.1a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4"/>',
    threads:
      '<path fill="var(--mark-ink,#fff)" d="M16.7 11.1h-.2c-.2-3-1.8-4.8-4.6-4.8a4.6 4.6 0 0 0-3.9 2l1.5 1a2.8 2.8 0 0 1 2.4-1.2c.8 0 1.5.3 1.9.7.3.4.5.9.6 1.5a12 12 0 0 0-2.1-.2c-2.7 0-4.4 1.6-4.3 3.7a3.2 3.2 0 0 0 1.3 2.4 3.8 3.8 0 0 0 2.5.7 3.6 3.6 0 0 0 2.8-1.4 4.5 4.5 0 0 0 .8-2c.7.4 1.2 1 1.5 1.7.3 1 .4 2.7-1 4.2-1.2 1.2-2.8 1.7-5 1.7-2.5 0-4.4-.8-5.6-2.4A8.7 8.7 0 0 1 3.5 12c0-2.7.6-4.8 1.7-6.2 1.3-1.6 3-2.4 5.5-2.4s4.5.8 5.7 2.5a7 7 0 0 1 1.2 2.5l1.8-.5a8.9 8.9 0 0 0-1.5-3.2C16.3 2.6 13.9 1.5 10.7 1.5 7.6 1.5 5.2 2.6 3.6 4.8 2.2 6.7 1.5 9.2 1.5 12s.7 5.2 2.1 7.1c1.7 2.2 4.1 3.3 7.1 3.3 2.8 0 4.7-.7 6.3-2.3 2.2-2.2 2.1-4.9 1.4-6.5a5.3 5.3 0 0 0-1.7-2.5m-4.8 4.1a1.9 1.9 0 0 1-1.3-.4 1.3 1.3 0 0 1-.5-1.1c0-.8.6-1.7 2.5-1.7a10 10 0 0 1 2 .2c-.2 2.3-1.4 3-2.7 3"/>'
  };

  /* And the same four in the full-colour set, so an influencer chip carries
     the platform's real mark exactly like the platform's own chip does. */
  for (const [copie, sursa] of [
    ['x-influencers', 'x'], ['instagram-influencers', 'instagram'],
    ['tiktok-influencers', 'tiktok'],
    ['youtube-influencers', 'youtube'], ['facebook-influencers', 'facebook']
  ]) if (ICONS_FULL[sursa]) ICONS_FULL[copie] = ICONS_FULL[sursa];

  const $ = sel => document.querySelector(sel);
  const view = $('#view');
  const modal = $('#modal');
  const panel = $('#modal-panel');
  const sticky = $('#sticky');

  /* ------------------------------------------------------------- helpers */

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Instagram is the only mark that needs a paint server instead of a flat
     colour, and it used to point at one gradient defined once at the top of the
     page. That made it the only mark that can fail to draw while its own name
     still shows underneath -- which is exactly how it failed. Every icon now
     carries its gradient inside itself, under an id of its own, so several can
     stand on the same page and none depends on anything outside its own svg. */
  let igSeq = 0;
  const IG_STOPS =
    '<stop offset="0" stop-color="#ffd521"/>' +
    '<stop offset=".26" stop-color="#f50000"/>' +
    '<stop offset=".62" stop-color="#b900b4"/>' +
    '<stop offset="1" stop-color="#4400c8"/>';

  /**
   * `full` draws the platform's real colours — three-tone TikTok, the
   * Instagram gradient — where there is room for them. Everywhere else the
   * mark inherits currentColor so it can be tinted or dimmed.
   */
  /* Marks that are not square. Every drawn one is 24 by 24; a logo is whatever
     shape it is, and squeezing the UFC wordmark into a square would letter it
     into a smear. The viewBox comes from the file, the height stays 1em, and
     the width follows -- which is what an svg with a viewBox does on its own
     once the stylesheet stops insisting on a square. */
  const WIDE = { 'ufc-fighters': '0 0 1675 580', 'bellator': '0 0 1647.7 307.6' };

  const icon = (slug, full) => {
    let body = (full && ICONS_FULL[slug]) || ICONS[slug] || '';
    let defs = '';

    if (body.includes('url(#tt-ig)')) {
      const gid = `ig${++igSeq}`;
      defs = `<defs><linearGradient id="${gid}" x1="0" y1="1" x2="1" y2="0">${IG_STOPS}</linearGradient></defs>`;
      body = body.replace('url(#tt-ig)', `url(#${gid})`);
    }

    const lat = full && ICONS_FULL[slug] && WIDE[slug];
    return `<svg viewBox="${lat || '0 0 24 24'}"${lat ? ' class="mark--wide"' : ''}
                 aria-hidden="true">${defs}${body}</svg>`;
  };

  /**
   * `maxlength` stops the typing but says nothing about it, so a sentence that
   * runs long is cut off and submitted without the writer ever noticing. The
   * first listing somebody else made ended mid-word: "...naturală, ia". Count
   * the remaining room out loud so the sentence gets finished instead.
   * Returns the updater so callers that already listen for `input` can reuse it.
   */
  function countTagline(input, hint) {
    const update = () => {
      const left = TAG_MAX - input.value.length;
      hint.textContent = left === 0
        ? 'Full — anything more will not fit.'
        : `${left} character${left === 1 ? '' : 's'} left`;
      hint.classList.toggle('hint--bad', left === 0);
    };
    input.addEventListener('input', update);
    update();
    return update;
  }

  function money(cents) {
    const n = Number(cents || 0) / 100;
    return '$' + n.toLocaleString('en-US', {
      minimumFractionDigits: n % 1 ? 2 : 0,
      maximumFractionDigits: 2
    });
  }

  /** Smallest whole-dollar amount strictly greater than `cents`. */
  const nextDollarAbove = cents => Math.floor(Number(cents || 0) / 100) * 100 + 100;

  /* What it costs to pass a listing, and whether one payment can do it.
     Stripe caps a single payment; totals are cumulative and do not care. Past
     that ceiling the price is still the price — it just takes two goes, and
     saying so beats a button that dies at checkout. */
  const toBeat = cents => {
    const need = clampMin(nextDollarAbove(cents));
    return { need, oneGo: need <= MAX_CENTS };
  };

  const clampMin = cents => Math.max(MIN_CENTS, Math.round(cents));

  /* A stable address, deliberately, and it was not always.

     A week number used to hang off the end so a changed profile picture would
     appear within seven days instead of never. That was the right trade
     against a source that answers — and unavatar has stopped being one. It
     now returns 403 EPRO, "this provider requires a pro plan", for a good
     half of the handles on this board, and per handle rather than per
     network: one TikTok account resolves, the next does not.

     With the source refusing, the browser's cache is the only thing keeping
     those faces on the page at all, and a key that moves every Monday is a
     promise to throw them away. So the address is stable again. Put the key
     back the day the avatars are paid for. */
  /* The token rides on the URL, which is what unavatar's own onboarding
     shows and what a publishable key is for. Without one the site still
     works: anonymous requests answer for a good number of handles and the
     drawn badge stands in for the rest. */
  const unavatarToken = () => {
    const t = CFG.UNAVATAR_TOKEN;
    return t ? `&token=${encodeURIComponent(t)}` : '';
  };

  function avatarUrl(platform, handle) {
    const h = String(handle || '').replace(/^@/, '');
    return `https://unavatar.io/${encodeURIComponent(platform)}/${encodeURIComponent(h)}`
      + `?fallback=false${unavatarToken()}`;
  }

  const FALLBACK_AV = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><rect width="44" height="44" rx="22" fill="#8c98a4" fill-opacity=".22"/><circle cx="22" cy="17" r="7" fill="#8c98a4"/><path d="M8 42c2-8 7-12 14-12s12 4 14 12z" fill="#8c98a4"/></svg>');

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
  /* A friend code is an identity, not an address. Anything that is not an
     http(s) URL is rendered as text, never as a dead link. */
  const linkable = u => /^https?:\/\//i.test(String(u || ''));

  function parseProfile(raw, slug) {
    const p = BY_SLUG[slug];
    if (!p) return { ok: false, error: 'Pick a platform first.' };

    let input = String(raw || '').trim();
    if (!input) return { ok: false, error: '' };

    /* Consoles identify a player by tag, not by link. The tag is validated
       against the platform's own rule and then carried in `url`, because the
       unique key is (platform, url) and its job is one listing per identity
       -- a gamertag serves that exactly as well as an address does.

       Where the platform has a public profile the identity IS that URL, so
       the board can link it. Nintendo has none, so the identity is stored as
       slug:key, which is not a link and is never rendered as one. */
    if (p.tag) {
      const tag = input.replace(/\s+/g, ' ').trim();
      /* A league is a closed set. Thirty clubs, thirty-two clubs, and no
         thirty-first. Checked against the roster rather than against the
         name rule, which would throw out the Philadelphia 76ers over the
         digits and let "Lakers4Life" through -- exactly backwards.

         Stored in the roster's spelling, whatever was typed, so one club is
         one row on the board no matter who bids first. */
      const squad = CLOSED_LIST.has(slug) ? ROSTERS[slug] : null;
      if (squad) {
        const hit = squad.find(t => fold(teamName(t)) === fold(tag));
        if (!hit) {
          return { ok: false, error: `${p.name} takes the ${squad.length} clubs in the league. Start typing and pick one from the list.` };
        }
        return { ok: true, url: `${slug}:${fold(teamName(hit))}`, handle: teamName(hit) };
      }

      if (!p.tag.re.test(tag)) {
        // No article in front of the platform name: the template has to serve
        // "a PlayStation" and "an Xbox" from one string, and this dodges both.
        return { ok: false, error: `${p.name} ${p.tag.label} does not look right. ${p.tag.hint}.` };
      }
      /* The identity is the name folded down: lower case, accents off,
         punctuation out, spaces collapsed. Without that, "LeBron James",
         "lebron  james" and "LeBron  James" are three listings and the fans
         bidding for one man are split across three rows -- which is the one
         thing a top ten of real people must not do.

         The spelling the first person typed is what everybody sees; only the
         key underneath is folded. */
      const key = fold(tag);
      const url = p.tag.profile ? p.tag.profile(tag) : `${slug}:${key}`;
      return { ok: true, url, handle: tag };

    }
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
    boards: slugMap(PLATFORMS.map(p => [p.slug, []])),
    platform: 'x',
    visitors: null,
    online: null,
    loaded: false,
    prevRanks: {}
  };

  /* market() is the board view plus movement: what each listing took in the
     last 24 hours, what it took over seven days, and the seven daily figures
     behind that as an array. All three come from the same rolling 24h
     buckets, so the sparkline and the number beside it can never disagree.

     The view is still there and still correct; it just cannot carry a
     sparkline, and a market that shows only a standing total says nothing
     about which way anything is going. If the function is missing we fall
     back to it rather than showing an empty site: the movement columns go
     quiet, the ranking does not. */
  async function loadBoards() {
    if (!sb) return;

    let { data, error } = await sb.rpc('market');

    if (error) {
      console.warn('market() unavailable, falling back to the board view', error);
      ({ data, error } = await sb
        .from('board')
        .select('id,platform,handle,url,tagline,link,total_cents,last_paid_at')
        .limit(2000));
    }

    if (error) { console.error('board load failed', error); connectionError = 'query'; return; }

    const next = slugMap(PLATFORMS.map(p => [p.slug, []]));
    for (const row of data || []) {
      if (next[row.platform]) next[row.platform].push(row);
    }
    for (const slug of Object.keys(next)) {
      next[slug].sort((a, b) =>
        b.total_cents - a.total_cents ||
        new Date(a.last_paid_at) - new Date(b.last_paid_at));
      /* Rank is the row's place in the order just applied. The view computed
         the same number in SQL; doing it here means the fallback query and
         the function agree, and that a row's rank always matches the list it
         is actually sitting in. */
      next[slug].forEach((row, i) => { row.rank = i + 1; });
    }
    state.boards = next;
    state.loaded = true;

    /* The picture files are not fetched here.
    
       This runs once for the whole site, so asking "is there a coin anywhere"
       pulled the coin map, the photographs and all 537 members of Congress
       onto every page — 186 KB of it on /x/, which draws none of them. What
       a view needs is decided by the rows that view is about to draw, which
       is artFor, below. */
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

  /* The cheapest #1 on the whole site, and how many boards are still empty.
     This is the one number that answers the question everybody arrives with
     -- what would it take -- and it is real: an empty board's first place
     costs the minimum, and a board with somebody on it costs a dollar more
     than whoever is holding it. Nothing here is rounded up to sound better. */
  function cheapestTop() {
    let best = Infinity, goale = 0;
    for (const p of PLATFORMS) {
      const held = topCents(p.slug);
      if (!held) goale++;
      const cost = held ? clampMin(nextDollarAbove(held)) : MIN_CENTS;
      if (cost < best) best = cost;
    }
    return { cost: best === Infinity ? MIN_CENTS : best, goale };
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

  /* The thin line across the very top, the way a market states its own size
     before showing anything in it: label first, figure after, small. It was
     five big cards, and five big cards above a table push the table off the
     first screen -- which on a leaderboard is the whole product. */
  function renderStats() {
    const s = stats();
    const cell = (k, v, cls) =>
      `<span class="stat${cls ? ' ' + cls : ''}"><span class="stat__k">${k}</span><span class="stat__v">${v}</span></span>`;
    const c = cheapestTop();
    return `
    <div class="stats"><div class="shell stats__row">
      ${cell('Boards', PLATFORMS.length)}
      ${cell('Listings', s.count)}
      ${cell('Paid in', money(s.total))}
      ${cell('Holding #1', money(s.top))}
      ${cell('Cheapest #1', money(c.cost), 'stat--deal')}
      ${cell('Online', state.online === null ? '—' : state.online.toLocaleString(), 'stat--online')}
    </div></div>`;
  }


  /* Everyone on every board, running across the top in each platform's own
     colour. It sits above the name because the first thing worth knowing about
     a leaderboard is that there are people standing on it. */
  /* Everyone on every board, running across the top in each platform's own
     colour. It sits above the name because the first thing worth knowing about
     a leaderboard is that there are people standing on it.

     The strip is always in the markup and fills itself from fillTicker(), so a
     payment landing while someone is looking updates it in place instead of
     leaving the top of the page contradicting the board under it. */
  function renderTicker() {
    return `<div class="ticker" id="ticker" hidden aria-hidden="true"><div class="ticker__track"></div></div>`;
  }

  function fillTicker() {
    const el = document.getElementById('ticker');
    if (!el) return;

    /* Newest payment first, so the strip opens on whoever just paid.

       It ran in board order before, which meant it opened on X every time and
       said nothing about the last hour. The rank each row carries is still its
       rank on its own board -- that is worked out before this is sorted, so a
       row that is #4 on TikTok still says #4 wherever it appears in the
       strip. Only the order of the strip changed. */
    const items = PLATFORMS.flatMap(p =>
      board(p.slug).slice(0, 10).map((row, i) => ({ p, row, rank: i + 1 })))
      .sort((a, b) => new Date(b.row.last_paid_at) - new Date(a.row.last_paid_at));
    el.hidden = !items.length;
    if (!items.length) return;

    /* The face of whoever paid, not the mark of the board they paid on. The
       strip is a list of people and what they spent; the board is already
       said by the colour the badge underneath is drawn in, and a name with a
       face beside it is worth more on a moving strip than a logo repeated
       eleven times in a row.

       Same picture the table uses, same address, so the browser has it
       already by the time the row it belongs to is drawn. */
    const cell = ({ p, row, rank }) => `
      <span class="tick" style="${brandVars(p.color, '--tick')}">
        ${facePic(p.slug, row.handle, 'tick__pic', row, false, 120)}
        <span class="tick__h">${esc(row.handle)}</span>
        <span class="tick__r">#${rank}</span>
        <span class="tick__a">${money(row.total_cents)}</span>
      </span>`;

    /* Printed twice, and the track slides exactly half its own width: when the
       animation restarts, the second copy is sitting where the first was, so
       the loop has no seam to see.

       Drawn twice rather than one string used twice, because each Instagram
       mark mints a gradient id as it is built. Reusing the string would put the
       first copy's ids in the second one's markup. */
    const track = el.querySelector('.ticker__track');
    track.innerHTML = items.map(cell).join('') + items.map(cell).join('');

    /* How long the loop takes, worked out from how far it has to go.

       It was 45 seconds flat, which is a duration and not a speed: the track
       is every listing on the site twice over, so each listing added made the
       same 45 seconds cover more ground and the strip read faster. Five
       listings ambled. Fifteen went three times quicker for no reason anybody
       could see, and it would have kept accelerating.

       So: pixels per second, fixed. The half-track is what one loop travels.
       Forty-two was the first number and it read as stopped; seventy is a
       name crossing in three and a half seconds, which is quick enough to
       look alive and slow enough to read. Clamped at both ends so an
       almost-empty site does not flicker and a very full one still moves. */
    const VITEZA = 70;
    const drum = track.scrollWidth / 2;
    const secunde = Math.min(600, Math.max(30, Math.round(drum / VITEZA)));
    track.style.setProperty('--tick-dur', secunde + 's');
  }

  /* Two kinds of board, said out loud. Ten social networks and three consoles
     in one undivided strip read as thirteen of the same thing, and the split
     is the point: a gamer looking for the Xbox board should not have to scan
     past Telegram to find it.

     Membership is derived, not declared. A platform that asks for a tag is a
     console -- that is already true in PLATFORMS and cannot fall out of step
     with a second list saying the same thing. */
  const LEAGUES = new Set(['nba-teams', 'nba-players', 'nhl-teams', 'nhl-players']);

  /* Same job as LEAGUES: keep the crypto boards out of Gaming, which would
     otherwise take them for being tag boards that are not a league. */
  const CRYPTO_LIST = ['crypto', 'memecoins', 'gifts', 'exchanges'];
  const CRYPTO = new Set(CRYPTO_LIST);

  /* The rest of the groups, in the same shape and for the same reason: a
     board lands in Gaming by default, which is right for a console and
     wrong for everything else that happens to be a tag board. */
  const SPORT = new Set([...LEAGUES, 'football-clubs', 'football-players',
                         'f1-drivers', 'golf-players',
                         'ufc-fighters', 'mma-fighters', 'boxers',
                         'bellator', 'one-championship', 'pfl']);
  const CULTURE = new Set(['artists', 'podcasts', 'actors', 'movies']);
  /* Politics is grouped by country, not by subject, because that is the axis
     it grows along: the next addition is Romania or the UK with a parties
     board and a figures board of its own, not a thirty-first kind of American
     politics. One line per country here, and the strip lays itself out.
     
     Parties before figures inside each: a party is the argument somebody
     arrives holding, and the people are how it is fought. */
  const COUNTRIES = [
    { label: 'USA', boards: ['us-parties', 'us-politicians'] },
    { label: 'EU',  boards: ['eu-parties', 'eu-politicians'] }
  ];

  const POLITICS = new Set(COUNTRIES.flatMap(c => c.boards));
  /* The rich, by country. One heading, twenty flags, and a board behind
     each: a section that grows the same way the politics does, one country
     at a time, and lives beside it because it is the same kind of argument
     -- who matters most -- held over a different table. */
  const RICH = new Set([
    'us-billionaires',
    'uk-billionaires',
    'switzerland-billionaires',
    'uae-billionaires',
    'japan-billionaires',
    'australia-billionaires',
    'china-billionaires',
    'israel-billionaires',
    'india-billionaires',
    'germany-billionaires',
    'france-billionaires',
    'canada-billionaires',
    'italy-billionaires',
    'brazil-billionaires',
    'russia-billionaires',
    'saudi-arabia-billionaires',
    'singapore-billionaires',
    'south-korea-billionaires',
    'spain-billionaires',
    'mexico-billionaires'
  ]);
  const MACHINES = new Set(['cars', 'boats']);
  const TRADE = new Set(['startups', 'restaurants']);
  const LIFE = new Set(['cities', 'pets']);
  const STARS = new Set(['x-influencers', 'instagram-influencers', 'tiktok-influencers',
                         'youtube-influencers', 'facebook-influencers']);
  const NOT_GAMING = new Set([
    'movements',...SPORT, ...CRYPTO, ...CULTURE, ...TRADE, ...LIFE,
                              ...STARS, ...MACHINES, ...POLITICS, ...RICH]);
  // 'games' is culture by any reading, but it sits where people look for it.

  const GROUPS = [
    /* Politics first, by country. It is the loudest argument on the site and
       the one somebody arrives already holding a side in — and a board nobody
       has to scroll to find is a board that gets played. */
    ...COUNTRIES.map(c => ({
      label: c.label,
      rows: 1,
      has: p => c.boards.includes(p.slug)
    })),
    /* Its own line, under the countries and above everything else, because a
       movement is the same kind of argument as a party and belongs beside it,
       but under no flag. */
    { label: 'Movements',       rows: 1, has: p => p.slug === 'movements' },
    { label: 'Billionaires',    rows: 1, has: p => RICH.has(p.slug) },
    { label: 'Social networks', rows: 2, has: p => !p.tag },
    { label: 'Influencers',     rows: 1, has: p => STARS.has(p.slug) },
    { label: 'Gaming',          rows: 1, has: p => p.tag && !NOT_GAMING.has(p.slug) },
    { label: 'Sport',           rows: 1, has: p => SPORT.has(p.slug) },
    { label: 'Crypto',          rows: 1, has: p => CRYPTO.has(p.slug) },
    { label: 'Culture',         rows: 1, has: p => CULTURE.has(p.slug) },
    { label: 'Business',        rows: 1, has: p => TRADE.has(p.slug) },
    { label: 'Machines',        rows: 1, has: p => MACHINES.has(p.slug) },
    { label: 'Life',            rows: 1, has: p => LIFE.has(p.slug) }
  ];

  /* The boards in the order they are offered: social first, then gaming,
     sport and crypto. The grouping used to lay out a grid of tiles; what it
     does now is order one scrolling row of filter chips. */
  const TAB_ROWS = (() => {
    const rows = [];
    GROUPS.forEach(g => {
      const list = PLATFORMS.filter(g.has);
      if (!list.length) return;
      const cols = Math.ceil(list.length / g.rows);
      for (let i = 0; i < list.length; i += cols) {
        rows.push({ group: g.label, cols, items: list.slice(i, i + cols) });
      }
    });
    return rows;
  })();

  /* Two models, two sentences. On a social board you list yourself and the
     money buys your own place. On a player board the person ranked is not
     the person paying: fans bid to push someone up, which is a thing people
     already do and a much easier thing to ask for than self-promotion.

     The flag sits on the platform rather than the group because the boards
     coming next -- basketball, hockey, golf, actors -- work the same way
     without having a gamertag to give them away. */
  const isFan = slug => !!(BY_SLUG[slug] && BY_SLUG[slug].fan);

  /* A board of clubs is not a board of players, and asking somebody to bid
     for their favourite player on the NHL Teams board reads as a mistake --
     because it is one. */
  /* What the button calls the thing being bid for. A board can name its own
     -- "bid for your favourite city" -- and the rest fall back to the two
     the site started with. Getting this wrong is not cosmetic: asking
     somebody to bid for their favourite player on the Cities board reads as
     a mistake, because it is one. */
  const fanNoun = slug => {
    const p = BY_SLUG[slug];
    if (p && p.noun) return p.noun;
    if (CLOSED_LIST.has(slug)) return 'club';
    if (CRYPTO.has(slug)) return 'coin';
    return 'player';
  };

  /* "Who should be #1?" only where the answer is somebody else. On a board
     where you list yourself the question has one obvious answer and asking it
     is a way of not saying "take it"; on a fan board it is the whole
     proposition — thirty names and the money decides. */
  const ctaFor = slug => {
    /* The button that follows you down the page says the price, because
       "Claim my rank" asks somebody to imagine a number and "Be #1
       somewhere for $2" hands them one they can check on the row above. */
    if (!slug || !BY_SLUG[slug]) {
      return state.loaded ? `Be #1 somewhere for ${money(cheapestTop().cost)}` : 'Claim my rank';
    }
    const n = board(slug).length;
    const b = toBeat(topCents(slug));
    const top = money(b.need) + (b.oneGo ? '' : ' over two payments');
    if (isFan(slug)) {
      /* The price needs a verb after a question mark. "…on Actors? $41" reads
         as a number that fell off the end of a sentence. */
      return n ? `Who should be #1 on ${BY_SLUG[slug].name}? ${top} decides`
               : `Who should be #1 on ${BY_SLUG[slug].name}?`;
    }
    return n ? `Take #1 on ${BY_SLUG[slug].name} for ${top}` : 'Claim my rank';
  };

  /* ------------------------------------------------------- the market */

  /* The front page is the table. It used to be a grid of board tiles that
     opened a panel underneath, which meant choosing a room before being
     shown anything -- and the one thing a leaderboard has to do on first
     sight is show the leader. So: every listing on every board, most-paid
     first, and the boards become a filter across the top of it.

     A board chip is a real URL. /crypto/ is a page with its own title and
     canonical, not a tab state, so it can be linked, shared and crawled. */

  /* A round mark for a listing with no picture to fetch. unavatar can find a
     face for @handle on a social network; it can find nothing at all for
     "Bitcoin", and a silhouette of a person standing in for a coin reads as
     a broken image. So the tag boards -- coins, clubs, players, gamertags --
     get the first two letters of the name in the board's own colour.

     It is also the honest answer to wanting a market's coin logos in this
     column. Every one of those is somebody's registered mark and this site
     takes money for rank, so it draws its own badge instead: same circle,
     same size, same place in the row. */
  /* Board colours run from Bitcoin orange to the near-white the NHL board
     uses, so the letters cannot always be white. Relative luminance decides,
     the way the contrast rules do: dark ink on a light badge, light on a
     dark one, computed once per row rather than guessed per board. */
  function inkFor(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return '#fff';
    const n = parseInt(m[1], 16);
    const lin = c => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
    const L = .2126 * lin(n >> 16 & 255) + .7152 * lin(n >> 8 & 255) + .0722 * lin(n & 255);
    return L > .45 ? '#0d1421' : '#ffffff';
  }

  /* Relative luminance, and the contrast between two colours by the formula
     WCAG states. Written out here because the answer decides what a person
     with poor sight can actually read, and a guess about that is worthless. */
  function lumOf(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return 0;
    const n = parseInt(m[1], 16);
    const lin = c => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
    return .2126 * lin(n >> 16 & 255) + .7152 * lin(n >> 8 & 255) + .0722 * lin(n & 255);
  }

  const contrast = (a, b) => {
    const x = lumOf(a), y = lumOf(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  };

  /* One ground per theme: the hardest one each has to work against.

     Light: band two, under the running ticker, the darkest light surface --
     a colour readable there is readable on the white page too.
     Dark: band zero, the lightest dark surface, for the same reason the
     other way round. */
  const GROUND = '#e7d4f0';
  const GROUND_DARK = '#2b1f39';

  /* The same hue, moved until it can be read -- and the ground decides which
     way. A light page wants the colour taken down toward black; a dark one
     wants it brought up toward white. Scaling or blending the three channels
     together is the crude way and the right one here: it holds the hue and
     only spends lightness, so Instagram stays Instagram pink and TikTok stays
     TikTok red -- they simply stop being 3:1 against whatever is behind them.

     Getting this wrong in one direction is what the dark theme did for a
     while: it was handed the colour made for the white page, so the ticker's
     rank sat at 2.5:1 on the dark band. Two grounds, two answers. */
  function readable(c, ground, target) {
    const m = /^#([0-9a-f]{6})$/i.exec(c);
    if (!m) return c;
    const n = parseInt(m[1], 16);
    const rgb = [n >> 16 & 255, n >> 8 & 255, n & 255];
    const spreLumina = lumOf(ground) < .18;
    for (let k = 0; k <= 1.0001; k += .02) {
      const t = '#' + rgb.map(v => Math.round(spreLumina ? v + (255 - v) * k : v * (1 - k))
        .toString(16).padStart(2, '0')).join('');
      if (contrast(t, ground) >= target) return t;
    }
    return spreLumina ? '#ffffff' : '#000000';
  }

  /* Three outcomes, not two.

     A colour too pale to be seen at all -- Snapchat's yellow, X's near-white,
     a club's silver -- becomes the page's own ink, as it always did. Taking
     that one down until it reads would make Snapchat olive, which is not a
     rescue, it is a different brand.

     What was missing was the middle. Instagram's pink read at 3.1:1 against
     the ticker and TikTok's red at 2.6:1, both under the 4.5 somebody with
     poor sight needs, and neither was pale enough for the old test to catch:
     thirty-nine of the forty-three board colours were in that gap. They are
     taken down to where they can be read, and no further.

     The untouched colour always goes out as --chip-d, which is what the dark
     theme uses. None of this applies there: a brand colour on a dark ground
     has the opposite problem and already passes. */
  function brandVars(colour, name) {
    const c = colour || '#8c98a4';
    const v = name || '--chip';
    const pale = inkFor(c) === '#0d1421';
    const fata = pale ? 'var(--muted)' : readable(c, GROUND, 4.5);
    /* A pale colour needs nothing done to it on a dark ground -- pale is
       exactly what reads there. Everything else is brought up until it does. */
    const noapte = pale ? c : readable(c, GROUND_DARK, 4.5);
    return `${v}:${fata};${v}-d:${noapte}`;
  }

  const chipVars = c => brandVars(c, '--chip');

  /* "Top 10 on X X". The mark for that board is the letter, so the name
     printed beside it says the same letter twice -- in the headline, in the
     board filter, and on the chip beside a listing. X is the only board where
     that happens: everywhere else the mark is a picture and the name is a
     word, and both are needed.

     The name is not deleted, only taken off the screen. A mark carries no
     text, so a board whose name is gone from the markup is a board a screen
     reader announces as nothing at all. The platform grid in the claim form
     is left alone: there the mark sits above its name rather than beside it,
     which reads as a labelled button and not as a stutter. */
  /* What the mark already says, so the name does not say it again. X is the
     whole name; UFC is the first word of one, and "UFC Fighters" beside the
     UFC logo prints it twice the same way. Only the repeated part goes off
     the screen, and it stays in the markup: a mark carries no text. */
  const SPUS_DE_MARCA = { 'x': 'X', 'ufc-fighters': 'UFC', 'bellator': 'Bellator' };
  const numeLangaMarca = p => {
    const spus = SPUS_DE_MARCA[p.slug];
    if (!spus || !p.name.startsWith(spus)) return esc(p.name);
    const rest = p.name.slice(spus.length).trim();
    return '<span class="sr-only">' + esc(spus) + '</span>' + (rest ? esc(rest) : '');
  };

  /* A country board's chip says the country. Twenty chips under one heading
     that all end in the heading's word would print it twenty times; the
     heading prints it once and the flag says the rest. The full name stays
     in the markup for a screen reader, which hears the chip without the
     heading over it. Only the chips: the headline and the strip say the
     whole name, because there nothing else is saying it. */
  const numeChip = p => p.chip
    ? '<span class="sr-only">' + esc(p.name) + '</span><span aria-hidden="true">' + esc(p.chip) + '</span>'
    : numeLangaMarca(p);

  /* Coin logos, fetched once and only when there is a coin on screen. 64 KB
     is nothing next to a page of avatars and everything next to nothing, so
     the home page does not pay for it unless a crypto listing is actually
     being drawn. Failure is silent: no map, and the coins keep their badges. */
  let COIN_LOGOS = null;
  async function loadCoinLogos() {
    if (COIN_LOGOS) return COIN_LOGOS;
    try {
      const r = await fetch('/coin-logos.json?v=591106ca79', { cache: 'force-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      COIN_LOGOS = await r.json();
    } catch (e) {
      console.warn('coin logos unavailable', e);
      COIN_LOGOS = { base: '', size: 'small', logos: {} };
    }
    return COIN_LOGOS;
  }

  /* The project's own mark, matched on the name or the ticker exactly as the
     lister typed it, through the same fold the boards use. No near-misses: a
     wrong logo over a paid listing is worse than no logo, so anything that
     does not match keeps its badge. */
  function coinLogo(handle) {
    if (!COIN_LOGOS || !COIN_LOGOS.base) return null;
    const hit = COIN_LOGOS.logos[fold(handle)];
    return hit ? COIN_LOGOS.base + hit.replace('/', `/${COIN_LOGOS.size}/`) : null;
  }

  /* Looked up separately and never mixed with the coins, because the names
     overlap: an exchange called Gate and a token called Gate are two things,
     and the board being looked at is what says which one is meant. */
  const exchangeLogo = handle =>
    (COIN_LOGOS && COIN_LOGOS.exchanges && COIN_LOGOS.exchanges[fold(handle)]) || null;

  /* Photographs for the Actors board, from Wikimedia Commons and nowhere
     else. Wikipedia serves two kinds of image from one host and the path says
     which: /wikipedia/commons/ is freely licensed, /wikipedia/en/ is the local
     upload area that exists to hold non-free files used under US fair use —
     which is where every film poster lives, and which is why the Movies board
     has drawings rather than posters. Fair use on an encyclopaedia does not
     carry over to a site that sells rank.
     
     The credit travels with the file because the licences ask for it. A
     CC-BY photograph shown without its author is not a free photograph, it
     is somebody's work taken. */
  /* The boards that have pictures on Commons. Same list the build script
     walks; kept here so a board without a section in the file never triggers
     a fetch for one. */
  const PEOPLE_BOARDS = ['actors', 'us-politicians', 'us-parties', 'eu-politicians', 'eu-parties',
                         'football-players', 'f1-drivers', 'golf-players', 'artists',
                         'nba-players', 'nhl-players', 'football-clubs',
                         'ufc-fighters', 'mma-fighters', 'boxers',
                         'bellator', 'one-championship', 'pfl',
                         'movements', ...RICH];

  /* Every sitting member of Congress, kept current by the public-domain
     dataset the civic-tech world maintains rather than by a list I typed once
     — 537 names hand-written would be wrong the week after an election, and
     wrong quietly. Their official portraits are works of the United States
     government, so this board carries real faces where the party board mostly
     cannot: a party emblem belongs to its committee, a senator's official
     photograph belongs to everyone. */
  let CONGRESS = null;
  async function loadCongress() {
    if (CONGRESS) return CONGRESS;
    try {
      const r = await fetch('/congress.json?v=d569f24621', { cache: 'force-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      /* Role, state and party on one line. The sixth field is a jersey number
         on the boards it was written for, and rendered "· #Democrat" here. */
      const rand = ([nume, id, rol, partid]) =>
        [nume, nume.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(),
         '#1e3a8a', '#ffffff', partid ? `${rol} · ${partid}` : rol, ''];
      CONGRESS = { photos: d.photos, byName: {}, list: (d.members || []).map(rand) };
      for (const [nume, id] of d.members || []) CONGRESS.byName[fold(nume)] = id;
    } catch (e) {
      console.warn('congress unavailable', e);
      CONGRESS = { photos: '', byName: {}, list: [] };
    }
    return CONGRESS;
  }

  const congressPhoto = handle => {
    if (!CONGRESS || !CONGRESS.photos) return null;
    const id = CONGRESS.byName[fold(handle)];
    return id ? CONGRESS.photos + id + '.jpg' : null;
  };

  let PEOPLE_ART = null;
  async function loadPeopleArt() {
    if (PEOPLE_ART) return PEOPLE_ART;
    try {
      const r = await fetch('/people-art.json?v=89fdc24108', { cache: 'force-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      PEOPLE_ART = await r.json();
    } catch (e) {
      console.warn('people art unavailable', e);
      PEOPLE_ART = { art: {} };
    }
    return PEOPLE_ART;
  }

  /* Keyed by board as well as by name: "Gary Player" the golfer and a party
     called anything are different pictures, and one flat map would have to
     pick. */
  const personArt = (slug, handle) =>
    (PEOPLE_ART && PEOPLE_ART.art && PEOPLE_ART.art[slug]
      && PEOPLE_ART.art[slug][fold(handle)]) || null;


  /* The publisher's own cover art for a game, from Steam's store search,
     built into a file the same way the coin logos are. Not every game is on
     Steam — Minecraft, Fortnite and Roblox sell elsewhere — so those keep
     their drawn badge, which is the honest outcome rather than a gap to fill
     with something close. */
  let GAME_ART = null;
  async function loadGameArt() {
    if (GAME_ART) return GAME_ART;
    try {
      const r = await fetch('/game-art.json?v=4e2739c5f1', { cache: 'force-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      GAME_ART = await r.json();
    } catch (e) {
      console.warn('game art unavailable', e);
      GAME_ART = { art: {} };
    }
    return GAME_ART;
  }

  const gameArt = handle =>
    (GAME_ART && GAME_ART.art && GAME_ART.art[fold(handle)]) || null;

  /* The map holds the top thousand. Somebody will list the one that is not in
     it — a coin that launched this week, or one at rank 4000 that its holders
     care about anyway — and that listing deserves its logo as much as
     Bitcoin's. So anything the map does not know is asked for by name, one
     coin at a time, against the same search CoinGecko's own site uses.

     Three things keep this from becoming a request storm. It runs only for
     rows the map missed. Every answer is remembered in this browser, the
     misses included, so a name is asked about exactly once ever. And the
     match is still exact — the search happily returns "dogwifhat Eth" and
     "DogWifHat" when asked for "dogwifhat", and putting either of those over
     somebody's paid listing would be worse than the badge it replaces. */
  const LOGO_CACHE = 'topten_coin_logo:';

  function cachedLogo(key) {
    try { return localStorage.getItem(LOGO_CACHE + key); } catch (e) { return null; }
  }
  function rememberLogo(key, url) {
    try { localStorage.setItem(LOGO_CACHE + key, url || ''); } catch (e) { /* full or private */ }
  }

  async function findCoinLogo(handle) {
    const key = fold(handle);
    if (!key) return null;

    const seen = cachedLogo(key);
    if (seen !== null) return seen || null;

    try {
      const r = await fetch('https://api.coingecko.com/api/v3/search?query='
        + encodeURIComponent(String(handle).replace(/^\$/, '')));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const hit = (d.coins || []).find(c => fold(c.name) === key || fold(c.symbol) === key);
      /* thumb is 25px and small is 50px; the row draws at 32 and the picker
         at 30, so ask for the bigger one by name rather than upscaling. */
      const url = hit && (hit.large || hit.thumb || '').replace('/thumb/', '/small/') || null;
      rememberLogo(key, url);
      return url;
    } catch (e) {
      /* A rate limit or an outage is not a permanent answer, so it is not
         remembered: the badge stands, and the next visit asks again. */
      return null;
    }
  }

  /* After the table is drawn, fill in the coins the map did not know. The row
     already shows its badge, so nothing is missing while this runs and
     nothing moves when it finishes — the logo simply appears over the badge,
     the same place it would have been. */
  async function upgradeCoinLogos() {
    const rows = currentRows().filter(r => CRYPTO.has(r.platform) && !coinLogo(r.handle));
    for (const row of rows) {
      const url = await findCoinLogo(row.handle);
      if (!url) continue;
      const cell = document.querySelector(`[data-row="${CSS.escape(row.id)}"] .mname__pic`);
      if (!cell || cell.querySelector('img')) continue;
      const img = document.createElement('img');
      img.loading = 'lazy'; img.width = 32; img.height = 32; img.alt = '';
      img.onerror = () => img.remove();
      img.onload = () => cell.classList.add('token--on');
      img.src = url;
      cell.appendChild(img);
    }
  }

  /* Every coin CoinGecko ranks, for the claim form's picker: a thousand on
     the crypto board, the five hundred it files as memecoins on the memecoin
     one. Fetched only when that form is opened on one of those boards, which
     is why it is a second file and not part of the logo map.

     Deliberately not a closed list. The club boards refuse anything not in
     the league because there is no thirty-first club; a coin board that
     refused anything not in a file built last Tuesday would turn away the
     exact new listing somebody arrived to pay for. The list is for spelling
     and for finding one, and typing past it is allowed. */
  /* The suggestion lists for the boards where you bid for somebody else:
     clubs, players, drivers, artists, games, cities, podcasts and the four
     influencer boards. Their job is spelling and finding one, not ranking —
     the board decides who is biggest, by what was paid — so they are open
     lists and typing a name that is not on one is expected.

     The boards where you list yourself get none. A menu of other people's
     profiles under "your own X profile" is an invitation to list something
     that is not yours. */
  let ROSTER_FILE = null;
  async function loadRosterFile() {
    if (ROSTER_FILE) return ROSTER_FILE;
    try {
      const r = await fetch('/rosters.json?v=3563de873e', { cache: 'force-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      ROSTER_FILE = await r.json();
      for (const [slug, list] of Object.entries(ROSTER_FILE)) {
        if (!ROSTERS[slug]) ROSTERS[slug] = list;
      }
    } catch (e) {
      console.warn('rosters unavailable', e);
      ROSTER_FILE = {};
    }
    return ROSTER_FILE;
  }

  /* Which boards have a list that is not already in the bundle, and where it
     comes from. Two files because they are two different sizes and two very
     different rates of change: a thousand coins that move weekly, and three
     hundred names that barely move at all. */
  /* nba-players and nhl-players joined this list when they stopped being ten
     names typed into the file above and became fifty fetched from the leagues.
     A list that size does not belong in the bundle every visitor downloads. */
  const LISTED_LATER = new Set([
    'nba-players', 'nhl-players',
    'crypto', 'memecoins', 'exchanges',
    'football-clubs', 'football-players', 'f1-drivers', 'artists', 'games',
    'cities', 'podcasts', 'actors', 'movies', 'cars', 'boats', 'golf-players',
    'startups', 'ufc-fighters', 'mma-fighters', 'boxers',
    'bellator', 'one-championship', 'pfl', 'movements',
    'us-parties', 'us-politicians', 'eu-parties', 'eu-politicians', ...RICH,
    'x-influencers', 'instagram-influencers', 'tiktok-influencers',
    'youtube-influencers', 'facebook-influencers'
  ]);

  const fetchRoster = slug =>
    CRYPTO.has(slug) ? loadCoinList()
    : slug === 'games'  ? Promise.all([loadRosterFile(), loadGameArt()])
    : slug === 'us-politicians'
        ? Promise.all([loadRosterFile(), loadPeopleArt(), loadCongress()]).then(() => {
            /* The presidents and vice presidents the file carries, then every
               sitting member — the historical names first because they are
               the ones somebody types from memory. */
            const baza = (ROSTER_FILE && ROSTER_FILE['us-politicians']) || [];
            const vazut = new Set(baza.map(t => fold(t[0])));
            ROSTERS['us-politicians'] = baza.concat(
              (CONGRESS.list || []).filter(t => !vazut.has(fold(t[0]))));
          })
    : PEOPLE_BOARDS.includes(slug) ? Promise.all([loadRosterFile(), loadPeopleArt()])
    : loadRosterFile();

  let COIN_LIST = null;
  async function loadCoinList() {
    if (COIN_LIST) return COIN_LIST;
    /* Both files, not just this one. The picker draws a logo beside every
       coin in it, and that logo comes out of the other file — which until now
       was fetched only when a crypto listing was already on a board. Open the
       form on an empty crypto board and every row in the list of a thousand
       coins fell back to its ticker badge, which is precisely where somebody
       is trying to recognise a coin by its logo. */
    const logos = loadCoinLogos();
    try {
      const r = await fetch('/coin-list.json?v=fe98927a89', { cache: 'force-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      /* Shaped like a club roster -- [name, mark, colour, colour] -- so the
         cascade that already exists needs nothing new to draw it. */
      const asRoster = rows => rows.map(([name, sym]) =>
        [name, sym, '#f7931a', '#ffffff']);
      COIN_LIST = { crypto: asRoster(d.names), memecoins: asRoster(d.meme),
                    exchanges: (d.exchanges || []).map(([n, m]) => [n, m, '#2775ca', '#ffffff']) };
      ROSTERS.crypto = COIN_LIST.crypto;
      ROSTERS.memecoins = COIN_LIST.memecoins;
      ROSTERS.exchanges = COIN_LIST.exchanges;
      await logos;   // the list is nothing to look at without them
    } catch (e) {
      console.warn('coin list unavailable', e);
      COIN_LIST = { crypto: null, memecoins: null };
    }
    return COIN_LIST;
  }

  /* The icon of the site a listing points at — for a business, a project or a
     podcast that is its own logo, published by the people who own it. Costs a
     listing nothing and needs no new field: the link is already in the form. */
  function siteLogo(link) {
    if (!linkable(link)) return null;
    try {
      const host = new URL(link).hostname.replace(/^www\./, '');
      return host
        ? `https://unavatar.io/${encodeURIComponent(host)}?fallback=false${unavatarToken()}`
        : null;
    } catch (e) { return null; }
  }

  /* Which boards have a face to fetch. A social board looks itself up; an
     influencer board looks up the platform it ranks, because @MrBeast on the
     X Influencers board is @MrBeast on X and unavatar has never heard of
     "x-influencers". Everything else -- coins, clubs, cities, dogs -- has no
     face anywhere and gets the badge. */
  /* Every picture on this site announces itself here rather than through an
     onload= and an onerror= attribute of its own.

     Two reasons, and the second is the one that matters. An attribute like
     that is inline script, and a content security policy that allows four of
     them allows all of it -- which is most of what such a policy is for. And
     load and error do not bubble, so a listener on the document only sees
     them in the capture phase; that is why this is written the way it is and
     not as an ordinary delegated click.

     What the two do is what the attributes did. On load, the badge under the
     picture stands down, because most of these are transparent PNGs and the
     initials showed through. On error, the picture tries the address it
     carries as a reserve -- normally the icon of the site the listing links
     to -- and if that fails as well it removes itself, revealing the badge
     that was underneath the whole time. */
  document.addEventListener('load', e => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.hasAttribute('data-pic')) return;
    if (img.parentNode && img.parentNode.classList) img.parentNode.classList.add('token--on');
  }, true);

  document.addEventListener('error', e => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-pic')) return;
    const rezerva = img.dataset.rezerva;
    if (rezerva && !img.dataset.tried) { img.dataset.tried = '1'; img.src = rezerva; }
    else img.remove();
  }, true);

  /* And the pictures that fail without saying so.

     A server answering 200 with an empty body -- which unavatar does for
     some Facebook profiles, instead of the 404 that fallback=false asks for
     -- produces an image that fires neither load nor error. The browser
     marks it complete with a natural width of zero and says nothing at all.
     Neither handler above ever runs: the reserve is never tried, the badge
     underneath is never uncovered, and the row keeps an invisible broken
     image exactly where a face belongs. Two of the five listings on the
     Facebook board were in that state.

     So they are swept. Whenever anything is added to the page, look again a
     couple of seconds later for pictures that are finished and empty, and
     give them what the error handler would have given them. An image still
     honestly loading is not complete yet and is left alone, so this cannot
     take a slow picture away from anybody. */
  let ceasPoze = null;
  const treceP = adanc => {
    let inZbor = 0;
    for (const img of document.querySelectorAll('img[data-pic]')) {
      if (!img.complete) { inZbor++; continue; }
      if (img.naturalWidth > 0) continue;
      const rezerva = img.dataset.rezerva;
      if (rezerva && !img.dataset.tried) { img.dataset.tried = '1'; img.src = rezerva; inZbor++; }
      else img.remove();
    }
    /* Another look while anything is still in flight. An image going empty
       after the sweep has run is not a change to the page, so nothing would
       schedule a second one -- and the ones that answer slowest are exactly
       the ones that answer with nothing. Three more passes, then stop. */
    if (inZbor && adanc < 3) setTimeout(() => treceP(adanc + 1), 3000);
  };
  const maturaPozele = () => {
    clearTimeout(ceasPoze);
    ceasPoze = setTimeout(() => treceP(0), 2500);
  };
  new MutationObserver(maturaPozele).observe(document.body, { childList: true, subtree: true });

  const faceOn = slug => {
    const p = BY_SLUG[slug];
    if (!p) return null;
    if (p.face) return p.face;
    return p.tag ? null : slug;
  };

  /* Four ways a row gets a real picture, in order of how certain each is: the
     coin's own logo, the icon of the site it links to, the profile picture on
     the platform being ranked, and the drawn badge underneath all of them.

     The badge is not a fallback that gets swapped in on failure. It is the
     floor: always drawn, the picture layered over it, and a picture that 404s
     removes itself and reveals what was already there. No broken-image glyph,
     no flash of the wrong thing, no second request.

     But a floor has to be covered once the picture is actually down. Most
     coin logos are transparent PNGs, so the initials underneath showed
     through them — two marks in one circle. onload is the only moment the
     page knows an image has real pixels in it, so that is where the letters
     are told to stand down. A picture that never loads never fires it, and
     the badge stays exactly as it was. */
  /* lene: whether the picture may wait until it is on screen. Everywhere on
     the page it may, and should. On the running strip it may not: the cells
     are moved by a transform inside a box with its own overflow, and a
     browser deciding what is visible sees almost all of them as off screen
     and never asks for them. Eleven pictures out of sixty-one had loaded
     after fifteen seconds, and the rest never would have. */
  /* A Commons picture at the width it will be shown, not the width the
     lookup happened to return. The portraits are filed as 330-pixel
     thumbnails, which is right for a table row and ten times too much for a
     34-pixel circle drawn two hundred times in the strip; Commons makes a
     thumbnail at any width on request, and the address says which. Both
     spellings of a Commons address are handled: a thumbnail's width is
     replaced, an original is asked for as a thumbnail. Anything not on
     Commons is left as it came.

     Not any width: Commons answers 400 to a size it does not keep, and 96
     was one. 120 is the smallest it does, and at 120 a portrait is seven
     kilobytes where the 330 was thirty. */
  const laLatime = (url, w) => {
    if (!w || !/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//.test(url || '')) return url;
    if (/\/thumb\//.test(url)) return url.replace(/\/(\d+)px-([^/]*)$/, `/${w}px-$2`);
    const m = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f]\/[0-9a-f]{2})\/([^/?#]+)$/.exec(url);
    if (!m) return url;
    const nume = m[3];
    return `${m[1]}/thumb/${m[2]}/${nume}/${w}px-${nume}${/\.svg$/i.test(nume) ? '.png' : ''}`;
  };

  function facePic(slug, handle, cls, row, lene = true, latime = 0) {
    const colour = (BY_SLUG[slug] && BY_SLUG[slug].color) || '#8c98a4';
    const initials = String(handle || '?')
      .replace(/^[@$]/, '').trim().slice(0, 2).toUpperCase() || '?';

    const on = faceOn(slug);
    /* Order matters: a person's own face beats their company's favicon.
       @supportrotabo links to rotabo.app, and taking the site icon first put
       a logo where a profile picture belonged. The site icon is what a board
       with no profile to look up falls back on -- a startup, a restaurant, a
       podcast, a project giving something away. */
    const src = laLatime((slug === 'exchanges' && exchangeLogo(handle))
      || (slug !== 'exchanges' && CRYPTO.has(slug) && coinLogo(handle))
      || (slug === 'games' && gameArt(handle))
      || (personArt(slug, handle) || {}).img
      || (slug === 'us-politicians' && congressPhoto(handle))
      || (slug === 'movements' && MISCARI_X[fold(handle)] && avatarUrl('x', MISCARI_X[fold(handle)]))
      || (on ? avatarUrl(on, handle) : null)
      || siteLogo(row && row.link), latime);

    /* Where to go when the first choice fails. A profile picture that 403s
       used to leave the badge even on a listing that links to a site with a
       perfectly good icon: the fallback was picked once, up front, and never
       reconsidered when the pick did not load. The image carries its next
       address with it now — which matters more than it used to, because
       unavatar answers 403 for half these handles. */
    const rezerva = siteLogo(row && row.link);

    return `<span class="${cls} token" data-board="${esc(slug)}"
                  style="--token:${colour};--token-ink:${inkFor(colour)}"
                  aria-hidden="true">${esc(initials)}${src
      ? `<img data-pic${lene ? ' loading="lazy"' : ''} width="32" height="32" alt="" src="${esc(src)}"${
          rezerva && rezerva !== src ? ` data-rezerva="${esc(rezerva)}"` : ''}>`
      : ''}</span>`;
  }

  /* Money that arrived, not money something is worth. A total here can only
     go up -- no payment is ever taken back -- so the red half of a market
     table has nothing truthful to put in it and is not drawn. A day when
     nothing came in prints a dash, which is what happened. */
  const mover = cents => Number(cents) > 0
    ? `<span class="mv mv--up">+${money(cents)}</span>`
    : '<span class="mv mv--flat">—</span>';

  /* Seven days of takings, oldest on the left, straight out of market(). The
     scale is the row's own best day, so the shape reads within one listing
     and never claims a comparison between two of them. A week with nothing
     in it draws its flat line rather than an empty cell. */
  function sparkline(spark) {
    const v = Array.isArray(spark) ? spark.map(n => Math.max(0, Number(n) || 0)) : [];
    if (v.length < 2) return '<span class="spark spark--none">—</span>';
    const hi = Math.max(...v, 1);
    const W = 112, H = 32;
    const pts = v.map((n, i) =>
      `${(i * W / (v.length - 1)).toFixed(1)},${(H - 4 - (n / hi) * (H - 8)).toFixed(1)}`
    ).join(' ');
    const live = v.some(n => n > 0);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"
                 preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" stroke="${live ? 'var(--ok)' : 'var(--dim)'}" stroke-width="1.7"
                stroke-linejoin="round" stroke-linecap="round" points="${pts}"/></svg>`;
  }

  /* The filter, and every board in it visible at once.
     
     It was one flat row that scrolled sideways, which on any normal screen
     showed about nine of the thirty-four and gave no sign the other
     twenty-five existed -- the boards were live, indexed and paid-for, and
     invisible. A leaderboard site whose list of leaderboards has to be
     dragged into view is hiding its own product.
     
     So the chips wrap, and they wrap under the labels the boards were
     grouped by anyway: eight headings, thirty-four chips, no scrolling. */
  function renderChips(active) {
    const chip = (href, on, brand, inner, count) =>
      `<a class="bfilter${on ? ' bfilter--on' : ''}" href="${href}" data-link${brand ? ` style="${chipVars(brand)}"` : ''}
          ${on ? 'aria-current="page"' : ''}>${inner}${count ? `<b>${count}</b>` : ''}</a>`;

    const total = Object.values(state.boards).reduce((n, r) => n + r.length, 0);
    let html = `<div class="chips__row">${
      chip('/', !active, '', '<span>All boards</span>', total)}</div>`;
    const acum = active && BY_SLUG[active] ? BY_SLUG[active].name : null;

    let deschis = null;
    for (const row of TAB_ROWS) {
      if (row.group !== deschis) {
        if (deschis !== null) html += '</div></div>';
        html += `<div class="chips__group"><p class="chips__label">${esc(row.group)}</p><div class="chips__row">`;
        deschis = row.group;
      }
      html += row.items.map(p => chip(`/${p.slug}/`, active === p.slug, p.color,
        `${icon(p.slug, true)}<span>${numeChip(p)}</span>`, board(p.slug).length)).join('');
    }
    if (deschis !== null) html += '</div></div>';

    /* Open on the front page, folded on a board -- and the whole point of the
       fold is that it is one click, not a hiding place.

       The front page opens on the boards, at every size of screen. It used to
       open on them only where the table's first row still fitted underneath
       -- a wide, tall window -- and fold them everywhere else, so on a laptop
       or a phone the page began with a list of names and no sign of where the
       names came from. Somebody landing there saw a ranking of Elon Musk,
       Binance and MAGA in one column and had to guess what the site was. The
       boards are the explanation: seventy of them, in their groups, and then
       the table under them. A row further down is the right price for that.

       A board page is the other way round: it is here to show its ten, so it
       opens on them, with the list one summary line away, saying how many
       boards are behind it. */
    return `<details class="chips" ${active ? '' : 'open'}>
      <summary class="chips__sum">
        <span>${active ? `${esc(acum)} — all ${PLATFORMS.length} boards` : 'Boards'}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m6 9 6 6 6-6z"/></svg>
      </summary>
      ${html}
    </details>`;
  }

  /* n is the row's place in the list on screen, which is what the gold on
     the number marks. row.rank is its place on its own board, which is what
     the Board column prints -- on the whole market a dozen rows are #1 of
     something, and gilding all twelve says nothing. */
  function marketRow(row, n, solo) {
    const p = BY_SLUG[row.platform];
    const name = linkable(row.url)
      ? `<a class="mname__h" href="${esc(row.url)}" target="_blank" rel="nofollow noopener">${esc(row.handle)}</a>`
      : `<span class="mname__h">${esc(row.handle)}</span>`;

    return `
    <tr class="mrow${n === 1 ? ' mrow--1' : ''}" data-row="${esc(row.id)}" data-open="${esc(row.id)}" tabindex="0">
      <td class="c-n">${n}</td>
      <td class="c-name">
        <span class="mname">
          ${facePic(row.platform, row.handle, 'mname__pic', row)}
          <span class="mname__txt">
            ${name}
            ${row.tagline ? `<span class="mname__t">${esc(row.tagline)}</span>` : ''}
          </span>
        </span>
      </td>
      <td class="c-paid">${money(row.total_cents)}</td>
      <td class="c-d1">${mover(row.d1_cents)}</td>
      <td class="c-d7">${mover(row.d7_cents)}</td>
      ${solo ? '' : `<td class="c-board">
        <a class="bchip" href="/${esc(row.platform)}/" data-link
           style="${chipVars(p && p.color)}">${icon(row.platform, true)}<span class="bchip__n">${p ? numeLangaMarca(p) : esc(row.platform)}</span></a>
        <span class="c-board__r">#${row.rank}</span>
      </td>`}
      <td class="c-spark">${sparkline(row.spark)}</td>
      <td class="c-act">
        <button class="mbtn" data-open="${esc(row.id)}" tabindex="-1">Details</button>
        <button class="mbtn mbtn--go" data-add="${esc(row.id)}">Add</button>
      </td>
    </tr>`;
  }

  /**
   * An unclaimed place, drawn only on a single board. Showing it beats hiding
   * it, but only one empty place can honestly carry a price: the first one
   * after the last listing. Paying the minimum lands you exactly there. Any
   * place below it is unreachable — whatever you pay, you land at the first
   * gap — and any place above it costs whatever it takes to pass the listing
   * sitting in it, which is a price the rows above already show.
   *
   * The whole market has no such row: it is not ten places long, so there is
   * no gap in it to price.
   */
  function marketFree(rank, slug, solo) {
    const taken = board(slug).length;
    const label = rank === taken + 1 ? money(MIN_CENTS) : 'Open';
    return `
    <tr class="mrow mrow--free">
      <td class="c-n">${rank}</td>
      <td class="c-name">
        <span class="mname">
          <span class="mname__pic mname__pic--empty" aria-hidden="true"></span>
          <span class="mname__txt"><span class="mname__h">Place ${rank} is open</span></span>
        </span>
      </td>
      <td class="c-paid${rank === taken + 1 ? '' : ' c-paid--word'}">${esc(label)}</td>
      <td class="c-d1"><span class="mv mv--flat">—</span></td>
      <td class="c-d7"><span class="mv mv--flat">—</span></td>
      ${solo ? '' : '<td class="c-board"></td>'}
      <td class="c-spark"></td>
      <td class="c-act"><button class="mbtn mbtn--go" data-claim="1">Claim</button></td>
    </tr>`;
  }

  /** Every listing on every board, most-paid first. Same order the boards use. */
  const wholeMarket = () => Object.values(state.boards).flat().sort((a, b) =>
    b.total_cents - a.total_cents ||
    new Date(a.last_paid_at) - new Date(b.last_paid_at));

  /* Just the rows. Kept apart from the table around them because a live
     update replaces these and nothing else: the header, the chips and the
     wrapper have not changed, and repainting them throws away the scroll. */
  function marketBody(slug) {
    if (slug) {
      // Always ten places on a board. A half-drawn board reads as broken; ten
      // places with gaps reads as an invitation, and one gap prints its price.
      const rows = board(slug);
      const cells = [];
      for (let i = 0; i < 10; i++) {
        cells.push(rows[i] ? marketRow(rows[i], i + 1, true) : marketFree(i + 1, slug, true));
      }
      return cells.join('');
    }

    const rows = wholeMarket();
    if (rows.length) return rows.map((r, i) => marketRow(r, i + 1)).join('');

    return `<tr class="mrow mrow--free">
      <td class="c-n">1</td>
      <td class="c-name"><span class="mname">
        <span class="mname__pic mname__pic--empty" aria-hidden="true"></span>
        <span class="mname__txt"><span class="mname__h">Nobody has paid yet</span>
        <span class="mname__t">The first ${money(MIN_CENTS)} takes #1 on any board</span></span>
      </span></td>
      <td class="c-paid">${money(MIN_CENTS)}</td>
      <td class="c-d1"></td><td class="c-d7"></td><td class="c-board"></td><td class="c-spark"></td>
      <td class="c-act"><button class="mbtn mbtn--go" data-claim="1">Claim</button></td>
    </tr>`;
  }

  function renderMarket(slug) {
    if (connectionError === 'config') {
      return `<div class="empty">
        <h3>Not connected yet</h3>
        <p>Fill in <code>config.js</code> with the Supabase URL, the anon key and the Stripe payment link, then reload.</p>
      </div>`;
    }

    return `
    <div class="mwrap">
      <table class="market${slug ? ' market--solo' : ''}">
        <thead>
          <tr>
            <th class="c-n" scope="col">#</th>
            <th class="c-name" scope="col">Name</th>
            <th class="c-paid" scope="col">Paid</th>
            <th class="c-d1" scope="col">24h</th>
            <th class="c-d7" scope="col">7d</th>
            ${slug ? '' : '<th class="c-board" scope="col">Board</th>'}
            <th class="c-spark" scope="col">Last 7 days</th>
            <th class="c-act" scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody id="market-body">${marketBody(slug)}</tbody>
      </table>
    </div>`;
  }

  /* Said on the board, in the form, and on the thank-you page — everywhere
     somebody is about to pay or has just paid. Not buried in the terms: the
     terms are not where a person about to click a button is looking, and the
     whole point of this notice is that it is read before the money moves. */
  const NOTICE = 'This is a TopTen.one ranking, not a poll, an election, or a '
    + 'political donation. Money paid here buys a position in a private '
    + 'ranking on this website. It does not reach any party, campaign or '
    + 'candidate, it is not a contribution of any kind, and it counts as no '
    + "vote anywhere. Nothing here is an endorsement by TopTen.one of anyone "
    + 'listed on it.';

  const needsNotice = slug => !!(BY_SLUG[slug] && BY_SLUG[slug].notice);

  const noticeBlock = slug => needsNotice(slug)
    ? `<p class="notice">${esc(NOTICE)}</p>` : '';

  /** The line above a single board: what #1 costs to take off whoever holds it. */
  function renderLead(slug) {
    const p = BY_SLUG[slug];
    const lead = board(slug)[0];
    return lead ? `
      <div class="tobeat">
        <div>
          <span class="tobeat__k">Holding #1 on ${esc(p.name)}</span>
          <span class="tobeat__v">${money(lead.total_cents)}</span>
          <span class="tobeat__who">${esc(lead.handle)}</span>
        </div>
        <button class="tobeat__cta" data-claim="1">${(b => b.oneGo
          ? `Beat it for ${money(b.need)}`
          : `Beat it for ${money(b.need)} — more than one payment`)(toBeat(lead.total_cents))}</button>
      </div>` : `
      <div class="tobeat">
        <div>
          <span class="tobeat__k">Nobody on ${esc(p.name)} yet</span>
          <span class="tobeat__v">${money(MIN_CENTS)}</span>
          <span class="tobeat__who">takes #1 right now</span>
        </div>
        <button class="tobeat__cta" data-claim="1">${isFan(slug)
          ? 'Who should be #1?'
          : 'Take #1'}</button>
      </div>`;
  }

  /** Everyone on a board below tenth place. Only a board has one of these. */
  function renderWaiting(slug) {
    const rest = board(slug).slice(10);
    if (!rest.length) return '';
    const gap = board(slug).length >= 10 ? clampMin(nextDollarAbove(cutoffCents(slug))) : MIN_CENTS;
    return `
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
      </details>`;
  }

  /* One share row per view, and here it belongs directly under the table:
     that is the moment someone has just understood what the place is. At the
     bottom of the page it was past everything, including the reason to pass
     it on. */
  function renderShareBar() {
    return `
    <div class="shell">
      <div class="sharebar">
        <span class="sharebar__k">Share</span>
        <a class="sharebar__url" href="https://topten.one/">topten.one</a>
        <span class="sharebar__acts">
          <button class="sharebar__btn" data-share-copy>Copy link</button>
          ${shareButtons(SITE_PITCH, SITE + '/', 'sharebar__btn')}
        </span>
      </div>
    </div>`;
  }

  /* The headline asks; it no longer answers. The price it used to quote was
     live -- the cheapest unheld #1 on the site at that moment -- and it still
     is, in the strip of figures below and on the button, where it is never
     rounded, dressed up or invented. A price you can check is worth more than
     a promise you cannot, but it does not have to be the first thing said. */
  function heroHome() {
    /* One line, and it is the question. "Rankings decided by money" was the
       title above it until it was cut, and the tab, the share card, the badge
       and the manifest followed it out: the site opens on what it asks, not
       on what it is called. The rule and the price used to stand here too and
       are both still on the page: the price is a live figure in the strip
       below and on the button. */
    return `<h1>Who should be <em class="hero__rank">#1</em>?</h1>`;
  }

  function heroBoard(slug) {
    const p = BY_SLUG[slug];
    const held = topCents(slug);
    const b = held ? toBeat(held) : { need: MIN_CENTS, oneGo: true };
    const cost = b.need;
    const n = board(slug).length;
    /* The board's own mark beside its name. "Top 10 on X" set in the accent
       violet said nothing about which X — the platform has a mark and this is
       the one line on the page big enough to carry it properly. Its own
       colour, through chipVars, so a pale one still shows on white. */
    return `<h1>Top 10 on <span class="hero__mark" style="${chipVars(p.color)}"
        aria-hidden="true">${icon(slug, true)}</span><em>${numeLangaMarca(p)}</em></h1>
      <p class="hero__sub">${n
        ? `${n} ${n === 1 ? 'listing is' : 'listings are'} on this board.
           <b>First place costs ${money(cost)}</b> — one dollar more than the
           listing holding it${b.oneGo
             ? ', and the change is instant'
             : `, which is over Stripe's ${money(MAX_CENTS)} limit for a single
                payment, so it takes two — totals add up`}.`
        : `Nobody has taken this board yet. <b>${money(cost)} makes you #1</b>,
           and #1 is the row everybody sees first.`}</p>`;
  }

  /* Only what this view actually draws -- and every view draws the strip.

     facePic is synchronous, so whatever it needs has to be in memory before
     the row is drawn, or every coin appears once as a badge and again as a
     logo a moment later. This used to ask only what the open board's rows
     needed, on the reasoning that a board page draws one board. It does, and
     under it the strip draws the top of every board there is. So a visitor
     who landed on /movies/ -- which is where a payment's thank-you sends you
     -- saw a strip of initials where the faces were: Musk, Bezos and Obama
     had portraits on file and nothing had asked for the file. The rows the
     strip draws are the rows that decide what is fetched, whichever page is
     open; the open board's own rows are among them. */
  async function artFor(openSlug) {
    const randuri = wholeMarket();
    const boarduri = new Set(randuri.map(r => r.platform));
    const treaba = [];
    if ([...boarduri].some(b => CRYPTO.has(b))) treaba.push(loadCoinLogos());
    if (boarduri.has('games')) treaba.push(loadGameArt());
    if ([...boarduri].some(b => PEOPLE_BOARDS.includes(b))) treaba.push(loadPeopleArt());
    if (boarduri.has('us-politicians')) treaba.push(loadCongress());
    if (!treaba.length) return false;
    await Promise.all(treaba);
    return true;
  }

  function renderHome(openSlug) {
    const p = openSlug ? BY_SLUG[openSlug] : null;
    state.platform = openSlug || null;

    /* Two orders, because the headline is doing two different jobs.
    
       On the front page it introduces the site, so it comes first and the
       board chips follow it as the way in.
    
       On a board it introduces that board's ten -- "Top 10 on X, first place
       costs $219" -- and a heading belongs against the thing it heads. Sitting
       above the chips it read as a title for the list of all thirty-four
       boards, which is not what it says. So on a board the chips come first,
       as navigation, and the headline sits directly on top of its own ten. */
    const cap = `<section class="hero">${p ? heroBoard(openSlug) : heroHome()}</section>`;

    view.innerHTML = `
      ${renderStats()}
      ${renderTicker()}
      <div class="shell">
        ${p ? renderChips(openSlug) + cap + noticeBlock(openSlug) + renderLead(openSlug)
            : cap + renderChips(null)}
        ${renderMarket(openSlug)}
        ${openSlug ? renderWaiting(openSlug) : ''}
      </div>
      ${renderShareBar()}`;

    fillTicker();
    stampCascade(true);
    revealChip();
    upgradeCoinLogos();

    sticky.hidden = false;
    $('#cta-claim').textContent = ctaFor(openSlug);
    document.title = p ? `Top 10 on ${p.name} — TopTen.one` : 'TopTen.one — Who should be #1?';
    snapshotRanks();
  }

  /* One delay step per row, set from here rather than written into the markup
     so marketRow stays unaware of how it arrives. Capped: past the first
     screen the stagger is a wait, not an entrance. */
  function stampCascade(fresh) {
    const body = document.getElementById('market-body');
    if (!body) return;
    body.querySelectorAll(':scope > tr')
      .forEach((el, i) => el.style.setProperty('--i', Math.min(i + 1, 14)));
    if (fresh) body.dataset.fresh = ''; else delete body.dataset.fresh;
  }

  /* Thirty boards do not fit across a screen, so the one being looked at can
     easily be off the right-hand end of its own filter row -- which reads as
     the filter having nothing to do with the page. Scroll it into the middle
     without moving the page itself. */
  function revealChip() { /* every chip is on screen now; nothing to scroll */ }

  /** The rows the view is showing, in the order it shows them. */
  const currentRows = () => state.platform ? board(state.platform) : wholeMarket();

  /** Repaint the table body, animating rows whose position moved. */
  function refreshBoard() {
    const body = document.getElementById('market-body');
    if (!body) return;

    const before = state.prevRanks;
    body.innerHTML = marketBody(state.platform);
    stampCascade(false);
    upgradeCoinLogos();

    const now = {};
    currentRows().forEach((r, i) => { now[r.id] = i + 1; });
    for (const [id, rank] of Object.entries(now)) {
      const was = before[id];
      if (was === undefined || was === rank) continue;
      const el = body.querySelector(`[data-row="${CSS.escape(id)}"]`);
      if (el) el.classList.add(rank < was ? 'row--bumped' : 'row--sunk');
    }
    state.prevRanks = now;

    const statsEl = document.querySelector('.stats');
    if (statsEl) statsEl.outerHTML = renderStats();

    /* The chip counts move with the boards. Rebuilt rather than patched:
       there are twenty of them, three spans each, and the whole row is
       cheaper to write than the bookkeeping to find the one that changed. */
    const chips = document.querySelector('.chips');
    if (chips) chips.outerHTML = renderChips(state.platform);

    const cta = $('#cta-claim');
    if (cta) cta.textContent = ctaFor(state.platform);
  }

  /** Remember where every listing sits, so the next refresh can animate movement. */
  function snapshotRanks() {
    state.prevRanks = {};
    currentRows().forEach((r, i) => { state.prevRanks[r.id] = i + 1; });
  }

  /* ------------------------------------------------------------- modals */

  function openModal(html) {
    panel.innerHTML = html;
    /* Every modal starts at its content size. Only the listing asks to be
       bigger, and it asks for itself, below. */
    panel.classList.remove("modal__panel--full");
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

    /* The same option, asked or told. On a fan board the top of the ladder is
       an answer to a question — who should be first — and on a board where
       you list yourself it is an instruction, because the answer is you. */
    const varf = isFan(slug) ? 'Who should be #1?' : 'Take #1';

    if (rows[0] && rows[0].total_cents >= current) {
      push(varf, exceptId ? 'Pass everyone above you' : 'Straight to the top of the board',
        nextDollarAbove(rows[0].total_cents));
    } else {
      push(varf, rows.length ? 'You are already #1 — extend the lead' : 'The board is empty',
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

  /* The picture for a name in the picker, by the same chain a row on the
     board uses. It had a shorter chain of its own, and the difference was
     visible: the five influencer boards drew thirty violet circles with two
     letters in them, because the chain stopped at the boards that have
     Wikipedia photographs and never went on to ask unavatar -- which is
     where a creator's picture actually is, and which this site pays for.
     One chain now, so a board cannot have a face in the table and initials
     in the list that offers it. */
  /* Two movements whose own account is the movement itself rather than an
     organisation inside it: the me too. Movement and March for Life are the
     names on the tin. Their pictures arrive the way every social listing's
     does -- from unavatar, which shows what the platform itself shows -- so
     nothing is copied anywhere.

     Not @NRA for gun rights and not @Greenpeace for the environment. Those
     are organisations of a movement, not the movement, and one standing in
     for the other is the mistake this site keeps catching. Nor @aim_movement
     for the American Indian Movement: that account turned out to be an
     unrelated "AIM Love Movement", which is why every one of these was opened
     and looked at before it was written down. */
  const MISCARI_X = {
    'metoo': 'MeTooMVMT',
    'march for life': 'March_for_Life',
  };

  function rosterPic(slug, name) {
    const on = faceOn(slug);
    return (slug === 'exchanges' && exchangeLogo(name))
      || (slug !== 'exchanges' && CRYPTO.has(slug) && coinLogo(name))
      || (slug === 'games' && gameArt(name))
      || (personArt(slug, name) || {}).img
      || (slug === 'us-politicians' && congressPhoto(name))
      || (slug === 'movements' && MISCARI_X[fold(name)] && avatarUrl('x', MISCARI_X[fold(name)]))
      || (on ? avatarUrl(on, name) : null)
      || null;
  }

  let cascadeList = null;
  let cascadeDocBound = false;

  /* The clubs and the players, dropped in a list rather than tucked inside a
     datalist. A datalist is a suggestion the browser may or may not honour --
     several will not open it until enough letters are typed, which is no use
     to somebody who wants to SEE the thirty-two and choose one.

     So: an arrow that opens the lot, typing that narrows by word start the
     way the country list does, arrows and Enter for the keyboard, Escape and
     a click outside to close. Absent entirely on the boards that have no
     list, where the field is a profile link and a dropdown would be noise. */
  function setupCascade(slug, input) {
    const wrap = $('#roster-wrap');
    const list = $('#roster-list');
    const toggle = $('#roster-toggle');
    if (!wrap || !list || !toggle) return;

    cascadeList = ROSTERS[slug] || null;

    /* Two things can be missing when this opens, and only one of them was
       ever fetched. Thirteen boards keep their list outside the bundle, and
       asking for it also brings the pictures. The ten NBA players and the ten
       NHL players keep their list inside the bundle -- so this branch never
       ran for them, nothing ever asked for people-art.json, and two boards
       that are nothing but people showed twenty sets of initials.

       So: whichever is missing. The list if there is no list, the pictures if
       there is a list and no pictures. And draw again when it lands, but only
       if the form is still open on the same board -- by then somebody may
       have picked another one or closed it altogether. */
    const lipseste = !cascadeList
      ? (LISTED_LATER.has(slug) ? fetchRoster(slug) : null)
      : (PEOPLE_BOARDS.includes(slug) && !PEOPLE_ART ? loadPeopleArt() : null);

    if (lipseste) {
      lipseste.then(() => {
        if (!modal.hidden && state.draft && state.draft.slug === slug && ROSTERS[slug]) {
          setupCascade(slug, document.getElementById('url-input'));
        }
      });
    }

    /* One listener for the whole page, not one per modal: the nodes are
       looked up when the click happens, so it keeps working across every
       later opening instead of holding on to the first modal's dead ones. */
    if (!cascadeDocBound) {
      cascadeDocBound = true;
      document.addEventListener('click', e => {
        const w = document.getElementById('roster-wrap');
        const l = document.getElementById('roster-list');
        if (!w || !l || l.hidden) return;
        if (!w.contains(e.target)) {
          l.hidden = true;
          const t = document.getElementById('roster-toggle');
          if (t) t.setAttribute('aria-expanded', 'false');
        }
      });
    }

    if (!cascadeList) {
      wrap.classList.remove('cascade--on');
      toggle.hidden = true;
      list.hidden = true;
      list.innerHTML = '';
      return;
    }

    wrap.classList.add('cascade--on');
    toggle.hidden = false;
    list.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');

    /* The modal is rebuilt from scratch every time it opens, so this flag is
       fresh each time -- but picking a second platform without closing it
       runs this function again on the same nodes, and listeners would stack.
       Bound once; what changes between platforms is cascadeList, which the
       handlers read rather than close over. */
    if (wrap.dataset.bound) return;
    wrap.dataset.bound = '1';

    let active = -1;
    let taking = false;

    /* Drawn in pages of sixty, and the next page arrives when the list is
       scrolled to the bottom of the one before -- so a list of five hundred
       and thirty-five members of Congress, or a thousand coins, is all there,
       and none of it is drawn before somebody looks at it. It used to stop at
       sixty with a line saying how many more there were and to keep typing;
       the note was honest and the list was still cut off at the Bs, which on a
       board of the whole Congress read as a list of the whole Congress that
       happened to end at B. Sixty at once is still the right page: sixty
       pictures load without being asked twice, and a thousand <img> tags in
       one go is what left every coin on a coloured disc the last time. */
    const CAP = 60;
    let maiMult = () => {};

    const draw = q => {
      const words = fold(q).split(' ').filter(Boolean);
      const shown = (cascadeList || []).filter(t => {
        if (!words.length) return true;
        const hay = fold(teamName(t)).split(' ')
          .concat(fold(teamClub(t)).split(' '))
          .concat([fold(teamMark(t))])
          .filter(Boolean);
        return words.every(w => hay.some(h => h && h.indexOf(w) === 0));
      });

      active = -1;
      const optiune = t => `
            <button type="button" class="cascade__opt" role="option" aria-selected="false"
                    data-club="${esc(teamName(t))}">
              <span class="chip" data-board="${esc(slug)}" style="--chip-ink:${esc(teamInk(t))};--chip-trim:${esc(teamTrim(t))}">${esc(teamMark(t))}${
                /* A coin in this list gets its own logo over the ticker, the
                   same way a row in the table does — same trick, same floor:
                   the ticker is drawn first and the picture sits on top of
                   it, so one that fails to load simply is not there. Clubs
                   keep their abbreviation; a crest is not ours to fetch. */
                (n => n ? `<img data-pic alt="" src="${esc(n)}">` : '')(rosterPic(slug, teamName(t)))
              }</span>
              <span class="cascade__who">
                <span class="cascade__name">${esc(teamName(t))}</span>
                ${teamClub(t) ? `<span class="cascade__club">${esc(teamClub(t))}${teamNo(t) ? ` &middot; #${esc(teamNo(t))}` : ''}</span>` : ''}
              </span>
            </button>`;

      let desenate = 0;
      const pagina = () => { const p = shown.slice(desenate, desenate + CAP); desenate += p.length; return p.map(optiune).join(''); };
      const nota = () => shown.length > desenate
        ? `<p class="cascade__more" data-more>${(shown.length - desenate).toLocaleString()} more below — keep scrolling, or type to narrow it. Any name typed in full is taken as it is.</p>`
        : '';

      /* The next page, when the bottom of this one comes into view. The note
         moves down with it and goes when there is nothing left to say. */
      maiMult = () => {
        if (desenate >= shown.length) return;
        if (list.scrollTop + list.clientHeight < list.scrollHeight - 160) return;
        const veche = list.querySelector('[data-more]');
        if (veche) veche.remove();
        list.insertAdjacentHTML('beforeend', pagina() + nota());
      };

      list.innerHTML = shown.length
        ? pagina() + nota()
        : `<p class="cascade__none">Nothing by that name in the list. Type it out in full and it will be taken as it is.</p>`;
    };
    list.addEventListener('scroll', () => maiMult(), { passive: true });

    /* Where the list goes, measured rather than assumed.

       It was 288px hanging under the field, always downward. On a laptop
       there is room for that. On a phone the field sits two thirds of the way
       down the form, so half the box opened below the bottom of the screen:
       three rows visible, a finger on them scrolling the other twenty-seven
       into the part nobody can see. Which reads exactly as "the list does not
       scroll", and is worse than that -- it scrolls, into nowhere.

       So: how much room is under the field, how much over it, open toward
       whichever is bigger, and take only what is there. visualViewport is the
       measure and not innerHeight, because on a phone the on-screen keyboard
       takes half the window and innerHeight does not notice. */
    const AER = 12, MAX = 288, DESTUL = 168;

    const aseaza = () => {
      if (list.hidden) return;
      const vv = window.visualViewport;
      const inaltime = vv ? vv.height : innerHeight;
      const r = input.getBoundingClientRect();
      const dedesubt = inaltime - r.bottom - AER;
      const deasupra = r.top - AER;
      const jos = dedesubt >= DESTUL || dedesubt >= deasupra;
      const loc = Math.max(96, jos ? dedesubt : deasupra);
      list.style.top = jos ? 'calc(100% + 6px)' : 'auto';
      list.style.bottom = jos ? 'auto' : 'calc(100% + 6px)';
      list.style.maxHeight = Math.min(MAX, loc) + 'px';
    };

    /* The panel the form scrolls in. Bringing the field up inside it before
       measuring is what turns a peephole into a list: there is plenty of room
       on a phone, it is just all above the field rather than below it. */
    const panou = (() => {
      let e = input.parentElement;
      while (e && e !== document.body) {
        const o = getComputedStyle(e).overflowY;
        if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 1) return e;
        e = e.parentElement;
      }
      return null;
    })();

    const open = all => {
      /* Typing calls this on every keystroke, and the field should be moved
         once, when the list appears -- not nudged again under the thumb with
         every letter. */
      const eraInchisa = list.hidden;
      draw(all ? '' : input.value);
      list.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');

      const vv = window.visualViewport;
      const inaltime = vv ? vv.height : innerHeight;
      const r = input.getBoundingClientRect();
      if (eraInchisa && panou && inaltime - r.bottom - AER < DESTUL) {
        /* Put the field a little under the top of the panel, so the list has
           the whole screen beneath it instead of the last two centimetres. */
        const p = panou.getBoundingClientRect();
        panou.scrollTop += r.top - p.top - 16;
      }
      aseaza();
    };

    const close = () => {
      list.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      list.style.top = list.style.bottom = list.style.maxHeight = '';
      active = -1;
    };

    /* The field moves whenever the form is scrolled or the window changes, and
       a height worked out for where it used to be is a wrong height. */
    if (panou) panou.addEventListener('scroll', aseaza, { passive: true });
    addEventListener('resize', aseaza);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', aseaza);

    const opts = () => Array.prototype.slice.call(list.querySelectorAll('.cascade__opt'));

    const move = d => {
      if (list.hidden) { open(true); }
      const o = opts();
      if (!o.length) return;
      active = (active + d + o.length) % o.length;
      o.forEach((b, i) => {
        b.classList.toggle('is-active', i === active);
        b.setAttribute('aria-selected', i === active ? 'true' : 'false');
      });
      o[active].scrollIntoView({ block: 'nearest' });
    };

    const take = name => {
      /* The form's own validation listens for `input`, and it has to run for
         a name that was clicked exactly as for one that was typed. But so
         does the handler that opens this list -- which would drop it straight
         back over the field the moment a choice was made. The latch lets the
         validation through and keeps the list shut. */
      taking = true;
      input.value = name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      taking = false;
      close();
      input.focus();
    };

    toggle.addEventListener('click', () => { list.hidden ? open(true) : close(); });

    input.addEventListener('input', () => { if (cascadeList && !taking) open(false); });
    input.addEventListener('focus', () => { if (cascadeList && !input.value) open(true); });

    input.addEventListener('keydown', e => {
      if (!cascadeList) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); close(); }
      else if (e.key === 'Enter' && !list.hidden && active >= 0) {
        e.preventDefault();
        take(opts()[active].dataset.club);
      }
    });

    /* A finger that travels is scrolling, not choosing.

       The choice is taken on mousedown and has to be: the input loses focus
       first, and its blur closes the list out from under the pointer before a
       click could ever land. But on a touch screen the browser synthesises a
       mousedown on whatever the finger started on -- so a drag down the list
       could arrive here as a choice, take a name and shut the list, which is
       indistinguishable from a list that refuses to scroll.

       So the pointer is watched between going down and coming up, and a
       journey of more than a few pixels means the mousedown that follows is
       the tail of a scroll and not a tap. A mouse never moves between its own
       pointerdown and mousedown, so nothing changes there. */
    let pornire = null, calatorit = false;
    list.addEventListener('pointerdown', e => {
      pornire = { x: e.clientX, y: e.clientY };
      calatorit = false;
    });
    list.addEventListener('pointermove', e => {
      if (!pornire) return;
      if (Math.abs(e.clientY - pornire.y) > 8 || Math.abs(e.clientX - pornire.x) > 8) calatorit = true;
    });
    list.addEventListener('pointerup', () => { pornire = null; });
    list.addEventListener('pointercancel', () => { pornire = null; calatorit = true; });

    list.addEventListener('mousedown', e => {
      const opt = e.target.closest('.cascade__opt');
      if (!opt) return;
      if (calatorit) { calatorit = false; return; }
      e.preventDefault();
      take(opt.dataset.club);
    });
  }

  /* The form always opens on some board. The home page has none selected --
     that is the point of a market view -- and the old code took state.platform
     on faith, which used to be 'x' and is now null: every field in the form
     reads BY_SLUG[slug].something, so opening it from the front page threw
     before a single input was wired and the pay button never came alive.
     The picker is right there; this only decides which one starts pressed. */
  function submitModal(preslug) {
    const start = preslug || state.platform || PLATFORMS[0].slug;
    state.draft = { slug: start, url: '', handle: '', tagline: '', cents: 0 };
    const slug = state.draft.slug;
    openModal(`
      <div class="modal__head">
        <div>
          <h2 id="modal-title">Claim my rank</h2>
          <p id="modal-sub">Pick a board, pick an amount. Pay more than the listing above you and you are above it — the moment the payment clears.</p>
        </div>
        <button class="modal__x" data-close aria-label="Close">&times;</button>
      </div>

      <div class="field">
        <label>Platform</label>
        <div class="picker" id="picker">
          ${PLATFORMS.map(p => `
            <button type="button" class="pick" data-pick="${p.slug}" aria-pressed="${p.slug === slug}"
                    style="${brandVars(p.color, '--pick-brand')}" title="${esc(p.name)}"
                    aria-label="${esc(p.name)}">${icon(p.slug, true)}<span class="pick__name">${esc(p.name)}</span></button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label for="url-input" id="url-label">Profile link</label>
        <div class="cascade" id="roster-wrap">
          <input class="input" id="url-input" type="text" inputmode="url" autocomplete="off"
                 spellcheck="false" placeholder="https://x.com/yourname">
          <button class="cascade__toggle" id="roster-toggle" type="button" hidden
                  aria-expanded="false" aria-controls="roster-list" aria-label="Show the whole list">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m6 9 6 6 6-6z"/></svg>
          </button>
          <div class="cascade__list" id="roster-list" role="listbox" aria-label="Suggestions — you can also type your own" hidden></div>
        </div>
        <div class="hint" id="url-hint"></div>
      </div>

      <div class="field">
        <label for="tag-input">Tagline <span style="text-transform:none;letter-spacing:0">— optional</span></label>
        <input class="input" id="tag-input" maxlength="${TAG_MAX}" placeholder="One line about you">
        <div class="hint" id="tag-hint"></div>
      </div>

      <div class="field">
        <label for="link-input">Your link <span style="text-transform:none;letter-spacing:0">— optional</span></label>
        <input class="input" id="link-input" type="url" inputmode="url" maxlength="200"
               spellcheck="false" placeholder="https://your-business.com">
        <div class="hint" id="link-hint">Your site, shop or business. Shown on your listing.</div>
      </div>

      ${noticeBlock(slug)}

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
    /* Shared as the badge, not as this window: a link to a picture of the
       place tells someone who has never seen the site what it is. */
    const shareText = `${row.handle} is #${pos} on ${p.name}`;
    const shareUrl = badgeUrl(row.platform, row.handle);

    openModal(`
      <div class="modal__head">
        <div>
          <h2 id="modal-title">${esc(row.handle)}</h2>
          <p><span class="detail__brand" style="${chipVars(p.color)}">${icon(row.platform, true)}</span> ${esc(p.name)} · #${pos} with ${money(row.total_cents)}</p>
        </div>
        <button class="modal__x" data-close aria-label="Close">&times;</button>
      </div>

      <div class="detail">
        ${facePic(row.platform, row.handle, 'detail__av', row)}
        <div class="detail__body">
          ${row.tagline
            ? `<p class="detail__tagline">${esc(row.tagline)}</p>`
            : `<p class="detail__tagline detail__tagline--none">No tagline on this listing.</p>`}
          ${(a => a ? `<p class="detail__credit">Photo: <a href="${esc(a.pagina)}"
               target="_blank" rel="noopener">${esc(a.autor)}</a>, ${esc(a.licenta)},
               via Wikimedia Commons</p>` : '')(personArt(row.platform, row.handle))}
        </div>
      </div>

      <div class="detail__links">
        <a class="detail__link" href="${linkable(row.url) ? esc(row.url) : '#'}"${linkable(row.url) ? ' target="_blank" rel="nofollow noopener"' : ' aria-disabled="true"'}>
          <span class="detail__link-k">${esc(p.name)} ${p.tag ? esc(p.tag.label) : 'profile'}</span>
          <span class="detail__link-v">${esc(row.handle)}</span>
        </a>
        ${linkable(row.link) ? `
        <a class="detail__link" href="${esc(row.link)}" target="_blank" rel="nofollow noopener">
          <span class="detail__link-k">Their link</span>
          <span class="detail__link-v">${esc(prettyLink(row.link))}</span>
        </a>` : ''}
      </div>

      <button class="btn" data-add="${esc(row.id)}">Add money to ${esc(row.handle)}</button>
      ${keyFor(row.id) ? `<button class="btn btn--ghost" style="margin-top:8px" data-edit="${esc(row.id)}">Edit what this says</button>` : ''}

      <div class="detail__acts">
        <a href="${badge}" data-link>Badge</a>
        <a href="${esc(report)}">Report</a>
      </div>

      <div class="detail__share">
        <span class="detail__share-k">Share this listing</span>
        <span class="detail__share-acts">${shareButtons(shareText, shareUrl, 'sharebar__btn')}</span>
      </div>`);
    /* The listing is the thing people came to look at: a face, a tagline and
       two links deserve the page, not a card in the middle of it. */
    panel.classList.add("modal__panel--full");
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
        <label for="edit-tag">Tagline</label>
        <input class="input" id="edit-tag" maxlength="${TAG_MAX}" value="${esc(row.tagline || '')}"
               placeholder="One line about you">
        <div class="hint" id="edit-tag-hint"></div>
      </div>

      <div class="field">
        <label for="edit-link">Your link</label>
        <input class="input" id="edit-link" type="url" inputmode="url" maxlength="200"
               spellcheck="false" value="${esc(row.link || '')}"
               placeholder="https://your-business.com">
        <div class="hint" id="edit-hint">Leave either one empty to remove it.</div>
      </div>

      <button class="btn" id="edit-save">Save</button>`);

    countTagline($('#edit-tag'), $('#edit-tag-hint'));

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
    countTagline(tag, $('#tag-hint'));
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

    /* Everything the platform decides -- the label, the example, the two
       sentences at the top, the list of clubs, the ladder of amounts -- used
       to live inside the click handler, which meant it only ever ran when
       somebody clicked. Open the form from a board and the platform is
       already chosen: no click, so a PlayStation player was asked for a
       "profile link" and a hockey fan got no list at all. Named, so it can
       be run once on the way in as well. */
    function applyPlatform(slug) {
      state.draft.slug = slug;
      $('#picker').querySelectorAll('[data-pick]')
        .forEach(x => x.setAttribute('aria-pressed', x.dataset.pick === slug));
      /* A console asks for a tag and a network asks for a link, so the
         label and the example change with the platform. Asking a PlayStation
         player for a "profile link" is asking for something Sony does not
         give them. */
      const picked = BY_SLUG[state.draft.slug];
      const urlLabel = $('#url-label');

      /* The form is asking two different things depending on the board, so it
         says two different things. A fan filling this in for someone else is
         not claiming a rank, and telling them they are only confuses what
         they came to do. */
      const mTitle = $('#modal-title');
      const mSub = $('#modal-sub');
      /* The clubs, offered rather than spelled from memory. A datalist is a
         suggestion and not a menu -- the browser decides when to drop it --
         which is right here: the fan knows the name and wants the spelling
         agreed, not a list to browse. Detached when the board has no roster,
         so a PSN tag is never autocompleted with the Boston Bruins. */
      setupCascade(state.draft.slug, urlInput);

      if (picked.fan) {
        /* The same question the button asks. "Bid for your favourite party"
           is the phrasing the political boards exist to avoid, and on every
           other fan board it says less than the question does. */
        if (mTitle) mTitle.textContent = 'Who should be #1?';
        // Three things are being asked for here and only one of them is a
        // tag: a club is picked, a player is named, a console player has a
        // gamertag. Saying "tag" to somebody typing Connor McDavid is wrong.
        /* fanNoun already knows what each board calls the thing being bid
           for -- club, player, coin, creator, city, pet -- so this cannot
           drift the way a second hand-written list would. A closed roster is
           picked from a list rather than typed, which is a different verb. */
        const cum = CLOSED_LIST.has(slug)
          ? `Pick the ${fanNoun(slug)}`
          : `Name the ${fanNoun(slug)}`;
        if (mSub) mSub.textContent =
          `${cum}, pick an amount. Pay more than the listing above them and they are above it — the moment the payment clears.`;
      } else {
        if (mTitle) mTitle.textContent = 'Claim my rank';
        if (mSub) mSub.textContent = 'Pick a board, pick an amount. Pay more than the listing above you and you are above it — the moment the payment clears.';
      }
      if (picked.tag) {
        if (urlLabel) urlLabel.textContent = picked.tag.label;
        urlInput.placeholder = picked.tag.hint;
      } else {
        if (urlLabel) urlLabel.textContent = 'Profile link';
        urlInput.placeholder = `https://${picked.hosts[0]}/yourname`;
      }
      // The ladder is per platform, so rebuild it when the platform changes.
      const field = $('#amounts').parentElement;
      field.innerHTML = `<label>Amount</label>${amountBlock(state.draft.slug, 0, null)}`;
      wireAmounts(state.draft.slug, 0, null);
      validate();
    }

    $('#picker').addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (b) applyPlatform(b.dataset.pick);
    });

    // Opened from a board, the platform came with it.
    if (state.draft.slug) applyPlatform(state.draft.slug);

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
        ${shareButtons(shareText, badgeUrl(row.platform, row.handle))}
        <a href="${badge}" data-link>Get the badge</a>
        <a href="/${row.platform}" data-link>Back to the board</a>
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
        const manage = `${location.origin}/${row.platform}#manage=${row.id}:${keyFor(row.id)}`;
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

    /* The brand's own, and no white: this fires over whichever theme the page
       is in, and white confetti on a light page is confetti nobody sees. */
    const colors = ['#fdd321', '#8a1fb2', '#cd6ff0', '#06945a', '#fe2c55'];
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
    /* No @ is forced on. It was, back when every board was a social network
       and every handle was stored with one — and it quietly broke the badge
       for the twenty boards added since, whose handles are names: "Bitcoin"
       became "@Bitcoin" and matched nothing, so a coin's own share link led
       to "not on the board". The handle is returned as the link carries it
       and the lookup below is what tolerates the difference. */
    return { slug, handle };
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

  /* Every place a link can actually be handed to from a web page.
     Instagram, TikTok, YouTube, Twitch and Snapchat are missing on purpose:
     none of them has a web address that opens a composer with a URL in it, so
     a button for them could only ever look like it worked. They are reached
     through the phone's own share sheet instead, added at the end of this row
     when the browser has one. */
  const SHARE_TARGETS = [
    { name: 'X',        url: (t, u) => postOnXUrl(t, u) },
    { name: 'WhatsApp', url: (t, u) => `https://wa.me/?text=${encodeURIComponent(t + ' ' + u)}` },
    { name: 'Telegram', url: (t, u) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}` },
    { name: 'Facebook', url: (t, u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}` },
    { name: 'LinkedIn', url: (t, u) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}` },
    { name: 'Threads',  url: (t, u) => `https://www.threads.net/intent/post?text=${encodeURIComponent(t + ' ' + u)}` },
    { name: 'Reddit',   url: (t, u) => `https://www.reddit.com/submit?url=${encodeURIComponent(u)}&title=${encodeURIComponent(t)}` },
    { name: 'Email',    mail: true,
      url: (t, u) => `mailto:?subject=${encodeURIComponent(t)}&body=${encodeURIComponent(t + '\n\n' + u)}` },
  ];

  /* What the site says about itself when the whole site is what is shared. */
  /* Counted, not written. It said thirty-four while the site had forty-three,
     because a number typed into a sentence is a number nobody updates — and
     this one goes out on every share. */
  const SITE_PITCH = `${PLATFORMS.length} boards, ten places each. Pay more than `
    + 'the person above you. That is the whole algorithm.';

  function shareButtons(text, url, cls) {
    const c = cls ? ` class="${cls}"` : '';
    let html = SHARE_TARGETS.map(t => {
      /* mailto in a new tab leaves an empty one behind once the mail client
         takes over, so only the real web targets get target="_blank". */
      const rest = t.mail ? '' : ' target="_blank" rel="noopener"';
      return `<a${c} href="${esc(t.url(text, url))}"${rest}>${t.name}</a>`;
    }).join('');

    /* Only offered where it exists. A sheet button on a browser without one is
       a button that does nothing, which is worse than not offering it. */
    if (navigator.share) {
      html += `<button${c} data-share-sheet data-text="${esc(text)}" data-url="${esc(url)}">More…</button>`;
    }
    return html;
  }

  /**
   * The badge is the site in one image: the wordmark, the promise, all ten
   * boards, and where this listing stands. Someone seeing it in a timeline has
   * to understand what the place is, not just that a stranger is number one.
   *
   * Everything is inlined, gradient included, because this same markup gets
   * turned into a PNG with no page around it to resolve references against.
   */
  /* The badge carries its own palette, because it leaves the site: it is
     downloaded as a PNG and posted somewhere with no stylesheet. Which is
     also how it came to be the last thing on the site still wearing the old
     black and gold — somebody paid, shared it, and got a card from a design
     that no longer exists anywhere else. Variables cannot reach in here, so
     these values have to be changed by hand whenever the palette moves. */
  function badgeSvg(rank, handle, platformName, color, amount, activeSlug) {
    const SANS = '-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
    const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';

    const SIZE = 26, GAP = 28, START = 40, ROW_Y = 108;

    /* A window of the boards, not all of them. This row was written when
       there were ten: it starts at x=40 and steps 54px, which put the
       thirty-fourth mark at x=1822 on a 600px badge — two dozen marks drawn
       past the right edge, invisible, and the row ending wherever it happened
       to run out of picture.
       
       Nine fit legibly, so nine are drawn, centred on the board being bragged
       about. Shrinking thirty-four into the same space would make every mark
       a smudge, and the badge exists to be read at a glance in somebody
       else's feed. */
    const FIT = 9;
    const at = Math.max(0, PLATFORMS.findIndex(p => p.slug === activeSlug));
    const from = Math.min(Math.max(0, at - (FIT >> 1)), Math.max(0, PLATFORMS.length - FIT));
    const shown = PLATFORMS.slice(from, from + FIT);

    const marks = shown.map((p, i) => {
      const x = START + i * (SIZE + GAP);
      const on = p.slug === activeSlug;
      /* The raw mark, not icon(): this is one flat svg rather than ten nested
         ones. Instagram's gradient therefore has to be pointed at the badge's
         own definition below, or it arrives here as a reference to nothing. */
      const body = (ICONS_FULL[p.slug] || ICONS[p.slug] || '')
        .replace(/currentColor/g, p.color)
        .replace('url(#tt-ig)', 'url(#ttbadgeig)');
      return `<g transform="translate(${x} ${ROW_Y}) scale(${SIZE / 24})" opacity="${on ? 1 : 0.32}">${body}</g>` +
        (on ? `<circle cx="${x + SIZE / 2}" cy="${ROW_Y + SIZE + 9}" r="2.5" fill="${color}"/>` : '');
    }).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 315" width="600" height="315" role="img" aria-label="#${rank} on ${platformName} at TopTen.one">
  <!-- Scoped ids. This markup gets dropped into a live page as well as turned
       into a PNG on its own, and "bg" in a document that has anything else in
       it is a collision waiting to happen. The Instagram gradient is gone from
       here: every icon now brings its own. -->
  <defs>
    <linearGradient id="ttbadgebg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a1b38"/><stop offset="1" stop-color="#140d1c"/>
    </linearGradient>
    <linearGradient id="ttbadgeig" x1="0" y1="1" x2="1" y2="0">${IG_STOPS}</linearGradient>
  </defs>

  <rect width="600" height="315" fill="url(#ttbadgebg)"/>
  <rect x="0" y="0" width="600" height="5" fill="${color}"/>
  <!-- The brand's violet, low and wide, so the card has the site's ground
       under it rather than a neutral black that could belong to anything. -->
  <rect x="0" y="310" width="600" height="5" fill="#8a1fb2"/>

  <text x="40" y="56" font-family="${SANS}" font-size="38" font-weight="800" letter-spacing="-1.4"><tspan fill="#fbf6fd">TopTen</tspan><tspan fill="#cd6ff0">.one</tspan></text>
  <text x="40" y="82" fill="#c3b5cd" font-family="${SANS}" font-size="15" font-weight="600">Who should be #1? ${PLATFORMS.length} boards, ten places each.</text>

  ${marks}

  <line x1="40" y1="162" x2="560" y2="162" stroke="#4c3c63" stroke-width="1"/>

  <text x="40" y="244" fill="#fdd321" font-family="${MONO}" font-size="76" font-weight="800" letter-spacing="-4">#${rank}</text>
  <text x="${rank > 9 ? 200 : 155}" y="222" fill="#fbf6fd" font-family="${SANS}" font-size="27" font-weight="700">${esc(handle)}</text>
  <text x="${rank > 9 ? 200 : 155}" y="248" fill="${color}" font-family="${SANS}" font-size="17" font-weight="600">on ${esc(platformName)}</text>

  <text x="40" y="290" fill="#9a8ba5" font-family="${MONO}" font-size="15">${esc(amount)} paid</text>
  <text x="560" y="290" fill="#9a8ba5" font-family="${SANS}" font-size="15" font-weight="600" text-anchor="end">Pay more than the person above you.</text>
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
    /* Matched with the @ off both sides. Links have been shared with it and
       without it for as long as the badge has existed, and half the boards
       store handles that never had one — neither spelling should be the one
       that fails. */
    const bare = h => String(h || '').replace(/^@/, '').toLowerCase();
    const idx = board(slug).findIndex(r => bare(r.handle) === bare(handle));
    const row = idx >= 0 ? board(slug)[idx] : null;
    const rank = idx >= 0 ? idx + 1 : null;

    document.title = rank ? `#${rank} on ${p.name} — TopTen.one` : `${handle} — TopTen.one`;

    if (!row) {
      view.innerHTML = `<div class="shell center-wrap"><h2>${esc(handle)} is not on the ${esc(p.name)} board</h2>
        <p style="color:var(--muted)">It may have expired, or it was never paid for.</p>
        <div class="share"><a href="/${slug}" data-link>See the board</a></div></div>`;
      return;
    }

    const svg = badgeSvg(rank, row.handle, p.name, p.color, money(row.total_cents), slug);
    const shareText = `${row.handle} is #${rank} on ${p.name}`;
    const shareUrl = badgeUrl(slug, row.handle);

    view.innerHTML = `<div class="shell badgewrap">
      <button class="badgeclose" id="badge-close" aria-label="Close">&times;</button>
      <div class="badgecard" id="badgecard">${svg}</div>
      <div class="share">
        ${shareButtons(shareText, shareUrl)}
        <button id="dl">Download PNG</button>
        <button id="copy">Copy link</button>
        <a href="/${slug}" data-link>See the board</a>
      </div>
      <p class="finelist" style="max-width:40ch;margin:16px auto 0;text-align:center">
        X shows the link, not the picture. Download the PNG and attach it to the
        post if you want the badge itself in the timeline.
      </p>
    </div>`;

    /* Back to wherever this was opened from, which is normally the listing on
       its board. A badge link shared to someone who has never been here has no
       history to go back to, so that lands on the board instead. */
    $('#badge-close').addEventListener('click', () => {
      if (history.length > 1) history.back(); else navigate(`/${slug}`);
    });
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

    // /tiktok and /?p=tiktok reach the same board. The path form is what the
    // tabs write, what the sitemap lists and what each generated page declares
    // canonical, because a query string served byte-identical HTML for all ten
    // platforms and Google folded them into a single indexed page. The query
    // form still works: links shared before this change must not break.
    const fromPath = path.slice(1);
    const p = BY_SLUG[fromPath] ? fromPath : new URLSearchParams(location.search).get('p');
    /* The address decides what is open: /tiktok opens TikTok, / opens nothing. */
    const open = p && BY_SLUG[p] ? p : null;
    if (open) state.platform = open;
    /* Drawn first, filled in after. The table is the page; making a ranking
       wait on a picture file would be the wrong way round. Where a fetch is
       needed the rows redraw once it lands, and where it is not — which is
       most board pages — nothing is fetched and nothing redraws. */
    renderHome(open);
    /* The strip is drawn from the same pictures the table is, and it is drawn
       first -- before the coin logos and the photographs have arrived. Without
       this it keeps whatever it had at that moment, which is mostly initials. */
    artFor(open).then(nevoie => {
      if (!nevoie) return;
      fillTicker();
      if (state.platform === open) refreshBoard();
    });
  }

  function navigate(href) {
    /* A modal is a layer over the page, and the page is about to change under it.
       Anything opened from inside one -- the badge above all -- would render
       behind it and read as nothing having happened at all. */
    if (!modal.hidden) closeModal();
    history.pushState({}, '', href);
    route();
    scrollTo({ top: 0, behavior: 'instant' });
  }

  /* The theme. The head has already applied whichever one is in force before
     the first paint; all this does is flip it and remember the choice, so a
     visitor who wants the dark table gets it on every later visit too. The
     stored value is a deliberate choice and outranks the system setting --
     somebody on a dark laptop who asked for the light table meant it. */
  function toggleTheme() {
    const now = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = now;
    try { localStorage.setItem('topten_theme', now); } catch (e) { /* private mode */ }
  }

  /* The row is the target now, so it answers the keyboard like one. Hiding
     the Details button below 1200px to buy the table some width had quietly
     taken away the only way into a listing on a laptop, a tablet or a phone —
     the tagline, the link, the share, the badge and the edit button, all
     unreachable, on most of the screens the site is read on. */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target instanceof Element && e.target.closest('tr[data-open]');
    if (!row || e.target.closest('a, button')) return;
    e.preventDefault();
    const r = Object.values(state.boards).flat().find(x => x.id === row.dataset.open);
    if (r) listingModal(r);
  });

  addEventListener('popstate', route);

  document.addEventListener('click', e => {
    const link = e.target.closest('a[data-link]');
    if (link && link.origin === location.origin) {
      e.preventDefault();
      navigate(link.getAttribute('href'));
      return;
    }
    if (e.target.closest('[data-close]')) { closeModal(); return; }
    if (e.target.closest('#themer')) { toggleTheme(); return; }

    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const row = Object.values(state.boards).flat().find(r => r.id === edit.dataset.edit);
      if (row) editModal(row);
      return;
    }

    /* The whole row opens the listing, so anything inside it that has its own
       job has to say so first. Add is the one that matters: it is on top of a
       row that also carries data-open, and without this guard tapping it
       opened the listing card instead of taking the payment — the click that
       exists to take money, answered with a page about the money. */
    const open = e.target.closest('a, [data-add], [data-claim], [data-edit], [data-share-copy], [data-close]')
      ? null
      : e.target.closest('[data-open]');
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

  document.addEventListener('click', async e => {
    const sheet = e.target.closest('[data-share-sheet]');
    if (sheet) {
      e.preventDefault();
      /* The only route to Instagram, TikTok, Snapchat, YouTube and Twitch, none
         of which can be linked into from a page. Cancelling the sheet rejects,
         and a person changing their mind is not an error. */
      try { await navigator.share({ text: sheet.dataset.text, url: sheet.dataset.url }); } catch {}
      return;
    }

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
  /* ----------------------------------------------------------- visitors */

  /* The masthead used to show who was connected this second. On a board that
     is still filling up that is one person, and it reads as an empty room --
     a true number arguing against the site it sits on. This counts distinct
     browsers instead: a row per visit, one visitor per browser however often
     they come back.

     anon may write to site_visits and may never read it. site_visitors() is
     the only way a number comes back out, and it is only ever a count. */

  function visitorId() {
    let id = null;
    try { id = localStorage.getItem('topten_sid'); } catch (e) {}
    if (!id) {
      id = uuid();
      try { localStorage.setItem('topten_sid', id); } catch (e) {}
    }
    return id;
  }

  /* Path only. A board link carries the platform and nothing private, but a
     manage link carries its edit token in the query string, and analytics is
     not a place to write down credentials. */
  /* The address as it arrived, query string and all.
     
     This used to return pathname alone, which threw away everything after the
     "?" -- including gclid and gad_campaignid, the two markers that say a
     visit was bought. Every ad click was therefore filed as an ordinary visit
     to "/", and the money spent on Google Ads left no trace on this side at
     all: campaigns could run for weeks with nothing here able to say which of
     them, or which country, any visitor came from.

     Sensitive names are dropped rather than the whole query, so a token that
     ever does travel in a URL is not written into a table that keeps rows
     forever. The edit token arrives in the hash today, which never reaches
     the server and is not in location.search -- this is the guard for the day
     that stops being true. */
  const STRIPPED_PARAMS = [
    'token', 'edit_token', 'code', 'access_token', 'refresh_token',
    'secret', 'password', 'otp', 'token_hash'
  ];
  function visitPath() {
    try {
      const u = new URL(location.href);
      STRIPPED_PARAMS.forEach(k => u.searchParams.delete(k));
      return (u.pathname || '/') + (u.search || '');
    } catch (e) { return '/'; }
  }

  /* The country, from Cloudflare's own endpoint on this origin.

     No third-party geolocation service: the site already sits behind
     Cloudflare, /cdn-cgi/trace answers with the country of this very request,
     and nothing about the visitor is sent to anybody else. Cached for the tab.

     The column has existed since site_visits was created and nothing has ever
     written it, so every row reads NULL -- which is why "where is the traffic
     coming from" had no answer here. */
  let geoCache = null;
  async function detectCountry() {
    if (geoCache !== null) return geoCache;
    try {
      const stored = sessionStorage.getItem('topten:cc');
      if (stored) { geoCache = stored; return stored; }
    } catch (e) { /* storage denied */ }
    try {
      const res = await fetch('/cdn-cgi/trace', { cache: 'no-store' });
      const text = res.ok ? await res.text() : '';
      const m = /(?:^|\n)loc=([A-Z]{2})/.exec(text);
      geoCache = m ? m[1] : '';
      try { if (geoCache) sessionStorage.setItem('topten:cc', geoCache); } catch (e) {}
    } catch (e) { geoCache = ''; }
    return geoCache;
  }

  async function recordVisit() {
    if (!sb) return;
    try {
      // The country is looked up first but never allowed to hold the visit
      // up: detectCountry() resolves to '' rather than throwing, so a blocked
      // /cdn-cgi/trace costs the country and nothing else.
      const country = await detectCountry();
      await sb.from('site_visits').insert({
        path: visitPath(),
        referrer: document.referrer || null,
        language: navigator.language || null,
        country: country || null,
        session_id: visitorId()
      });
    } catch (e) { /* a visit that will not write is not worth a broken page */ }
  }

  async function loadVisitors() {
    if (!sb) return;
    try {
      const { data, error } = await sb.rpc('site_visitors');
      if (error || typeof data !== 'number') return;
      state.visitors = data;
      // Patch the rendered stat in place rather than redrawing the board:
      // the count lands after the first paint and nothing else has changed.
      const el = document.querySelector('.stat--count .stat__v');
      if (el) el.textContent = state.visitors.toLocaleString();
    } catch (e) {}
  }

  /* Who is here this minute, back beside the visitor total. site_pulse()
     writes the heartbeat and returns the count in one call, so a browser that
     asks is also counted. It stays quiet while the tab is hidden: forty
     background tabs are not forty people, and the number has to mean what it
     says. Same id as the visit row, so one browser is one of each. */
  async function pulse() {
    if (!sb || document.hidden) return;
    try {
      const { data, error } = await sb.rpc('site_pulse', { p_session: visitorId() });
      if (error || typeof data !== 'number') return;
      state.online = data;
      const el = document.querySelector('.stat--online .stat__v');
      if (el) el.textContent = state.online.toLocaleString();
    } catch (e) {}
  }

  /* ------------------------------------------------------ live plumbing */

  /* A payment that lands on a board nothing on the page needed a picture
     for -- the first coin, the first billionaire -- brings its own need with
     it, so the pictures are asked for again before the strip is redrawn.
     Everything already in memory answers at once. */
  const refresh = debounce(async () => {
    await loadBoards();
    await artFor(state.platform);
    fillTicker();
    if (!modal.hidden) return;
    refreshBoard();
  }, 450);

  function subscribe() {
    if (!sb) return;
    sb.channel('listings-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, refresh)
      .subscribe();
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
    // Written first, read second, so a visitor is counted in the number they
    // are shown rather than seeing the figure from just before they arrived.
    recordVisit().then(loadVisitors);
    // A heartbeat expires after 90s, so beat well inside that. A tab brought
    // back to the front should not wait 45s to be counted again -- by then its
    // own beat has already lapsed.
    pulse();
    setInterval(pulse, 45000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pulse(); });
    // Expired listings drop off silently, so re-read on a slow timer too.
    setInterval(() => { if (modal.hidden && document.visibilityState === 'visible') refresh(); }, 60000);
  })();

  // Exposed for the verification checklist.
  window.TopTen = { parseProfile, nextDollarAbove, clampMin, rankFor, money, PLATFORMS, state };
})();
