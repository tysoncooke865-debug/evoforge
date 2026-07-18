/**
 * SOCIAL feature flags. `feedEnabled` gates the whole feed: OFF (default) →
 * the Social tab stays an honest COMING SOON (the house rule — no mocked
 * system ships). Flip to ON only once migration 049 is APPLIED to production
 * and posts are being written, so the feed shows real data, never placeholders.
 */
export const socialFeatures = {
  feedEnabled: false,
} as const;
