/**
 * Shared plumbing for the AI Edge Functions (MIGRATION_PLAN "AI via Edge
 * Functions"). Deno runtime.
 *
 * THE WHOLE POINT of these functions is that OPENAI_API_KEY lives here,
 * server-side, and that result rows are written WITH THE CALLER'S JWT -- RLS
 * applies, so a client cannot forge scores into someone else's account, and
 * the function cannot write anywhere the caller couldn't.
 *
 * Photos arrive as data URLs, go to OpenAI, and are DISCARDED. Only the
 * sha256 of the bytes is stored (ai_scan_cache), for the result cache and the
 * hourly rate limit.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const HOURLY_LIMIT = 10;
const DEFAULT_MODEL = 'gpt-5.1';
/**
 * COST/LATENCY ROUTING (2026-07-16): generation and transcription
 * (ai-plan, ai-plan-scan) ride the mini model with low reasoning effort —
 * ~5× cheaper per token and faster, and their outputs are the LARGE ones
 * (a whole week of JSON), so they dominate per-call cost. The JUDGES
 * (bodyfat, physique, battle-physique) stay on DEFAULT_MODEL untouched:
 * verdict consistency across an athlete's history and battle fairness
 * outrank pennies.
 */
export const FAST_MODEL = 'gpt-5-mini';

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** A supabase client that acts AS THE CALLER. No JWT -> 401. */
export function callerClient(req: Request): SupabaseClient | null {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hourly circuit breaker: count the caller's scans in the last hour. */
export async function rateLimited(sb: SupabaseClient): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count, error } = await sb
    .from('ai_scan_cache')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', oneHourAgo);
  if (error) return false; // pre-007: no cache table, no limit -- fail open on the limiter only
  return (count ?? 0) >= HOURLY_LIMIT;
}

export async function cachedResult(
  sb: SupabaseClient,
  kind: string,
  imageHash: string
): Promise<Record<string, unknown> | null> {
  const { data, error } = await sb
    .from('ai_scan_cache')
    .select('result')
    .eq('kind', kind)
    .eq('image_hash', imageHash)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0].result as Record<string, unknown>;
}

export async function storeCache(
  sb: SupabaseClient,
  kind: string,
  imageHash: string,
  result: Record<string, unknown>
): Promise<void> {
  // Best effort; pre-007 this fails and the scan still returns.
  await sb.from('ai_scan_cache').insert({ kind, image_hash: imageHash, result });
}

/**
 * One OpenAI Responses API round trip -> parsed JSON. Mirrors the Python
 * services: output_text, strip code fences, JSON.parse, validate keys.
 */
export async function callOpenAiJson(
  userText: string,
  imageDataUrls: string[],
  requiredKeys: string[],
  model = DEFAULT_MODEL,
  /** 'low' for extraction/transcription — reasoning tokens bill as OUTPUT
   *  tokens, so an unbounded think on a transcription job is pure waste.
   *  Omit for the judges: their behaviour must not change. */
  reasoningEffort?: 'low' | 'medium'
): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    return { data: null, error: 'OPENAI_API_KEY is not set on this function.' };
  }

  const content: Record<string, unknown>[] = [{ type: 'input_text', text: userText }];
  for (const url of imageDataUrls) {
    content.push({ type: 'input_image', image_url: url });
  }

  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [{ role: 'user', content }],
      // JSON mode: a malformed response is a WASTED PAID CALL (the caller
      // errors and the athlete retries). Every prompt already demands JSON.
      text: { format: { type: 'json_object' } },
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    return { data: null, error: `OpenAI ${resp.status}: ${detail.slice(0, 300)}` };
  }

  const payload = await resp.json();
  // Responses API: output[].content[].text — output_text is the SDK's sugar.
  let text: string | undefined = payload.output_text;
  if (!text && Array.isArray(payload.output)) {
    text = payload.output
      .flatMap((o: { content?: { text?: string }[] }) => o.content ?? [])
      .map((c: { text?: string }) => c.text ?? '')
      .join('');
  }
  if (!text) return { data: null, error: 'OpenAI returned no text output.' };

  try {
    const cleaned = text.trim().replaceAll('```json', '').replaceAll('```', '').trim();
    const data = JSON.parse(cleaned) as Record<string, unknown>;
    for (const key of requiredKeys) {
      if (!(key in data)) {
        return { data: null, error: `AI response missing key: ${key}. Raw: ${text.slice(0, 300)}` };
      }
    }
    return { data, error: null };
  } catch {
    return { data: null, error: `AI returned non-JSON. Raw: ${text.slice(0, 300)}` };
  }
}

export const nowIsoSeconds = () => new Date().toISOString().slice(0, 19);
