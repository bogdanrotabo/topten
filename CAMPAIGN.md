# The first test — ready to post

Built on 6 September 2026 from the live rankings. **Every figure below is real
and every link works.** What is missing is the one thing I cannot do: press
publish on your accounts.

---

## The three tests

Three different crowds, so the result says *which* crowd pays rather than just
*whether* somebody did. Run them on the same day, same effort each, and compare.

### Test 1 — Musk vs Trump

The loudest rivalry on the site, on the platform where both live.

**Right now:** @realDonaldTrump $19 · @elonmusk $18 · **$2 flips it**

```
https://topten.one/x-influencers/?utm_source=x&utm_campaign=musk-trump&utm_content=post-a
```

> Trump is #1. Musk is $1 behind.
> $2 puts Musk on top. That's the whole mechanism — no algorithm, no votes, just money.
> topten.one

### Test 2 — Beyoncé vs Billie Eilish

Music fandoms mobilise faster than almost anyone, and they are used to
organising around a number.

**Right now:** Billie Eilish $14 · Beyoncé $13 · **$2 flips it**

```
https://topten.one/artists/?utm_source=tiktok&utm_campaign=beyonce-billie&utm_content=video-a
```

> Billie Eilish is #1. Beyoncé is one dollar behind.
> $2 changes the ranking. Right now, from your phone.
> topten.one

### Test 3 — Football players, nobody in it

A completely different offer: not "help someone climb" but **"be #1 outright,
for two dollars."** 40 of the 72 rankings are empty like this.

```
https://topten.one/football-players/?utm_source=x&utm_campaign=football-empty&utm_content=post-a
```

> Nobody is #1 in Football players. Nobody at all.
> The first $2 takes it, and it stays until somebody pays more.
> Who should it be?
> topten.one

---

## The rule for the links

**Change `utm_content` on every single post.** Same fight, two videos → `video-a`
and `video-b`. That is what tells them apart afterwards; nothing else does.

Keep `utm_campaign` the same across posts about the same fight, so the campaign
totals add up.

Google Ads needs none of this — an ad click carries its own marker and the
dashboard files it under `google-ads` by itself.

---

## Reading it

**topten.one/dashboard.html**, sign in with Google.

The number that decides everything is **Revenue per 1,000 visitors**. Compare
the three campaigns on it after a day.

- One is clearly ahead → that is the crowd. Spend there.
- All three near zero, but visitors arrived → the fight is not worth $2 to
  anybody. Change the fight, not the site.
- Nobody arrived → the posts. Nothing about the site is being tested yet.

---

## Before you spend anything

**A real payment has never gone through this site.** Everything is tested —
75 assertions on a real database, the whole result page in a browser — but
Stripe's own webhook has never fired at the new code.

So make the first payment yourself, on an empty ranking, for $2:

```
https://topten.one/football-players/
```

Add a name, pay $2, and see whether the page comes back saying you took #1. If
it does, the loop works and you can spend on ads with a straight face. If it
does not, tell me what you saw and I will fix it before a stranger meets it.

**Do that before the posts, not after.**
