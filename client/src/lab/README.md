# PAGE LAB

A dev-only gallery of page redesigns: forks of live screens you can browse
at `/lab`, open full-screen, and interact with — committed to the repo,
CI-checked like any screen, and invisible to production users.

The shape of the thing (since 2026-09-04): `/lab` is an **index, page-first**.
One large heading per app page (HOME / TRAIN / WORKOUT / FUEL). Under each:
**CURRENT** — the pinned fork of the deployed design, always present, never
cullable — then the **REDESIGN BATCHES**, newest first. A batch is one
session's takes on one page: "REDESIGN \<n> FROM \<date>", "Made with
\<model>", a one-line goal. You click into a batch and flip between its takes
and CURRENT with the tab strip across the top. When a round loses, you
**cull the batch** — after an inline "are you sure".

## Where it runs

| Surface | How |
| --- | --- |
| Local | `npx expo start` → http://localhost:8081/lab (`__DEV__` turns it on) |
| Deployed | https://lab.evoforge.pages.dev — the root **redirects to `/lab`**; the `lab` branch's build is the ONLY one CI compiles with `EXPO_PUBLIC_PAGE_LAB=1` |
| Production | `/lab` says it is a dev tool and is not part of the build (the `(lab)/_layout.tsx` gate, muscle-lab doctrine) |

The `lab` branch carries **zero unique commits** — it is a deploy pointer.
Batches live on the working branch; refresh the deploy with:

```bash
git checkout lab && git reset --hard origin/lab
git merge --ff-only expo-rewrite && git push && git checkout expo-rewrite
```

Then verify against the **per-deployment URL the workflow logs**
(`https://<hash>.evoforge.pages.dev`), not just the alias — branch aliases on
this project have frozen before (HANDOVER §3).

## The registry model

`registry-meta.ts` is the pure truth (vitest-pinned); `registry.ts` joins it
to components. Per page:

- **`baseline`** — CURRENT. The verbatim fork of the live screen, pinned to
  its live source by `scripts/lab-sync.mjs` (below). It is the diff-anchor a
  new round forks from, the first tab of every batch's strip, and the one
  slug that repeats across pages. It belongs to no batch and has no cull
  affordance.
- **`lastBatchNumber`** — the counter's memory (contract below).
- **`batches`** — newest first, each `{ number, dateIso, model, description,
  variants }`. `model` comes from `LAB_AUTHOR_MODELS`, never freehand;
  `description` is one line on what the round attempts, or
  `LAB_BATCH_DEFAULT_DESCRIPTION` ("testing massive redesigns") when nothing
  better can be said.

Every non-baseline design gets a **codename unique across the whole lab** —
not `variant-a`, not `home-2`. Lowercase, `/^[a-z0-9-]+$/`. "The compact one"
names exactly one design in a review, with no page prefix needed.
`lab.test.ts` pins all of it.

### The batch numbering contract

Numbers are **per page, 1-based, monotonic, and remembered**. If REDESIGN 8
and 9 existed and both were culled or even deleted, the next batch is 10 — a
number names one historical round forever. The counter resets to 0 **only**
when a page's batch list becomes completely empty, and the reset is enacted
by the **deletion commit** that empties the list (the on-device cull never
touches the registry). `lab.test.ts` pins `lastBatchNumber === 0 ⟺ batches
empty`, so the commit that forgets either half goes red.

## Creating a batch (the authoring recipe)

1. Next number = the page's `lastBatchNumber + 1`. **Bump `lastBatchNumber`
   in the same edit.**
2. Add the `LabBatchMeta` at the FRONT of the page's `batches` (newest
   first — the order pin enforces it): today's `dateIso`, your model's name
   from `LAB_AUTHOR_MODELS` (add it there if this model has not authored
   before), a one-line `description` of the round's goal.
3. Fork the screen per the recipe below, once per take. Codenames only.
4. One `COMPONENTS` line in `registry.ts` per take.
5. Run the HANDOVER §5 loop. Batches are src files — tsc, lint, vitest,
   verify-motion and lab-sync all gate them.

Adding takes to an EXISTING batch later (a follow-up session the developer
wants in the same round): append to that batch's `variants`, same number, no
counter bump.

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
   (same for finish/reopen/claim-coin). LOG SET lives in
   `ui/train/exercise-logger.tsx`, so a workout fork also forks that file and
   swaps its one import (see `variants/workout/baseline-exercise-logger.tsx`).
