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
