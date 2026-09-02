#!/usr/bin/env node
/**
 * The suggestion list each board offers when you open its claim form.
 *
 * What this is: spelling and discovery. Somebody arriving at the Football
 * Clubs board should not have to know whether it is "Bayern Munich" or "FC
 * Bayern München" before they can pay, and one club should be one row rather
 * than three spellings of it. That is the same job the NBA roster already
 * does, minus the veto — these lists are open, and typing a name that is not
 * on one is allowed and expected.
 *
 * What this is NOT: a ranking, a top 30, or a claim that these are the
 * biggest. The board itself decides who is biggest, by what was paid. A list
 * that claimed otherwise would be competing with the product.
 *
 * Which boards get one: the ones where you bid for somebody else. A board
 * where you list yourself — your own X profile, your own gamertag, your own
 * restaurant, your own dog — gets no list, because a menu of other people's
 * names there is an invitation to list something that is not yours.
 *
 *   node scripts/rosters.mjs        # write rosters.json
 *   node scripts/rosters.mjs --check
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'rosters.json');

/* [name, the mark shown in the little circle, its ink, its trim] — the same
   four fields the club rosters use, so the cascade needs nothing new. */
const V = '#7c349a', G = '#fdd321', W = '#ffffff', D = '#1e1923';

const R = {
  'football-clubs': [
    ['Real Madrid','RMA','#febe10',D], ['FC Barcelona','BAR','#a50044',W],
    ['Manchester United','MUN','#da020e',W], ['Liverpool','LIV','#c8102e',W],
    ['Manchester City','MCI','#6cabdd',D], ['Arsenal','ARS','#ef0107',W],
    ['Chelsea','CHE','#034694',W], ['Tottenham Hotspur','TOT','#132257',W],
    ['Bayern Munich','BAY','#dc052d',W], ['Borussia Dortmund','BVB','#fde100',D],
    ['Juventus','JUV',D,W], ['Inter Milan','INT','#0068a8',W],
    ['AC Milan','MIL','#fb090b',W], ['Napoli','NAP','#12a0d7',W],
    ['Paris Saint-Germain','PSG','#004170',W], ['Olympique de Marseille','OM','#2faee0',W],
    ['Atletico Madrid','ATM','#cb3524',W], ['Sevilla','SEV','#d9042b',W],
    ['Ajax','AJA','#d2122e',W], ['Benfica','BEN','#e00000',W],
    ['FC Porto','POR','#00428c',W], ['Celtic','CEL','#018749',W],
    ['Galatasaray','GAL','#a90432',G], ['Fenerbahce','FEN','#164194',G],
    ['Boca Juniors','BOC','#004a98',G], ['River Plate','RIV','#e10600',W],
    ['Flamengo','FLA','#e2231a',D], ['Al Hilal','HIL','#0067b1',W],
    ['Steaua Bucuresti','FCSB','#0033a0',G], ['Dinamo Bucuresti','DIN','#d4111e',W],
  ],
  'football-players': [
    ['Lionel Messi','LM'], ['Cristiano Ronaldo','CR'], ['Kylian Mbappe','KM'],
    ['Erling Haaland','EH'], ['Vinicius Junior','VJ'], ['Jude Bellingham','JB'],
    ['Neymar','NJ'], ['Mohamed Salah','MS'], ['Kevin De Bruyne','KDB'],
    ['Robert Lewandowski','RL'], ['Harry Kane','HK'], ['Luka Modric','LM'],
    ['Rodri','RO'], ['Lamine Yamal','LY'], ['Bukayo Saka','BS'],
    ['Phil Foden','PF'], ['Federico Valverde','FV'], ['Antoine Griezmann','AG'],
    ['Lautaro Martinez','LM'], ['Victor Osimhen','VO'], ['Son Heung-min','SH'],
    ['Virgil van Dijk','VVD'], ['Alisson Becker','AB'], ['Thibaut Courtois','TC'],
    ['Pedri','PE'], ['Gavi','GA'], ['Jamal Musiala','JM'], ['Florian Wirtz','FW'],
    ['Nicolae Stanciu','NS'], ['Ianis Hagi','IH'],
  ],
  'f1-drivers': [
    ['Max Verstappen','VER'], ['Lewis Hamilton','HAM'], ['Charles Leclerc','LEC'],
    ['Lando Norris','NOR'], ['Oscar Piastri','PIA'], ['George Russell','RUS'],
    ['Carlos Sainz','SAI'], ['Fernando Alonso','ALO'], ['Sergio Perez','PER'],
    ['Pierre Gasly','GAS'], ['Esteban Ocon','OCO'], ['Alexander Albon','ALB'],
    ['Yuki Tsunoda','TSU'], ['Nico Hulkenberg','HUL'], ['Lance Stroll','STR'],
    ['Kevin Magnussen','MAG'], ['Valtteri Bottas','BOT'], ['Zhou Guanyu','ZHO'],
    ['Logan Sargeant','SAR'], ['Daniel Ricciardo','RIC'], ['Oliver Bearman','BEA'],
    ['Franco Colapinto','COL'], ['Liam Lawson','LAW'], ['Kimi Antonelli','ANT'],
    ['Sebastian Vettel','VET'], ['Michael Schumacher','MSC'], ['Ayrton Senna','SEN'],
    ['Niki Lauda','LAU'], ['Alain Prost','PRO'], ['Kimi Raikkonen','RAI'],
  ],
  artists: [
    ['Taylor Swift','TS'], ['Beyonce','BE'], ['Drake','DR'], ['The Weeknd','TW'],
    ['Bad Bunny','BB'], ['Billie Eilish','BE'], ['Ed Sheeran','ES'], ['Adele','AD'],
    ['Rihanna','RI'], ['Kendrick Lamar','KL'], ['Ariana Grande','AG'],
    ['Dua Lipa','DL'], ['Bruno Mars','BM'], ['Post Malone','PM'], ['SZA','SZ'],
    ['Coldplay','CP'], ['Metallica','MT'], ['Queen','QU'], ['Pink Floyd','PF'],
    ['The Beatles','TB'], ['Led Zeppelin','LZ'], ['Fleetwood Mac','FM'],
    ['Daft Punk','DP'], ['Radiohead','RH'], ['Nirvana','NI'], ['AC/DC','AC'],
    ['BTS','BT'], ['Blackpink','BP'], ['Inna','IN'], ['Smiley','SM'],
  ],
  games: [
    ['Minecraft','MC'], ['Fortnite','FN'], ['Grand Theft Auto V','GTA'],
    ['Roblox','RB'], ['Counter-Strike 2','CS'], ['League of Legends','LOL'],
    ['Valorant','VAL'], ['Dota 2','DT'], ['Call of Duty','COD'],
    ['Elden Ring','ER'], ['The Witcher 3','W3'], ['Cyberpunk 2077','CP'],
    ['Red Dead Redemption 2','RDR'], ['The Legend of Zelda','ZL'],
    ['Super Mario Bros','SMB'], ['Baldurs Gate 3','BG3'], ['Hollow Knight','HK'],
    ['Stardew Valley','SV'], ['Terraria','TR'], ['Among Us','AU'],
    ['Apex Legends','APX'], ['Overwatch 2','OW'], ['Rocket League','RL'],
    ['FIFA','FI'], ['EA Sports FC','FC'], ['Diablo IV','D4'],
    ['World of Warcraft','WOW'], ['Genshin Impact','GI'], ['PUBG','PU'],
    ['Helldivers 2','HD2'],
  ],
  cities: [
    ['Tokyo','TK'], ['New York','NY'], ['London','LDN'], ['Paris','PAR'],
    ['Dubai','DXB'], ['Singapore','SG'], ['Hong Kong','HK'], ['Seoul','SEL'],
    ['Shanghai','SHA'], ['Los Angeles','LA'], ['Barcelona','BCN'], ['Rome','ROM'],
    ['Madrid','MAD'], ['Berlin','BER'], ['Amsterdam','AMS'], ['Lisbon','LIS'],
    ['Vienna','VIE'], ['Prague','PRG'], ['Zurich','ZRH'], ['Geneva','GVA'],
    ['Istanbul','IST'], ['Milan','MIL'], ['Munich','MUC'], ['Copenhagen','CPH'],
    ['Stockholm','STO'], ['Sydney','SYD'], ['Toronto','TOR'], ['Bucharest','BUC'],
    ['Cluj-Napoca','CLJ'], ['Timisoara','TSR'],
  ],
  podcasts: [
    ['The Joe Rogan Experience','JRE'], ['The Daily','TD'], ['Huberman Lab','HL'],
    ['Lex Fridman Podcast','LF'], ['SmartLess','SL'], ['Call Her Daddy','CHD'],
    ['Crime Junkie','CJ'], ['This American Life','TAL'], ['Serial','SE'],
    ['Radiolab','RL'], ['Planet Money','PM'], ['Hardcore History','HH'],
    ['Freakonomics Radio','FR'], ['Stuff You Should Know','SYSK'],
    ['The Diary Of A CEO','DOAC'], ['My First Million','MFM'],
    ['Acquired','AQ'], ['The Tim Ferriss Show','TFS'], ['a16z Podcast','A16'],
    ['Darknet Diaries','DD'], ['99% Invisible','99'], ['Reply All','RA'],
    ['The Rest Is History','TRIH'], ['The Rest Is Politics','TRIP'],
    ['Modern Wisdom','MW'], ['Diary of a Founder','DOF'],
  ],
};

