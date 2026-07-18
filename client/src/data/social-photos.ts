import * as Crypto from 'expo-crypto';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * SOCIAL PHOTOS (migration 051) — upload a shared image to the private
 * social-media bucket under {uid}/{uuid}.jpg (RLS: own folder only) and read
 * it back through short-lived SIGNED URLs, so a link is never a permanent
 * public handle. The path (not a URL) is what a post's payload stores; the
 * feed hands paths only to authorised viewers, who sign them here.
 */
const BUCKET = 'social-media';
const SIGN_TTL = 60 * 60; // 1h

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  try {
    const comma = dataUrl.indexOf(',');
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Upload one ~1024px JPEG data URL → its storage path, or null on failure. */
export async function uploadSocialPhoto(userId: string, dataUrl: string): Promise<string | null> {
  const bytes = dataUrlToBytes(dataUrl);
  if (!bytes) return null;
  const path = `${userId}/${Crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  return error ? null : path;
}

/** Upload several photos; returns the paths that succeeded, in order. */
export async function uploadSocialPhotos(userId: string, dataUrls: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const u of dataUrls) {
    const p = await uploadSocialPhoto(userId, u);
    if (p) out.push(p);
  }
  return out;
}

/** Resolve storage paths → signed URLs. A path that is already an absolute URL
 *  (legacy/test data) passes through untouched. Empty in → empty out. */
export function useSignedPhotoUrls(paths: readonly string[]) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const key = [...paths].sort().join('|');
  return useQuery({
    queryKey: ['signed_photos', userId, key],
    enabled: userId !== null && paths.length > 0,
    staleTime: (SIGN_TTL - 300) * 1000,
    queryFn: async (): Promise<Record<string, string>> => {
      const map: Record<string, string> = {};
      const toSign = paths.filter((p) => !/^https?:\/\//.test(p));
      for (const p of paths) if (/^https?:\/\//.test(p)) map[p] = p;
      if (toSign.length === 0) return map;
      try {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(toSign, SIGN_TTL);
        if (error || !data) return map;
        for (const d of data) if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
        return map;
      } catch {
        return map;
      }
    },
  });
}
