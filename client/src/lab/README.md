# PAGE LAB

A dev-only gallery of page **variants**: forks of live screens you can browse
at `/lab`, open full-screen, and interact with — committed to the repo,
CI-checked like any screen, and invisible to production users.

## Where it runs

| Surface | How |
| --- | --- |
| Local | `npx expo start` → http://localhost:8081/lab (`__DEV__` turns it on) |
| Deployed | https://lab.evoforge.pages.dev/lab — the `lab` branch's build is the ONLY one CI compiles with `EXPO_PUBLIC_PAGE_LAB=1` |
| Production | `/lab` renders **nothing** (the `(lab)/_layout.tsx` gate, muscle-lab doctrine) |

The `lab` branch carries **zero unique commits** — it is a deploy pointer.
Variants live on the working branch; refresh the deploy with:

```bash
git checkout lab && git merge --ff-only expo-rewrite && git push && git checkout expo-rewrite
```

## Data modes

Every variant opens in one of two modes (toggle in the gallery, or `?data=`):

- **REAL** — the app's own providers, untouched. Signed in, a lab workout IS
  a real workout (use the smoke accounts, HANDOVER §5). Signed out, hooks are
  disabled and screens sit on honest empty states.
- **MOCK** — `LabDataProvider` mounts a fresh QueryClient seeded by
  `fixtures/` under a fake session (`LAB_USER_ID`), `staleTime: Infinity`, so
  reads never touch the network. Fully interactive **provided writes go
  through the shims** (`mock/mutations.ts`).

### The hard truth about mock writes

Faking the auth context does **not** make writes safe: the server stamps
`user_id` from `auth.uid()`, and `useSaveSet` enqueues into the durable
AsyncStorage set-queue before any network. An un-shimmed write in mock mode
is a REAL write (signed in) or junk in the durable queue (signed out). Hence:

- shimmed in the baselines: **LOG SET** (via the forked exercise-logger),
  **FINISH**, **REOPEN** — they write the seeded cache only — and
  **useActivationStep**, which fires ON MOUNT and would otherwise emit
  activation-funnel telemetry under the fake session;
- NOT shimmed (v1): routine/schedule/plan saves, coin claims, cardio logging,
  unit prefs, ghost publish. The orange banner appears in mock mode whenever
  a real session exists underneath — heed it, or sign out;
- Zustand stores are **never isolated** in either mode: skips/ad-hoc
  (session-store), the rest timer, toasts are shared with the live app.

## Forking a page (the recipe)

1. Copy the screen: `src/app/(main)/today.tsx` →
   `src/lab/variants/train/<variant-id>.tsx` (workout: →
   `src/lab/variants/workout/<variant-id>.tsx`). Imports are `@/`-aliased and
   survive the move.
2. Default export → **named** export (only `src/app/` files need defaults).
3. Keep navigation inside the lab: a train fork's "open workout" push becomes
   `labWorkoutHref(...)` (`links.ts`, needs `useLabDataMode()`); a workout
   fork's back becomes `router.canGoBack() ? router.back() : router.replace('/lab')`.
4. Mock-safe writes: swap the import, keep the call sites —
   `import { useLabSaveSet as useSaveSet } from '@/lab/mock/mutations';`
   (same for finish/reopen). LOG SET lives in `ui/train/exercise-logger.tsx`,
   so a workout fork also forks that file and swaps its one import (see
   `variants/workout/baseline-exercise-logger.tsx`).
5. To redesign a shared component, copy it BESIDE the variant and repoint
   that one import — never edit `src/ui/` for a variant's sake.
6. Register it: one entry in `registry-meta.ts` (slug, title, description,
   modes) + the component in `registry.ts`'s `COMPONENTS` map.
7. Run the HANDOVER §5 loop. Variants are src files — tsc, lint, vitest and
   verify-motion all gate them.

Promoting a variant = replacing the live screen's content with the fork's
(and reverting the four fork edits above) on the working branch.

## Known limits (v1, deliberate)

- Un-shimmed mutations in mock mode reach the real backend (banner + list
  above). Shim more of `data/` as variants need them.
- A real mutation's cache invalidation can refetch a seeded key and replace
  it with an RLS-empty read — cosmetic in mock mode, fixed by remounting
  (toggle the mode).
- Deep links / hard refreshes into `/lab/**` are served by the app's service
  worker from the cached `/` shell (sw.js, cache-first navigations), so the
  console shows ONE recoverable React #418 per deep load while the router
  takes over. Cosmetic; in-app navigation from `/lab` is clean.
- Variants rot toward their source screens as the live pages evolve. The
  baselines are diff-anchors: `git diff --no-index src/app/\(main\)/today.tsx
  src/lab/variants/train/baseline.tsx` should show ONLY the fork recipe.
