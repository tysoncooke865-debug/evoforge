# PAGE LAB

A dev-only gallery of page **variants**: forks of live screens you can browse
at `/lab`, open full-screen, and interact with — committed to the repo,
CI-checked like any screen, and invisible to production users.

The shape of the thing: `/lab` is an **index**. One section per page, one card
per design. You click into a page's batch of takes and flip between them with
the tab strip across the top. When a design loses, you **cull** it.

## Where it runs

| Surface | How |
| --- | --- |
| Local | `npx expo start` → http://localhost:8081/lab (`__DEV__` turns it on) |
| Deployed | https://lab.evoforge.pages.dev — the root **redirects to `/lab`**; the `lab` branch's build is the ONLY one CI compiles with `EXPO_PUBLIC_PAGE_LAB=1` |
| Production | `/lab` says it is a dev tool and is not part of the build (the `(lab)/_layout.tsx` gate, muscle-lab doctrine) |

The `lab` branch carries **zero unique commits** — it is a deploy pointer.
Variants live on the working branch; refresh the deploy with:

```bash
git checkout lab && git merge --ff-only expo-rewrite && git push && git checkout expo-rewrite
```

Then verify against the **per-deployment URL the workflow logs**
(`https://<hash>.evoforge.pages.dev`), not just the alias — branch aliases on
this project have frozen before (HANDOVER §3).

## Naming

Every page carries a **`baseline`**: the verbatim fork of the live screen,
titled `CURRENT` on screen. It is the diff-anchor a new round forks from and
the tab every new take gets compared against. It is the one slug that repeats
across pages, and it means the same thing on each.

Every other design gets a **codename unique across the whole lab** — not
`variant-a`, not `home-2`. Lowercase, `/^[a-z0-9-]+$/`. The point is that
"the compact one" names exactly one design in a review, with no page prefix
needed. `lab.test.ts` pins both rules, so a duplicate codename fails CI
rather than quietly shadowing a design in the URL space.

## Data: mock, and only mock

Every variant runs on the seeded lab athlete. `LabDataProvider` mounts a fresh
QueryClient seeded by `fixtures/` under a fake session (`LAB_USER_ID`),
`staleTime: Infinity`, so reads never touch the network. Fully interactive
**provided writes go through the shims** (`mock/mutations.ts`).

There used to be a REAL mode. It is gone (2026-08-28): signed out it rendered
the honest empty states of a page with no data, which nobody can judge a
design by, and signed in a lab workout *was* a real workout on the real
account. Nothing was lost — every variant already defaulted to mock.

`?data=` is retired but still **reserved** in `LAB_RESERVED_PARAMS`: a
bookmark from the two-mode era carries it, and an unreserved `data` would ride
every later variant swap as if it were a page-contract param.

### The hard truth about mock writes

Faking the auth **context** does not make writes safe. The supabase client is
a module singleton holding its own session, the server stamps `user_id` from
`auth.uid()`, and `useSaveSet` enqueues into the durable AsyncStorage
set-queue before any network. An un-shimmed write is a REAL write (signed in)
or junk in the durable queue (signed out). Hence:

