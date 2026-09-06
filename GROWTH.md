# Running a growth test on TopTen.one

Written for the person who owns the site, not for whoever edits it. Nothing
here needs the source code, a terminal, or anybody's help.

---

## The one question

Everything below exists to answer this:

> **Will somebody who has never heard of us see a ranking they care about and
> pay $2 to move it?**

And then: will some of them share it, come back, and pay again.

Today the honest answer is *nobody knows*. The $1,450.54 on the site was paid
by you, from your own cards. Revenue from a stranger is **$0**. That is not a
failure — it is the thing that has not been tested yet, and the whole site is
now set up to test it.

---

## One test, start to finish

### 1. Pick a ranking worth arguing about

Open **topten.one** and look at *Closest battles*. The best ones are where two
names people already have opinions about are a couple of dollars apart, because
the invitation writes itself: **$2 takes #1**.

Good ones right now:

| Ranking | The fight | What it costs to flip |
|---|---|---|
| Creators on X | @elonmusk chasing @realDonaldTrump | $2 |
| Artists | Beyoncé chasing Billie Eilish | $2 |
| UFC fighters | Alex Pereira chasing Conor McGregor | $2 |
| US parties | Democratic chasing Republican | $8.01 |

Empty rankings work too, and differently: **Football players**, **Football
clubs**, **F1 drivers** and 37 others have nobody in them, so the first $2 is
#1 outright. That is a better offer than it sounds.

### 2. Make the link

Take the ranking's address and add the campaign markers. This is the only
technical step, and it is copy-and-paste:

```
https://topten.one/x-influencers/?utm_source=tiktok&utm_campaign=musk-vs-trump&utm_content=video-a
```

- `utm_source` — where you posted it: `tiktok`, `x`, `instagram`, `reddit`
- `utm_campaign` — what the test is called: `musk-vs-trump`
- `utm_content` — which post: `video-a`, `video-b`

**Change `utm_content` for every single post.** That is what tells video A from
video B when one of them works and the other does not.

Google Ads needs none of this: an ad click always arrives carrying its own
marker, and the dashboard files it under `google-ads` on its own.

### 3. Post it

Advertise the **fight**, not the site:

> Musk is $1 behind Trump. $2 puts him on top.
> **topten.one**

Not *"discover TopTen.one"*. Nobody wants to discover a website. They want
their side to win.

### 4. Read what happened

Open **topten.one/dashboard.html** and sign in with Google. Only your address
can open it; anybody else gets the same blank refusal.

Pick a window — 1, 7, 30 or 90 days — and read down.

### 5. Decide

**The one number that matters is *Revenue per 1,000 visitors*.**

It answers "if I send a thousand more people, what comes back?" — which is the
only question that decides whether to spend more.

- Under what a thousand visitors cost you → **stop**, or change the fight.
- About the same → **change one thing** and run it again.
- Comfortably above → **scale**, and keep watching it as you do.

---

## Reading the dashboard when it goes wrong

The figures are laid out so a failure names itself. Read them in order and stop
at the first one that is too small:

| What you see | What is broken | What to change |
|---|---|---|
| Almost no visitors | The post | The hook, the platform, the hour |
| Visitors, no board views | The front page | Deep-link to the ranking, not to `/` |
| Board views, nobody presses Back | The fight is not worth $2 | A different rivalry |
| Back pressed, no checkout | The amount, or the trust | Try a cheaper race |
| Checkout started, no payment | Stripe, or second thoughts | Watch it before touching anything |
| Payments, nobody shares | The moment after paying | Tell us — the result page is ours to fix |
| Payments, nobody returns | No reason to come back | The rival has to react |

**Revenue by source** and **Revenue by campaign** say which post paid for
itself. Two campaigns, same money, same days: the one with more revenue per
1,000 visitors wins. Kill the other.

---

## Two things to know before you trust a number

**Attribution starts now.** The 147 payments already in the system were made
before any of this existed, so they carry no visit and every source shows $0
against them. The first payment made through the new site is the first one that
will be credited to a campaign. Until then, "payment rate" divides your own
seeding by real visitors and means nothing.

**Visitors counts sessions, not people.** Somebody on a phone and a laptop
counts twice. The figure also carries a baseline of 147 that Google Analytics
measured in the three days before the site kept its own record — real people,
counted once, and the page says so.

---

## What the site will not do

It will not invent activity. There is no counter that goes up on its own, no
"347 people joined", no live dot with nothing behind it. Where the honest number
is zero, the page says so — 40 of the 72 rankings have nobody in them, and that
emptiness is the offer, not something to hide.

If a figure on the site looks too good, it is measuring something real. That is
the only way it is allowed to look good.
