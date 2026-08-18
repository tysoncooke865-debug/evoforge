# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Expo universal app; ships today as a web app at https://evoforge.pages.dev. A public App Store launch is the stated goal, so native iOS/Android builds are the intended future — the design language stays one game-world across platforms, not per-OS adaptive.)

## Users

Primary avatar: a **16–26 year old lifter who enjoys the gamification of things**. Current reality: the owner (Tyson) and a circle of close friends testing daily. Every design decision should hold up for the eventual public audience, not just the friend group.

## Product Purpose

A **fitness RPG**: real training data (sets logged against a Supabase backend) drives a levelling, evolving champion character, plus 1v1 battles. Success means training consistency becomes visible, truthful character progression — and eventually a public App Store product.

## Positioning

Two claims separate EvoForge, jointly:

1. **Real training = real character.** Level, evolution, and Evo Rating are computed from actual logged sets, with server-side guards (append-only `xp_events`, server-recomputed amounts) — progress cannot be faked; the RPG is a truthful mirror of training.
2. **The competitive wager system with mates.** 1v1 battles, leaderboards, and arena competition built on that verified training data.

The coaching loop (today's mission) is **deliberately secondary and unrefined for now** — it supports the RPG progression and competition, it does not lead.

## Operating Context

- Used on a phone, logging training as it happens; the web deploy is the live surface (`npx expo start` locally, Cloudflare Pages in production).
- Backend is Supabase with owner-only RLS everywhere; cross-user reads via security-definer RPCs only.
- Multiple Claude sessions work the repo concurrently (see HANDOVER.md); smoke accounts exist for production verification.

## Capabilities and Constraints

- XP contract is pinned: flat 10 XP per set, level curve `500 + (L-1)*25`; `domain/*.py` goldens are the arbiter of the client's ported math — visual work must never touch these numbers.
- Design tokens live in `client/src/theme/tokens.js`, parity-guarded against `assets/styles.css` (`verify-tokens.mjs`) — new work uses existing tokens rather than inventing values.
- 7 whole-app colour palettes (6 purchasable) share identical rarity + semantic colours.
- Product vocabulary (established, keep): Forge Level, Evo Rating, Origin, Champion, Arena, Fuel (nutrition), Oracle (AI), Today's Mission.
- Undecided/known-unrefined: the coaching loop's final shape (explicitly parked as secondary).

## Brand Commitments

- **The pixel/retro-RPG identity is binding** (owner-confirmed 2026-08-18): pixel font, game-artifact feel. Redesigns may evolve it but must not abandon it for a generic fitness-app look.
- Name: **EvoForge**.

## Evidence on Hand

- Live production deploy at https://evoforge.pages.dev with real training data behind it.
- Lab mock fixtures (`client/src/lab/fixtures/`) provide a realistic seeded athlete for design comparison.
- No public testimonials, press, or benchmarks — do not fabricate any.

## Product Principles

1. **The character is a truthful mirror.** Progression is computed from real training with server-side guards; the UI must never imply progress the data doesn't back.
2. **Gamification leads, coaching follows.** RPG character progression and competition are the product; the mission system serves them.
3. **Competing with mates is first-class.** Battles, wagers, and leaderboards on verified data are a core differentiator, not a bolt-on.
4. **Design for the 16–26 lifter's phone.** Glanceable between sets, fast, and legible on a small screen.
5. **Evolve the pixel world, never abandon it.** The retro-RPG identity is the brand.

## Accessibility & Inclusion

Reduced-motion support is enforced in the codebase as a hard guard (`client/scripts/verify-motion.mjs`: any looping animation must consult reduced-motion). Future design work inherits this as a requirement.