- shimmed in the baselines: **LOG SET** (via the forked exercise-logger),
  **FINISH**, **REOPEN**, **SET TARGET**, **LOG CALORIES**, **DELETE ENTRY** —
  they write the seeded cache only — plus the two writes that fire ON MOUNT,
  where the banner's "heed it" rule cannot help because the developer never
  asked for them: **useActivationStep** (would emit activation-funnel
  telemetry under the fake session) and **useClaimCoin** (Home claims the
  retroactive starting bonus from an effect; the shim answers `duplicate`, the
  way the lab wallet's server already would);
- NOT shimmed: routine/schedule/plan saves, cardio logging, unit prefs, ghost
  publish, and any coin claim that should LAND. The orange banner appears
  whenever a real session exists underneath the fake one — heed it, or sign
  out;
- the FUEL AI intake is not mounted in the lab at all: `NutritionIntake` fires
  a real `ai-nutrition` edge call on mount, which would burn the real AI
  budget. `openIntake()` toasts toward SET TARGET MANUALLY instead;
- Zustand stores are **never isolated**: skips/ad-hoc (session-store), the
  rest timer, toasts are shared with the live app.

## Culling a design

A design that lost its round should stop competing for attention the moment
the call is made — but deleting source files is a commit, not a button (the
lab is a static export and cannot rewrite the repo it was built from). So
culling is two steps:

1. **CULL** on the gallery card hides it immediately, on that device
   (`localStorage`, key `evoforge-lab-culled`). It leaves the tab strip too.
   The gallery lists it under **CULLED · PENDING REMOVAL**, which is the work
   list for step 2. **RESTORE** undoes it.
2. **Delete it for real** in a follow-up commit: the variant file(s) and any
   directory beside it, its `registry-meta.ts` entry, its `COMPONENTS` line.
   Three edits, because the registry is built that way.

The registry stays the only truth about what exists: a stored key whose
variant has already been deleted is ignored, never rendered.

**One trap, learned the hard way** (the `fuel/calculator` cull): if anything
outside the variant imports from its directory, move that module first. The
lab athlete's seeded FUEL target is computed from the dual-rate model, so the
model moved to `fixtures/nutrition-model.ts` in the same commit that deleted
the variant. Fixtures may not depend on a variant that can be culled.

## Forking a page (the recipe)

1. Copy the screen: `src/app/(main)/today.tsx` →
   `src/lab/variants/train/<codename>.tsx` (home: `(main)/index.tsx` →
   `src/lab/variants/home/…`; workout: →
   `src/lab/variants/workout/<codename>.tsx`). Imports are `@/`-aliased and
   survive the move.
2. Default export → **named** export (only `src/app/` files need defaults).
3. Keep navigation inside the lab: a train or home fork's "open workout" push
   becomes `labWorkoutHref(variant, params)` (`links.ts`); a workout fork's
   back becomes `router.canGoBack() ? router.back() : router.replace('/lab')`.
   Links to pages the lab does NOT hold (Home's `/evo`, `/rank`, avatar
   actions) stay as they are — they leave the lab, which is honest and better
   than a dead button.
4. Mock-safe writes: swap the import, keep the call sites —
   `import { useLabSaveSet as useSaveSet } from '@/lab/mock/mutations';`
   (same for finish/reopen). LOG SET lives in `ui/train/exercise-logger.tsx`,
   so a workout fork also forks that file and swaps its one import (see
   `variants/workout/baseline-exercise-logger.tsx`).
5. To redesign a shared component, copy it BESIDE the variant and repoint
   that one import — never edit `src/ui/` for a variant's sake.
6. Register it: one entry in `registry-meta.ts` (slug, title, description) +
   the component in `registry.ts`'s `COMPONENTS` map.
7. Run the HANDOVER §5 loop. Variants are src files — tsc, lint, vitest and
   verify-motion all gate them.

Promoting a variant = replacing the live screen's content with the fork's
(and reverting the fork edits above) on the working branch.

## Known limits (deliberate)

- Un-shimmed mutations reach the real backend (banner + list above). Shim more
  of `data/` as variants need them.
- **"MOCK DATA ONLY" is true of the seeded keys, not of every read.** A hook
  whose key is absent from `LAB_SEEDED_KEYS` / `LAB_SEEDED_PARAM_KEYS` has no
  cache entry, so its `queryFn` runs and hits the network. Measured on the
  2026-08-28 tour of `home/baseline`, signed out: `my_pool_invitations`,
  `my_forge_reveals`, `forge_cache_state`, `recovery_run_state`,
  `app_flag_enabled`. They are READS, and RLS answers them empty, so the
  surfaces they feed render as if the athlete has nothing there. Seed a key to
  fix its surface — and add it to `LAB_SEEDED_KEYS`, which is what makes the
  vitest pin catch the next one.
- A mutation's cache invalidation can refetch a seeded key and replace it with
  an RLS-empty read — cosmetic, fixed by remounting (reopen the variant).
- The leaderboard teaser's board polls every 60s while focused
  (`useLeaderboardByMetric`, staleTime 30s), so the seeded rows are replaced
  by a real read about a minute after the teaser is first expanded — empty
  signed out. Same class as the invalidation note above.
- Culls are **per device**: localStorage, not a repo file. That is the point —
  it is a scratch decision until the deletion commit makes it real. On native
  the whole mechanism degrades to "nothing is culled" (no localStorage).
- Variants rot toward their source screens as the live pages evolve. The
  baselines are diff-anchors: `git diff --no-index src/app/\(main\)/today.tsx
  src/lab/variants/train/baseline.tsx` should show ONLY the fork recipe
  (same for `(main)/index.tsx` ⟷ `variants/home/baseline.tsx`).