5. To redesign a shared component, copy it BESIDE the variant and repoint
   that one import — never edit `src/ui/` for a variant's sake.
6. Register it (batch recipe above).

Promoting a take = replacing the live screen's content with the fork's (and
reverting the fork edits above) on the working branch — then running
`node scripts/lab-sync.mjs --write` in the same commit, because the live
page just changed.

## CURRENT is pinned — lab-sync

Non-baseline takes rot toward their source screens as the live pages evolve;
that is accepted — they are photographs of a design round. The BASELINES are
not allowed to: **`scripts/lab-sync.mjs` pins every CURRENT fork to
`live source + recorded recipe patch`** (`scripts/lab-sync/*.patch`,
LF-pinned in `.gitattributes`), and CI runs `--check` on every push.

- Touched one of the five live sources (`(main)/index.tsx`, `today.tsx`,
  `workout.tsx`, `fuel.tsx`, `ui/train/exercise-logger.tsx`)? Run
  `node scripts/lab-sync.mjs --write` **in the same commit**, or CI is red.
- Deliberately changed a baseline (the recipe itself — a new shim, a new
  nav swap)? `--record` instead.
- A `--write` that fails means the live page changed inside a recipe hunk:
  re-weave the fork by hand, then `--record`, same commit.

The manual eyeball (`git diff --no-index src/app/\(main\)/today.tsx
src/lab/variants/train/baseline.tsx`) still works for reading a hunk, but
the script is the guard.

## Data: mock, and only mock

Every take runs on the seeded lab athlete. `LabDataProvider` mounts a fresh
QueryClient seeded by `fixtures/` under a fake session (`LAB_USER_ID`),
`staleTime: Infinity`, so reads never touch the network. Fully interactive
**provided writes go through the shims** (`mock/mutations.ts`).

There used to be a REAL mode. It is gone (2026-08-28): signed out it rendered
the honest empty states of a page with no data, which nobody can judge a
design by, and signed in a lab workout *was* a real workout on the real
account. Nothing was lost — every variant already defaulted to mock.

`?data=` is retired but still **reserved** in `LAB_RESERVED_PARAMS`; so is
**`?batch=<n>`**, the strip's scope (which round's takes share the bar with
CURRENT) — both are lab routing state, and an unreserved one would ride every
later variant swap as if it were a page-contract param.

### The hard truth about mock writes

Faking the auth **context** does not make writes safe. The supabase client is
a module singleton holding its own session, the server stamps `user_id` from
`auth.uid()`, and `useSaveSet` enqueues into the durable AsyncStorage
set-queue before any network. An un-shimmed write is a REAL write (signed in)
or junk in the durable queue (signed out). Hence:

- shimmed in the baselines: **LOG SET** (via the forked exercise-logger),
  **FINISH**, **REOPEN**, **SET TARGET**, **LOG CALORIES**, **DELETE ENTRY** —
  they write the seeded cache only — plus the writes the developer never
  asked for: **useActivationStep** (funnel telemetry under the fake session),
  **useClaimCoin** on Home (the retroactive bonus claims from an effect) AND
  on the workout page (2026-09-04: completion fires
  `claimCoins.mutate({kind:'workout_complete'})` from an effect the moment
  the last set lands — the shim answers `duplicate`);
- NOT shimmed: routine/schedule/plan saves (TRAIN EARLY's plan-claim
  included), cardio logging, unit prefs, ghost publish, and any coin claim
  that should LAND. The orange banner appears whenever a real session exists
  underneath the fake one — heed it, or sign out;
- the FUEL AI intake is not mounted in the lab at all: `NutritionIntake`
  fires a real `ai-nutrition` edge call on mount, which would burn the real
  AI budget. `openIntake()` toasts toward SET TARGET MANUALLY instead;
- the lab athlete's `callouts_enabled` is FALSE (2026-09-04): the setting
  gates everything about call outs including the read — `useMyCallouts`
  polls an RPC every 8s at `staleTime: 0`, so seeding its list would be
  refetched away instantly. Callouts-off is a real product state;
- Zustand stores are **never isolated**: skips/ad-hoc (session-store), the
  rest timer, toasts are shared with the live app.

## Culling a batch

