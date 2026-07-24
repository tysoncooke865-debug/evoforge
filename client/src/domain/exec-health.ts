/**
 * EXECUTIVE HEALTH SCORE — the reproducible number behind the exec dashboard.
 *
 * The rule is that the score must be computable from the same query every
 * morning and produce the same answer. So it is pure, tested, and lives here
 * rather than being assembled inside a screen. Weights and targets are DATA, so
 * changing a target is a visible one-line diff, not a rewrite.
 *
 * WHY THE FUNNEL INPUT IS COHORT-SPLIT: the Origin flow launched 2026-07-17.
 * Athletes who signed up before it never had a flow to complete, so mixing the
 * cohorts made Origin binding look like a 44% cliff that was not there. Every
 * activation figure here comes from the POST-ORIGIN cohort — the current
 * product — while retention depth still uses lifetime, because two weeks is not
 * enough time for anyone to have trained four separate days.
 */

export interface ExecFunnel {
  signed_up: number;
  profiled: number;
  origins: number;
  activated: number;
  trained_2d?: number;
  trained_4d?: number;
}

export interface ExecHealthInput {
  /** The current product's cohort — activation is judged on this. */
  post: ExecFunnel;
  /** Everyone ever — depth is judged on this. */
  lifetime: ExecFunnel;
  /** Observability: is anything watching production? */
  watchdogHealthy: boolean;
  /** Engineering: is the suite green? */
  testsGreen: boolean;
  /** Retention instrument: how many activated athletes can be reached? */
  pushSubscribers: number;
}

export interface ExecDimension {
  key: string;
  label: string;
  weight: number;
  actual: string;
  target: string;
  /** 0–100. */
  score: number;
}

/** Safe ratio — an empty cohort scores 0, never NaN and never a divide-by-zero. */
function rate(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

/** Score a rate against a target, capped at 100. */
function against(actual: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((actual / target) * 100)));
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function execDimensions(input: ExecHealthInput): ExecDimension[] {
  const { post, lifetime } = input;

  const activation = rate(post.activated, post.signed_up);
  const onboarding = rate(post.origins, post.signed_up);
  const depth2 = rate(lifetime.trained_2d ?? 0, lifetime.signed_up);
  const depth4 = rate(lifetime.trained_4d ?? 0, lifetime.signed_up);
  const reachable = rate(input.pushSubscribers, Math.max(1, lifetime.activated));

  return [
    {
      key: 'activation',
      label: 'Activation — signup → first set',
      weight: 25,
      actual: pct(activation),
      target: '60%',
      score: against(activation, 0.6),
    },
    {
      key: 'onboarding',
      label: 'Onboarding — signup → origin bound',
      weight: 10,
      actual: pct(onboarding),
      target: '80%',
      score: against(onboarding, 0.8),
    },
    {
      key: 'retention',
      label: 'Retention — trained on 2+ days',
      weight: 20,
      actual: pct(depth2),
      target: '45%',
      score: against(depth2, 0.45),
    },
    {
      key: 'depth',
      label: 'Depth — trained on 4+ days',
      weight: 15,
      actual: pct(depth4),
      target: '30%',
      score: against(depth4, 0.3),
    },
    {
      key: 'reachable',
      label: 'Reachable — activated athletes on push',
      weight: 10,
      actual: pct(reachable),
      target: '50%',
      score: against(reachable, 0.5),
    },
    {
      key: 'observability',
      label: 'Observability — production is watched',
      weight: 10,
      actual: input.watchdogHealthy ? 'watched' : 'BLIND',
      target: 'watched',
      score: input.watchdogHealthy ? 100 : 0,
    },
    {
      key: 'engineering',
      label: 'Engineering — suite green',
      weight: 10,
      actual: input.testsGreen ? 'green' : 'RED',
      target: 'green',
      score: input.testsGreen ? 100 : 0,
    },
  ];
}

/** The weighted total, 0–100. */
export function execHealthScore(input: ExecHealthInput): number {
  const dims = execDimensions(input);
  const totalWeight = dims.reduce((n, d) => n + d.weight, 0);
  if (totalWeight <= 0) return 0;
  const weighted = dims.reduce((n, d) => n + d.score * d.weight, 0);
  return Math.round(weighted / totalWeight);
}

export type HealthBand = 'critical' | 'poor' | 'fair' | 'good';

export function healthBand(score: number): HealthBand {
  if (score < 40) return 'critical';
  if (score < 60) return 'poor';
  if (score < 80) return 'fair';
  return 'good';
}