/* The influencer boards take a handle, not a name, so the list carries the
   handle exactly as it is typed into the field. */
const H = {
  'x-influencers': [
    '@elonmusk','@BarackObama','@justinbieber','@Cristiano','@rihanna',
    '@katyperry','@taylorswift13','@ladygaga','@narendramodi','@realDonaldTrump',
    '@ArianaGrande','@KimKardashian','@selenagomez','@jtimberlake','@BillGates',
    '@neymarjr','@britneyspears','@shakira','@KingJames','@ddlovato',
    '@MrBeast','@nasa','@BBCBreaking','@CNN','@espn','@NBA','@FIFAcom',
    '@sundarpichai','@tim_cook','@supportrotabo',
  ],
  'tiktok-influencers': [
    '@khaby.lame','@charlidamelio','@mrbeast','@bellapoarch','@addisonre',
    '@zachking','@kimberly.loaiza','@tiktok','@cznburak','@dominik',
    '@willsmith','@selenagomez','@jasoncoffee','@spencerx','@lorengray',
    '@dixiedamelio','@babyariel','@michaelle','@therock','@justmaiko',
    '@brentrivera','@avani','@jamescharles','@riyaz.14','@nishaguragain',
    '@gilmhercroes','@joealbanese','@aliaaaaaaaaa','@faouzia','@rotaboapp',
  ],
  'youtube-influencers': [
    '@MrBeast','@tseries','@CocomelonNurseryRhymes','@SETIndia','@KidsDianaShow',
    '@LikeNastyaofficial','@VladandNiki','@ZeeTV','@PewDiePie','@WWE',
    '@5MinuteCraftsYouTube','@SonyMusicIndiaVEVO','@Kurzgesagt','@veritasium',
    '@mkbhd','@LinusTechTips','@markiplier','@jacksepticeye','@dude_perfect',
    '@sidemen','@Fireship','@ThePrimeagen','@theodd1sout','@Vsauce',
    '@NileRed','@SmarterEveryDay','@mrwhosetheboss','@AliAbdaal',
    '@ColinFurze','@rotaboapp',
  ],
  'facebook-influencers': [
    '@leomessi','@Cristiano','@shakira','@vindiesel','@willsmith',
    '@justinbieber','@eminem','@rihanna','@KatyPerry','@ladygaga',
    '@michaeljackson','@Beyonce','@taylorswift','@RealMadrid','@fcbarcelona',
    '@manchesterunited','@ChampionsLeague','@NBA','@9GAG','@LADbible',
    '@natgeo','@BBCNews','@CNN','@TED','@NASA','@UNICEF',
    '@Netflix','@Spotify','@Airbnb','@rotabo.app',
  ],
};

const out = {};
for (const [slug, list] of Object.entries(R)) {
  out[slug] = list.map(row => row.length === 4 ? row : [row[0], row[1], V, W]);
}
for (const [slug, list] of Object.entries(H)) {
  out[slug] = list.map(h => [h, h.replace(/^@/, '').slice(0, 2).toUpperCase(), V, W]);
}

const json = JSON.stringify(out);

if (process.argv.includes('--check')) {
  if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== json) {
    console.error('rosters: rosters.json is missing or stale. Run: node scripts/rosters.mjs');
    process.exit(1);
  }
  console.log(`rosters: ${Object.keys(out).length} boards, current.`);
  process.exit(0);
}

writeFileSync(OUT, json);
const n = Object.values(out).reduce((a, l) => a + l.length, 0);
console.log(`rosters: ${Object.keys(out).length} boards, ${n} names, ${(json.length / 1024).toFixed(0)} KB`);
for (const [k, v] of Object.entries(out)) console.log(`  ${k.padEnd(22)} ${v.length}`);