A round that lost should stop competing for attention as ONE decision — but
deleting source files is a commit, not a button (the lab is a static export
and cannot rewrite the repo it was built from). So culling is two steps, and
step 1 asks first:

1. **CULL** under a batch box swaps the card's foot for an inline ARE YOU
   SURE block (KEEP IT / CULL IT — the callout-tray confirm idiom, static,
   no Modal). Confirming hides the batch immediately and lists it under
   **CULLED · PENDING REMOVAL**, the work list for step 2. **RESTORE**
   undoes it.
   - Signed in, the cull is **durable across devices**: `cull-sync.ts`
     mirrors the local list into the `lab_culls` table (migration 200,
     owner-only RLS) and pulls it on every gallery mount. localStorage
     (key `evoforge-lab-culled`, values `<page>/batch-<n>`) stays the
     synchronous source of truth for render; the network is effects-only
     and every failure leaves local state standing.
   - Signed out, culls are per-device (the hint under the masthead says so).
   - One accepted asymmetry: a device still holding a key re-pushes it on
     its next signed-in mount after another device unculled it — RESTORE is
     one tap. DB-authoritative overwrite would lose signed-out culls; worse.
2. **Delete it for real** in a follow-up commit: the batch's variant files
   (and any directory beside them), its entry in the page's `batches`, its
   `COMPONENTS` lines — **and, if the page's list is now empty,
   `lastBatchNumber` reset to 0 in the same edit** (`lab.test.ts` fails the
   commit that forgets). Optionally delete the stale `lab_culls` rows by
   hand; harmless either way.

The registry stays the only truth about what exists: a stored key whose
batch has already been deleted is ignored, never rendered.

**One trap, learned the hard way** (the `fuel/calculator` cull): if anything
outside the batch imports from its directory, move that module first. The
lab athlete's seeded FUEL target is computed from the dual-rate model, so the
model moved to `fixtures/nutrition-model.ts` in the same commit that deleted
the variant. Fixtures may not depend on a batch that can be culled.

## testID contract (the Playwright tour drives these)

| Surface | testID |
| --- | --- |
| CURRENT box OPEN | `lab-open-<page>-baseline` |
| Batch box OPEN | `lab-open-<page>-batch-<n>` |
| Batch CULL (opens the confirm) | `lab-cull-<page>-batch-<n>` |
| Confirm / cancel | `lab-cull-confirm-<page>-batch-<n>` / `lab-cull-cancel-<page>-batch-<n>` |
| Restore row | `lab-uncull-<page>-batch-<n>` |
| Strip: back to gallery | `lab-gallery` |
| Strip: a tab | `lab-tab-<page>-<variant>` (CURRENT = `lab-tab-<page>-baseline`) |
| Signed-out cull hint | `lab-cull-hint` |

## Known limits (deliberate)

- Un-shimmed mutations reach the real backend (banner + list above). Shim
  more of `data/` as takes need them.
- **An UNSEEDED key still reaches the network.** A hook whose key is absent
  from `LAB_SEEDED_KEYS` / `LAB_SEEDED_PARAM_KEYS` has no cache entry, so its
  `queryFn` runs for real; RLS answers it empty and the surface renders as if
  the athlete has nothing there. That is how Home lost its whole DAILY FORGE
  CACHE card until the economy keys were seeded (2026-08-28). When you find
  one: add the fixture, seed it, and add the name to `LAB_SEEDED_KEYS` — the
  list is what makes the vitest pin catch the next one.
  Two rules the economy fixtures set, worth keeping:
  **derive, never hardcode** (`labForgeCacheState` reads the same schedule the
  week bars do, so they cannot disagree about whether today is a rest day),
  and **never seed a state whose only affordance is an un-shimmed write** —
  CLAIM, CONFIRM REST DAY and both claim buttons are real mutations, so the
  seeded athlete's day is honestly settled and offers none of them. Design one
  of those states and you shim the mutation first.
- A mutation's cache invalidation can refetch a seeded key and replace it with
  an RLS-empty read — cosmetic, fixed by remounting (reopen the variant).
- The leaderboard teaser's board polls every 60s while focused
  (`useLeaderboardByMetric`, staleTime 30s), so the seeded rows are replaced
  by a real read about a minute after the teaser is first expanded — empty
  signed out. Same class as the invalidation note above.
