/**
 * HOME'S BACKDROP — the shared implementation now lives in
 * `ui/core/ambience.tsx`, because Train (2026-08-03) asked for the same
 * drifting fog and the same rising motes and two copies of one 34-second
 * driver is two copies of the same bug.
 *
 * This name is kept as the alias Home imports (and the Page Lab's baseline
 * fork of Home imports), so the generalisation costs the Home screen nothing.
 */

export { ScreenAmbience as HomeAmbience } from '@/ui/core/ambience';
