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

/* The NBA and NHL player lists are not written here. They come from the
   leagues' own numbers, fetched by scripts/build-sport-rosters.mjs -- fifty
   names each, at the clubs they actually play for. Ten names typed by hand
   is what they were, and a typed roster is wrong the season after a trade
   without anybody noticing. */
const SPORT = join(root, 'scripts/sport-rosters.json');

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
    ['Atlético Madrid','ATM','#cb3524',W], ['Sevilla','SEV','#d9042b',W],
    ['Ajax','AJA','#d2122e',W], ['Benfica','BEN','#e00000',W],
    ['FC Porto','POR','#00428c',W], ['Celtic','CEL','#018749',W],
    ['Galatasaray','GAL','#a90432',G], ['Fenerbahçe','FEN','#164194',G],
    ['Boca Juniors','BOC','#004a98',G], ['River Plate','RIV','#e10600',W],
    ['Flamengo','FLA','#e2231a',D], ['Al Hilal','HIL','#0067b1',W],
    ['FCSB','FCSB','#0033a0',G], ['Dinamo București','DIN','#d4111e',W],
  ],
  'football-players': [
    ['Lionel Messi','LM'], ['Cristiano Ronaldo','CR'], ['Kylian Mbappé','KM'],
    ['Erling Haaland','EH'], ['Vinícius Júnior','VJ'], ['Jude Bellingham','JB'],
    ['Neymar','NJ'], ['Mohamed Salah','MS'], ['Kevin De Bruyne','KDB'],
    ['Robert Lewandowski','RL'], ['Harry Kane','HK'], ['Luka Modrić','LM'],
    ['Rodri','RO'], ['Lamine Yamal','LY'], ['Bukayo Saka','BS'],
    ['Phil Foden','PF'], ['Federico Valverde','FV'], ['Antoine Griezmann','AG'],
    ['Lautaro Martínez','LM'], ['Victor Osimhen','VO'], ['Son Heung-min','SH'],
    ['Virgil van Dijk','VVD'], ['Alisson Becker','AB'], ['Thibaut Courtois','TC'],
    ['Pedri','PE'], ['Gavi','GA'], ['Jamal Musiala','JM'], ['Florian Wirtz','FW'],
    ['Nicolae Stanciu','NS'], ['Ianis Hagi','IH'],
  ],
  'f1-drivers': [
    ['Max Verstappen','VER'], ['Lewis Hamilton','HAM'], ['Charles Leclerc','LEC'],
    ['Lando Norris','NOR'], ['Oscar Piastri','PIA'], ['George Russell','RUS'],
    ['Carlos Sainz Jr.','SAI'], ['Fernando Alonso','ALO'], ['Sergio Pérez','PER'],
    ['Pierre Gasly','GAS'], ['Esteban Ocon','OCO'], ['Alex Albon','ALB'],
    ['Yuki Tsunoda','TSU'], ['Nico Hülkenberg','HUL'], ['Lance Stroll','STR'],
    ['Kevin Magnussen','MAG'], ['Valtteri Bottas','BOT'], ['Zhou Guanyu','ZHO'],
    ['Logan Sargeant','SAR'], ['Daniel Ricciardo','RIC'], ['Oliver Bearman','BEA'],
    ['Franco Colapinto','COL'], ['Liam Lawson','LAW'], ['Kimi Antonelli','ANT'],
    ['Sebastian Vettel','VET'], ['Michael Schumacher','MSC'], ['Ayrton Senna','SEN'],
    ['Niki Lauda','LAU'], ['Alain Prost','PRO'], ['Kimi Räikkönen','RAI'],
  ],
  artists: [
    ['Taylor Swift','TS'], ['Beyoncé','BE'], ['Drake','DR'], ['The Weeknd','TW'],
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
    ['Elden Ring','ER'], ['The Witcher 3: Wild Hunt','W3'], ['Cyberpunk 2077','CP'],
    ['Red Dead Redemption 2','RDR'], ['The Legend of Zelda','ZL'],
    ['Super Mario Bros.','SMB'], ["Baldur's Gate 3",'BG3'], ['Hollow Knight','HK'],
    ['Stardew Valley','SV'], ['Terraria','TR'], ['Among Us','AU'],
    ['Apex Legends','APX'], ['Overwatch 2','OW'], ['Rocket League','RL'],
    ['FIFA','FI'], ['EA Sports FC','FC'], ['Diablo IV','D4'],
    ['World of Warcraft','WOW'], ['Genshin Impact','GI'], ['PUBG: Battlegrounds','PU'],
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
    ['Cluj-Napoca','CLJ'], ['Timișoara','TSR'],
  ],
  actors: [
    ['Meryl Streep','MS'], ['Denzel Washington','DW'], ['Tom Hanks','TH'],
    ['Leonardo DiCaprio','LD'], ['Cate Blanchett','CB'], ['Robert De Niro','RD'],
    ['Al Pacino','AP'], ['Anthony Hopkins','AH'], ['Morgan Freeman','MF'],
    ['Viola Davis','VD'], ['Frances McDormand','FM'], ['Daniel Day-Lewis','DDL'],
    ['Joaquin Phoenix','JP'], ['Christian Bale','CB'], ['Gary Oldman','GO'],
    ['Nicole Kidman','NK'], ['Charlize Theron','CT'], ['Jodie Foster','JF'],
    ['Emma Stone','ES'], ['Margot Robbie','MR'], ['Ryan Gosling','RG'],
    ['Brad Pitt','BP'], ['Keanu Reeves','KR'], ['Tom Cruise','TC'],
    ['Samuel L. Jackson','SLJ'], ['Michael Caine','MC'], ['Helen Mirren','HM'],
    ['Kate Winslet','KW'], ['Willem Dafoe','WD'], ['Mads Mikkelsen','MM'],
  ],
  movies: [
    ['The Godfather','GF'], ['The Shawshank Redemption','SR'], ['Pulp Fiction','PF'],
    ["Schindler's List",'SL'], ['12 Angry Men','12'], ['The Dark Knight','DK'],
    ['Goodfellas','GL'], ['Fight Club','FC'], ['Forrest Gump','FG'],
    ['The Matrix','MX'], ['Inception','IN'], ['Interstellar','IS'],
    ['Parasite (2019 film)','PA'], ['Spirited Away','SA'], ['Seven Samurai','7S'],
    ['Apocalypse Now','AN'], ['Taxi Driver','TD'], ['Blade Runner','BR'],
    ['Alien','AL'], ['Jaws','JW'], ['Casablanca','CA'], ['Citizen Kane','CK'],
    ['2001: A Space Odyssey','01'], ['Star Wars','SW'], ['Jurassic Park','JP'],
    ['Back to the Future','BF'], ['The Lord of the Rings','LR'], ['Whiplash','WH'],
    ['La La Land','LL'], ['Everything Everywhere All at Once','EE'],
  ],
  cars: [
    ['Ferrari','FE'], ['Lamborghini','LA'], ['Porsche','PO'], ['Bugatti','BU'],
    ['McLaren','MC'], ['Aston Martin','AM'], ['Rolls-Royce','RR'], ['Bentley','BE'],
    ['Mercedes-Benz','MB'], ['BMW','BM'], ['Audi','AU'], ['Volkswagen','VW'],
    ['Toyota','TO'], ['Honda','HO'], ['Nissan','NI'], ['Mazda','MA'],
    ['Subaru','SU'], ['Ford','FO'], ['Chevrolet','CH'], ['Dodge','DO'],
    ['Jeep','JE'], ['Land Rover','LR'], ['Jaguar','JA'], ['Volvo','VO'],
    ['Tesla','TE'], ['Lotus','LO'], ['Alfa Romeo','AR'], ['Maserati','MS'],
    ['Koenigsegg','KO'], ['Dacia','DA'],
  ],
  boats: [
    ['Azimut','AZ'], ['Sunseeker','SS'], ['Ferretti','FR'], ['Riva','RI'],
    ['Benetti','BN'], ['Feadship','FD'], ['Lurssen','LU'], ['Oceanco','OC'],
    ['Heesen','HE'], ['Amels','AM'], ['Pershing','PE'], ['Princess','PR'],
    ['Fairline','FA'], ['Beneteau','BT'], ['Jeanneau','JN'], ['Bavaria','BV'],
    ['Hallberg-Rassy','HR'], ['Nautor Swan','NS'], ['Wally','WA'],
    ['Sanlorenzo','SL'], ['Baglietto','BG'], ['Custom Line','CL'],
    ['Boston Whaler','BW'], ['Zodiac','ZO'], ['Axopar','AX'], ['Brabus Marine','BR'],
    ['Sealine','SE'], ['Galeon','GA'], ['Absolute','AB'], ['Cranchi','CR'],
  ],
  /* Startups take a name, the same as Cities does, and had no list where
     Cities has thirty. That is the inconsistency: the argument for a list is
     spelling before it is discovery, and it applies here hardest of all --
     SpaceX, Space X and spacex are three rows for one company, and the board
     is meant to have one row per thing.

     Well known, not biggest. Which of these is worth most is what the board
     itself decides, and anyone can type a name that is not here. */
  'startups': [
    ['OpenAI','OA'], ['Anthropic','AN'], ['SpaceX','SX'],
    ['xAI','XA'], ['Stripe','ST'], ['Databricks','DB'],
    ['Canva','CA'], ['Revolut','RV'], ['Notion','NO'],
    ['Discord','DC'], ['Epic Games','EG'], ['ByteDance','BD'],
    ['Shein','SH'], ['Klarna','KL'], ['Rippling','RP'],
    ['Deel','DE'], ['Ramp','RA'], ['Anduril','AD'],
    ['Scale AI','SC'], ['Perplexity','PX'], ['Mistral AI','MI'],
    ['Figma','FI'], ['Grammarly','GR'], ['Monzo','MZ'],
    ['N26','N2'], ['Bolt','BO'], ['Checkout.com','CO'],
    ['Celonis','CE'], ['Personio','PE'], ['Vinted','VI'],
  ],
  /* Three fighting boards, three different questions.

     The UFC list is who is on top of that promotion. The MMA list is the
     sport, which is older and wider than one company -- Fedor never signed
     with them and a list of mixed martial arts without him would be a list
     about contracts. Boxing shares nothing with either but a ring.

     A few names are on two of them, and should be: being the best in the UFC
     and among the best there has ever been are two separate claims, and the
     boards let people argue them separately. */
  'ufc-fighters': [
    ['Jon Jones','JJ'], ['Islam Makhachev','IM'], ['Alex Pereira','AP'],
    ['Ilia Topuria','IT'], ['Dricus du Plessis','DP'], ["Sean O'Malley",'SO'],
    ['Merab Dvalishvili','MD'], ['Alexander Volkanovski','AV'], ['Tom Aspinall','TA'],
    ['Charles Oliveira','CO'], ['Max Holloway','MH'], ['Justin Gaethje','JG'],
    ['Dustin Poirier','DP'], ['Conor McGregor','CM'], ['Israel Adesanya','IA'],
    ['Kamaru Usman','KU'], ['Leon Edwards','LE'], ['Belal Muhammad','BM'],
    ['Sean Strickland','SS'], ['Robert Whittaker','RW'], ['Petr Yan','PY'],
    ['Aljamain Sterling','AS'], ['Amanda Nunes','AN'], ['Valentina Shevchenko','VS'],
    ['Zhang Weili','ZW'], ['Rose Namajunas','RN'], ['Alexa Grasso','AG'],
    ['Stipe Miocic','SM'], ['Daniel Cormier','DC'], ['Paddy Pimblett','PP'],
  ],
  'mma-fighters': [
    ['Fedor Emelianenko','FE'], ['Georges St-Pierre','GS'], ['Anderson Silva','AS'],
    ['Khabib Nurmagomedov','KN'], ['Demetrious Johnson','DJ'], ['Cris Cyborg','CC'],
    ['Ronda Rousey','RR'], ['BJ Penn','BP'], ['Chuck Liddell','CL'],
    ['Randy Couture','RC'], ['Wanderlei Silva','WS'], ['Mirko Cro Cop','MC'],
    ['Kazushi Sakuraba','KS'], ['Dan Henderson','DH'], ['Cain Velasquez','CV'],
    ['Jose Aldo','JA'], ['Frankie Edgar','FE'], ['Tito Ortiz','TO'],
    ['Matt Hughes','MH'], ['Rich Franklin','RF'], ['Urijah Faber','UF'],
    ['Nick Diaz','ND'], ['Nate Diaz','NA'], ['Michael Bisping','MB'],
    ['Junior dos Santos','JS'], ['Alistair Overeem','AO'], ['Francis Ngannou','FN'],
    ['Eddie Alvarez','EA'], ['Patricio Freire','PF'], ['Rory MacDonald','RM'],
  ],
  'boxers': [
    ['Muhammad Ali','MA'], ['Mike Tyson','MT'], ['Sugar Ray Robinson','SR'],
    ['Floyd Mayweather','FM'], ['Manny Pacquiao','MP'], ['Joe Louis','JL'],
    ['Rocky Marciano','RM'], ['Jack Dempsey','JD'], ['George Foreman','GF'],
    ['Lennox Lewis','LL'], ['Evander Holyfield','EH'], ['Roberto Duran','RD'],
    ['Marvin Hagler','MH'], ['Thomas Hearns','TH'], ['Sugar Ray Leonard','SL'],
    ['Julio Cesar Chavez','JC'], ['Oscar De La Hoya','OD'], ['Bernard Hopkins','BH'],
    ['Wladimir Klitschko','WK'], ['Vitali Klitschko','VK'], ['Canelo Alvarez','CA'],
    ['Tyson Fury','TF'], ['Anthony Joshua','AJ'], ['Oleksandr Usyk','OU'],
    ['Naoya Inoue','NI'], ['Terence Crawford','TC'], ['Gennadiy Golovkin','GG'],
    ['Deontay Wilder','DW'], ['Larry Holmes','LH'], ['Henry Armstrong','HA'],
  ],
  /* The three promotions that are not the UFC. Rosters move faster here than
     anywhere else on this site -- Bellator was folded into the PFL, fighters
     cross between all three -- so these are the names the promotion is known
     by rather than a claim about who is under contract this week. Anyone can
     type a name that is not on the list. */
  'bellator': [
    ['Patricio Freire','PF'], ['Ryan Bader','RB'], ['Vadim Nemkov','VN'],
    ['AJ McKee','AM'], ['Michael Chandler','MC'], ['Douglas Lima','DL'],
    ['Cris Cyborg','CC'], ['Yaroslav Amosov','YA'], ['Corey Anderson','CA'],
    ['Gegard Mousasi','GM'], ['Sergio Pettis','SP'], ['Johnny Eblen','JE'],
    ['Usman Nurmagomedov','UN'], ['Liam McGeary','LM'], ['Rafael Lovato Jr','RL'],
    ['Ilima-Lei Macfarlane','IM'], ['Juliana Velasquez','JV'], ['Eduardo Dantas','ED'],
    ['Daniel Straus','DS'], ['Michael Page','MP'], ['Paul Daley','PD'],
    ['Rory MacDonald','RM'], ['Aaron Pico','AP'], ['Patrick Mix','PM'],
    ['Leandro Higo','LH'], ['Linton Vassell','LV'], ['Valentin Moldavsky','VM'],
    ['Anatoly Tokov','AT'], ['Cat Zingano','CZ'], ['Liz Carmouche','LC'],
  ],
  'one-championship': [
    ['Rodtang Jitmuangnon','RJ'], ['Superlek Kiatmoo9','SK'], ['Stamp Fairtex','SF'],
    ['Angela Lee','AL'], ['Christian Lee','CL'], ['Demetrious Johnson','DJ'],
    ['Aung La Nsang','AN'], ['Bibiano Fernandes','BF'], ['Anatoly Malykhin','AM'],
    ['Reinier de Ridder','RR'], ['Regian Eersel','RE'], ['Nong-O Hama','NH'],
    ['Tawanchai PK Saenchai','TS'], ['Jonathan Haggerty','JH'], ['Fabricio Andrade','FA'],
    ['Xiong Jing Nan','XN'], ['Denice Zamboanga','DZ'], ['Danielle Kelly','DK'],
    ['Mikey Musumeci','MM'], ['Roman Kryklia','RK'], ['Sitthichai Sitsongpeenong','SS'],
    ['Superbon Singha Mawynn','SB'], ['Adriano Moraes','AM'], ['Kade Ruotolo','KR'],
    ['Tye Ruotolo','TR'], ['Ham Seo Hee','HH'], ['Itsuki Hirata','IH'],
    ['Ok Rae Yoon','OY'], ['John Lineker','JL'], ['Shinya Aoki','SA'],
  ],
  'pfl': [
    ['Kayla Harrison','KH'], ['Francis Ngannou','FN'], ['Olivier Aubin-Mercier','OM'],
    ['Larissa Pacheco','LP'], ['Bruno Cappelozza','BC'], ['Ray Cooper III','RC'],
    ['Movlid Khaybulaev','MK'], ['Clay Collard','CC'], ['Rob Wilkinson','RW'],
    ['Denis Goltsov','DG'], ['Renan Ferreira','RF'], ['Jesus Pinedo','JP'],
    ['Gabriel Braga','GB'], ['Impa Kasanganay','IK'], ['Josh Silveira','JS'],
    ['Dakota Ditcheva','DD'], ['Cedric Doumbe','CD'], ['Thiago Santos','TS'],
    ['Anthony Pettis','AP'], ['Sadibou Sy','SY'], ['Magomed Magomedkerimov','MM'],
    ['Ante Delija','AD'], ['Biaggio Ali Walsh','BW'], ['Marina Mokhnatkina','MO'],
    ['Taylor Guardado','TG'], ['Julia Budd','JB'], ['Natan Schulte','NS'],
    ['Lance Palmer','LP'], ['Kai Kamaka III','KK'], ['Brendan Loughnane','BL'],
  ],
  'golf-players': [
    ['Tiger Woods','TW'], ['Jack Nicklaus','JN'], ['Arnold Palmer','AP'],
    ['Ben Hogan','BH'], ['Gary Player','GP'], ['Sam Snead','SS'],
    ['Bobby Jones','BJ'], ['Tom Watson','TW'], ['Seve Ballesteros','SB'],
    ['Nick Faldo','NF'], ['Phil Mickelson','PM'], ['Rory McIlroy','RM'],
    ['Scottie Scheffler','SS'], ['Jon Rahm','JR'], ['Brooks Koepka','BK'],
    ['Dustin Johnson','DJ'], ['Justin Thomas','JT'], ['Collin Morikawa','CM'],
    ['Xander Schauffele','XS'], ['Viktor Hovland','VH'], ['Jordan Spieth','JS'],
    ['Bryson DeChambeau','BD'], ['Patrick Cantlay','PC'], ['Hideki Matsuyama','HM'],
    ['Ludvig Åberg','LA'], ['Tommy Fleetwood','TF'], ['Shane Lowry','SL'],
    ['Annika Sörenstam','AS'], ['Nelly Korda','NK'], ['Lydia Ko','LK'],
    ['Greg Norman','GN'], ['Vijay Singh','VS'], ['Ernie Els','EE'],
    ['Nick Price','NP'], ['Lee Trevino','LT'], ['Byron Nelson','BN'],
    ['Gene Sarazen','GS'], ['Walter Hagen','WH'], ['Payne Stewart','PS'],
    ['Johnny Miller','JM'], ['Justin Rose','JR'], ['Adam Scott','AS'],
    ['Sergio García','SG'], ['Cameron Smith','CS'], ['Matt Fitzpatrick','MF'],
    ['Robert MacIntyre','RM'], ['Mickey Wright','MW'],
    ['Se Ri Pak','SP'], ['Inbee Park','IP'], ['Lorena Ochoa','LO'],
  ],
  /* The parties on the ballot, not a shortlist somebody drew up. These are
     the national committees and the parties with recognised ballot access in
     multiple states — a matter of public record rather than an opinion about
     who counts. Anyone can type a party that is not here. */
  /* Movements, from every direction. A board where the whole list leans one
     way is not a ranking, it is a poster -- and the site's own test for a
     board is whether it argues with itself for free. MAGA and Black Lives
     Matter on the same list is the board working, not a statement.

     Nothing here is an organisation with members and a bank account; they are
     movements, which is why several are hashtags and several are older than
     anybody reading. Anyone can type one that is not on the list. */
  'movements': [
    ['MAGA','MA'], ['Civil Rights Movement','CR'], ['Black Lives Matter','BL'],
    ["Women's Suffrage",'WS'], ['Labor Movement','LM'], ['Abolitionism','AB'],
    ['Tea Party','TP'], ['Occupy Wall Street','OW'], ['MeToo','MT'],
    ['LGBTQ Rights Movement','LG'], ['Environmental Movement','EN'], ['Anti-War Movement','AW'],
    ['American Indian Movement','AI'], ['March for Life','ML'], ['Gun Rights Movement','GR'],
  ],

  'us-parties': [
    ['Republican Party','GOP'], ['Democratic Party','DEM'],
    ['Libertarian Party','LP'], ['Green Party','GRN'],
    ['Constitution Party','CP'], ['Forward Party','FWD'],
    ['Working Families Party','WFP'], ['Independent','IND'],
    ['Peace and Freedom Party','PFP'], ['Party for Socialism and Liberation','PSL'],
    ['Alliance Party','ALP'], ['American Solidarity Party','ASP'],
    ['Legal Marijuana Now Party','LMN'], ['Natural Law Party','NLP'],
    ['Reform Party','REF'], ['Socialist Party USA','SPU'],
    ['Prohibition Party','PRO'], ['Unity Party','UP'],
    ['United Utah Party','UUP'], ['Mountain Party','MTN'],
    ['Vermont Progressive Party','VPP'], ['Independence Party of Minnesota','IPM'],
    ['Moderate Party','MOD'], ['SAM Party','SAM'],
    ['Common Sense Party','CSP'], ['No Labels','NL'],
    ['Conservative Party of New York','CNY'], ['Liberal Party','LIB'],
    ['Justice for All Party','JFA'], ['Approval Voting Party','AVP'],
  ],
  /* Presidents and vice presidents. A closed, historical, entirely factual
     set — so the list is spelling help rather than a nomination, which is
     what a hand-picked roster of sitting politicians would be. Anyone can
     type any name; the board takes whoever is paid for. */
  'us-politicians': [
    ['George Washington','GW'], ['Thomas Jefferson','TJ'], ['Abraham Lincoln','AL'],
    ['Theodore Roosevelt','TR'], ['Franklin D. Roosevelt','FDR'], ['Harry S. Truman','HT'],
    ['Dwight D. Eisenhower','DE'], ['John F. Kennedy','JFK'], ['Lyndon B. Johnson','LBJ'],
    ['Richard Nixon','RN'], ['Gerald Ford','GF'], ['Jimmy Carter','JC'],
    ['Ronald Reagan','RR'], ['George H. W. Bush','GHB'], ['Bill Clinton','BC'],
    ['George W. Bush','GWB'], ['Barack Obama','BO'], ['Donald Trump','DT'],
    ['Joe Biden','JB'], ['Kamala Harris','KH'], ['Mike Pence','MP'],
    ['Al Gore','AG'], ['Dick Cheney','DC'], ['Joe Lieberman','JL'],
    ['Hillary Clinton','HC'], ['John McCain','JM'], ['Mitt Romney','MR'],
    ['Bernie Sanders','BS'], ['Nancy Pelosi','NP'], ['John Adams','JA'],
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
  'instagram-influencers': [
    '@cristiano','@leomessi','@selenagomez','@kyliejenner','@therock',
    '@arianagrande','@kimkardashian','@beyonce','@khloekardashian','@justinbieber',
    '@taylorswift','@kendalljenner','@jlo','@nike','@virat.kohli',
    '@neymarjr','@nickiminaj','@kourtneykardash','@mileycyrus','@katyperry',
    '@zendaya','@kevinhart4real','@ddlovato','@badgalriri','@natgeo',
    '@championsleague','@realmadrid','@fcbarcelona','@9gag','@rotabo.app',
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

if (!existsSync(SPORT)) {
  console.error('rosters: scripts/sport-rosters.json is missing. Run: node scripts/build-sport-rosters.mjs');
  process.exit(1);
}
for (const [slug, list] of Object.entries(JSON.parse(readFileSync(SPORT, 'utf8')))) {
  out[slug] = list;
}

/* The billionaire lists, by country, come from Forbes's feed by way of
   scripts/build-rich-rosters.mjs. Their rows carry a sixth field -- a birth
   year the picture builder checks an article against -- that the list a
   visitor downloads has no use for, so it stops here. */
const RICH = join(root, 'scripts/rich-rosters.json');
if (!existsSync(RICH)) {
  console.error('rosters: scripts/rich-rosters.json is missing. Run: node scripts/build-rich-rosters.mjs');
  process.exit(1);
}
for (const [slug, list] of Object.entries(JSON.parse(readFileSync(RICH, 'utf8')))) {
  out[slug] = list.map(r => r.slice(0, 5));
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
