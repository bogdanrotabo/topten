# Cont Google Ads separat pentru TopTen.one

Decis pe 26 august 2026. Motivul, pe scurt: campania TopTen rulează azi din contul
Ads al Rotabo, iar acel cont poate ține **o singură** sursă de conversii web —
`rotabo.app`, prin proprietatea GA4 a Rotabo. Evenimentul `listing_paid` trăiește în
proprietatea GA4 a TopTen, care e legată de cont din 25 august, dar **nu apare** ca
sursă importabilă. Ca s-o aducem acolo, ar trebui înlocuită sursa Rotabo. Nu se face.

Două produse, două conturi. Atunci fiecare își are propria sursă și nu se mai calcă.

---

## Partea ta: deschiderea contului

**Doar asta o faci tu.** Cere card, iar eu nu creez conturi și nu introduc date de
plată nicăieri — nici aici, nici în altă parte.

### Contul e deja alocat: 664-689-5193

Pe 26 august, cautand link-ul direct pentru Expert Mode, am apasat „Nuovo account
Google Ads" ca sa vad unde duce. Google aloca numarul **pe loc**, la primul click, nu
la sfarsitul vrajitorului. Deci contul exista deja, gol: fara card, fara campanie,
oprit la primul pas al inscrierii. Nu asta intentionam cand am apasat.

Poarta de intrare, verificata:

    https://ads.google.com/nav/selectaccount

Acolo apar toate conturile plus „Nuovo account Google Ads". Contul 664-689-5193 e in
lista si continua de unde a ramas.

### Ce mai e de facut

1. **Schimba destinatia anuntului.** Fluxul preselecteaza automat un profil de
   business de pe contul Google — la noi a ales **„Tarzan MEMECOIN"**, care n-are
   nicio legatura. Apasa **„Seleziona un'altra opzione"** si pune site-ul
   `https://topten.one/`.
2. **Expert Mode.** Nu exista niciun link pe primul pas; Google l-a scos de acolo.
   Apare mai tarziu in flux, ca link mic jos in pagina: **„Passa alla modalità
   Esperto"**. Daca nu apare deloc, varianta sigura e sa duci vrajitorul pana la
   capat cu **bugetul minim**, sa pui campania **imediat pe pauza**, si dupa aceea
   contul se deschide normal in interfata expert pe `ads.google.com/aw/overview`.
   Campania aia de unica folosinta o stergem oricum.
3. **Moneda CHF, fus Europe/Zurich.** *Nu se mai pot schimba dupa creare.* Aici se
   greseste o singura data.
4. Cardul il pui tu.
5. Imi confirmi cand e gata. Restul il fac eu.

---

## Partea mea, după ce am numărul

1. **Leg proprietatea GA4 TopTen.one (551474282) de contul nou.**
   Din Analytics, nu din Ads: Amministrazione > Collegamenti dei prodotti >
   Collegamenti Google Ads > Collega. Dinspre GA4 legătura se adaugă și nu poate
   atinge nimic din contul Rotabo.
2. **Import `listing_paid` ca acțiune de conversie principală.**
   În contul nou, "origini dati" e gol, deci pot pune `topten.one` acolo fără să
   dau nimic la o parte. Evenimentul e deja marcat ca eveniment cheie în GA4.
3. **Reconstruiesc campania** după specificația de mai jos.
4. **Opresc campania veche** din contul Rotabo. Se termină oricum pe 27 august.

---

## Specificația campaniei

Din `ADS-CAMPAIGN.md`, cu două corecturi importante învățate pe 25 august.

| Setare | Valoare |
|---|---|
| Tip | Search, doar căutare |
| Rețele | Search Network **DA** · Search Partners **NU** · Display **NU** |
| Buget | **CHF 15/zi** la pornire, nu 40, nu 50 |
| Licitare | Maximize clicks, plafon CPC **CHF 1.20** |
| Limbă | English |
| Landing page | `https://topten.one/` |
| Țintire | Începe cu **US + UK**. Restul se adaugă dacă cifrele susțin. |
| Prezență | **"Presence: people in your targeted locations"**, nu "presence or interest" |

