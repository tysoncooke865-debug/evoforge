import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * EXEC DASHBOARD — the read/act side (migration 087).
 *
 * Every RPC re-checks `is_app_admin()` server-side and raises otherwise, so
 * these are safe to call from any authenticated client: the screen's gate is
 * defence in depth, never the gate itself.
 *
 * Quick actions are mutations on purpose — each one invalidates what it
 * changed, so the page reflects the world rather than what we hoped happened.
 */

export interface ExecFunnelRow {
  signed_up: number;
  profiled: number;
  origins: number;
  activated: number;
  trained_2d?: number;
  trained_4d?: number;
}

export interface ExecOverview {
  generated_at: string;
  lifetime: ExecFunnelRow;
  post_origin_cohort: ExecFunnelRow;
  sets_7d: number;
  alerts_open: number;
  alerts_critical: number;
  push_subscribers: number;
  last_agent_at: string | null;
  last_watchdog_scan: string | null;
}

export interface ExecAlert {
  id: string;
  kind: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: Record<string, unknown>;
  subject_id: string | null;
  opened_at: string;
  notified_at: string | null;
}

export interface ExecAgentRow {
  id: string;
  session_id: string;
  department: string;
  task: string;
  status: 'running' | 'done' | 'failed' | 'blocked';
  model: string | null;
  commit_sha: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface ExecActionRow {
  id: string;
  action: string;
  detail: Record<string, unknown>;
  at: string;
}

export function useIsAdmin() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['is_app_admin', session?.user?.id ?? null],
    enabled: Boolean(session?.user?.id),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_app_admin');
      if (error) return false;
      return data === true;
    },
  });
}

/** The whole front page in one round trip. Polls; alerts are the urgent bit. */
export function useExecOverview(enabled: boolean) {
  return useQuery({
    queryKey: ['exec_overview'],
    enabled,
    refetchInterval: 30_000,
    queryFn: async (): Promise<ExecOverview | null> => {
      const { data, error } = await supabase.rpc('exec_overview');
      if (error) throw error;
      return (data ?? null) as ExecOverview | null;
    },
  });
}

export function useExecAlerts(enabled: boolean) {
  return useQuery({
    queryKey: ['exec_alerts'],
    enabled,
    refetchInterval: 30_000,
    queryFn: async (): Promise<ExecAlert[]> => {
      const { data, error } = await supabase.rpc('exec_alerts_open');
      if (error) throw error;
      return (data ?? []) as ExecAlert[];
    },
  });
}

export function useExecAgents(enabled: boolean) {
  return useQuery({
    queryKey: ['exec_agents'],
    enabled,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ExecAgentRow[]> => {
      const { data, error } = await supabase.rpc('exec_agent_recent', { p_limit: 20 });
      if (error) throw error;
      return (data ?? []) as ExecAgentRow[];
    },
  });
}

export function useExecActions(enabled: boolean) {
  return useQuery({
    queryKey: ['exec_actions'],
    enabled,
    queryFn: async (): Promise<ExecActionRow[]> => {
      const { data, error } = await supabase.rpc('exec_actions_recent', { p_limit: 15 });
      if (error) throw error;
      return (data ?? []) as ExecActionRow[];
    },
  });
}

/** Quick actions. Each is admin-gated and audited server-side (087). */
export function useExecAction() {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['exec_overview'] });
    void queryClient.invalidateQueries({ queryKey: ['exec_alerts'] });
    void queryClient.invalidateQueries({ queryKey: ['exec_actions'] });
  };

  const runWatchdog = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('exec_run_watchdog');
      if (error) throw error;
      return data;
    },
    onSuccess: refresh,
  });

  const snapshot = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('exec_snapshot_now');
      if (error) throw error;
      return data;
    },
    onSuccess: refresh,
  });

  const resolveAlert = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('exec_resolve_alert', { p_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: refresh,
  });

  const setWatchdog = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { data, error } = await supabase.rpc('exec_set_watchdog', { p_enabled: enabled });
      if (error) throw error;
      return data;
    },
    onSuccess: refresh,
  });

  return { runWatchdog, snapshot, resolveAlert, setWatchdog };
}

/* ── the Command Centre bridge ────────────────────────────────────────────────
 *
 * /exec and /insights answer "how is the product doing". The Command Centre
 * answers "what are we building, and who approved it". Until now those were
 * separate tools, so a founder looking at a 0% activation figure here had no
 * way to see that an opportunity had already been raised from that exact
 * number, or that a work order was in flight against it — and the same fact got
 * rediscovered, sometimes re-decided, in the other place.
 *
 * ONE read-only RPC does it. The command_* tables are governed (founders hold
 * SELECT and nothing else, every mutation is an audited SECURITY DEFINER RPC);
 * exposing them to the app would mean maintaining that boundary twice and
 * getting it wrong once.
 *
 * command_app_summary() gates on is_founder() INSIDE the function and returns
 * {available:false} for anyone else rather than raising — an athlete who is an
 * app_admin but not a founder must see the panel absent, not a crash.
 */
export interface CommandSummary {
  available: boolean
  reason?: string
  generated_at?: string
  awaiting_founder?: { proposals: number; releases: number; tasks: number }
  in_flight?: { work_orders: number; tasks_building: number; runner_online: boolean }
  outcomes?: { measuring: number; validated: number; regressed: number; neutral: number }
  experiments?: { running: number; total: number }
  top_opportunities?: {
    ref: string
    title: string
    classification: string
    category: string | null
    status: string
    metric: string | null
    baseline: string | null
    target: string | null
    score: number
    evidence_count: number
  }[]
  recent_evidence?: {
    kind: 'fact' | 'interpretation' | 'hypothesis'
    summary: string
    excerpt: string | null
    confidence: number
    collected_at: string
  }[]
}

/** Command Centre state, for founders only. Never throws: a governance refusal
 *  must render as an absent panel, not as a broken product screen. */
export function useCommandSummary() {
  const { session } = useAuth()
  const userId = session?.user?.id ?? null
  return useQuery({
    queryKey: ['command_app_summary', userId],
    enabled: userId !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<CommandSummary> => {
      try {
        const { data, error } = await supabase.rpc('command_app_summary')
        if (error) return { available: false, reason: error.message }
        return (data ?? { available: false }) as CommandSummary
      } catch {
        return { available: false, reason: 'unreachable' }
      }
    },
  })
}