**Atenție la virgulă:** interfața e în italiană, deci separatorul zecimal e virgula.
Dacă scrii `1.20` la plafonul de CPC, se citește **120,00 CHF**. Se scrie `1,20`.

### Cuvintele cheie — cele zece reale, toate phrase match

```
"promote my business online"              "get featured online"
"advertise my small business"             "get my business noticed online"
"online advertising for small business"   "paid listing website"
"cheap online advertising"                "top 10 listing site"
"where to advertise my business"          "online business listing site"
```

**Nu adăuga grupul „promovare conturi sociale" din ADS-CAMPAIGN.md.** Acele șase
cuvinte, în special `"get more followers fast"`, sunt exact interogarea pe care o
cumpără serviciile de followeri falși. N-au existat niciodată în contul real, și
nu trebuie să existe nici în ăsta.

Din cele 22 de impresii ale campaniei vechi, **toate** au venit dintr-un singur
cuvânt: `"promote my business online"`. Celelalte nouă au avut zero. Merită știut
înainte să te aștepți la volum.

### Anunțul — textul APROBAT, nu cel original

Textul original din `ADS-CAMPAIGN.md` a fost **respins** pentru „Enabling Dishonest
Behavior". Şapte titluri şi trei descrieri au fost marcate individual. Se folosește
exclusiv textul rescris, care a trecut la salvare, fără revizuire.

**Titluri (max 30 caractere):**

```
Buy a Listing on TopTen.one     Listing Price Sets Position
Paid Listing Site From $2       No Account, No Sign Up
Advertise Your Link Online      Instant Listing From $2
Your Link on Our Top 10         Ten Boards, One Web Page
Sponsored Listing, No Wait      Openly Paid Placement
Promote Your Business Site      See the Boards First
Pay What You Want to List       A Directory You Buy Into
Made in Switzerland
```

**Descrieri (max 90 caractere):**

```
TopTen.one is a paid listing board. Add your link, choose your amount, go live.
Rank on our board is set by what you pay. Nothing hidden, nothing automated.
Ten boards for ten communities. Your link and tagline, listed from $2.
This is a listing on our own site. It changes nothing on any social platform.
```

**Regula care ține anunțul aprobat:** nicăieri nu se sugerează că se câștigă rang,
followeri sau vizibilitate *pe* platformele sociale. Peste tot e clar că e o listare
plătită pe topten.one. Orice titlu nou trebuie să treacă testul ăsta.

**Sitelink-uri:**

| Text | URL |
|---|---|
| How it works | `https://topten.one/about.html` |
| See the boards | `https://topten.one/` |
| Terms | `https://topten.one/terms.html` |

---

## Ce e diferit față de data trecută, și de ce contează

**Contul e nou, deci n-are istoric.** Asta taie în ambele sensuri. Bun: violarea de
politică de pe contul Rotabo nu se moștenește. Rău: nici încrederea nu se
moștenește, iar conturile noi sunt revizuite mai strict. De-aia se pornește cu
CHF 15/zi și o singură țară — dacă site-ul pică din nou la revizuire, ai pierdut
foarte puțin.

**Campania veche a mers prost, și e bine de știut cât:** anunțul a ajuns
„Idoneo (limitato)", adică aprobat dar limitat de politică, și a cheltuit sub 5 CHF
dintr-un buget de 40 în nouă ore. 42 de afișări, 4 clicuri, zero listinguri.
Un anunț limitat de politică aproape că nu e servit. Dacă și în contul nou apare
„limitato", campania nu merită bani — atunci problema nu e textul, e propunerea
site-ului, iar răspunsul e badge-ul și oamenii, nu Google.

**Boardurile goale rămân problema numărul unu.** YouTube, Twitch, LinkedIn și
Threads sunt goale. Cine plătește ca să aducă oameni pe boarduri goale plătește ca
să-i vadă plecând. Înainte de orice franc dat pe reclamă, 15–25 de listinguri.
