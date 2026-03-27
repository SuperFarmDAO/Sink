import type { H3Event } from 'h3'

/**
 * Cloudflare Worker `env` holds dashboard-defined vars/secrets. Scheduled cron and
 * HTTP handlers must merge these with `useRuntimeConfig()` or build-time defaults
 * can miss `NUXT_SANITY_*` values set only in the Cloudflare dashboard.
 */
function pickString(env: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = env?.[key]
  return typeof value === 'string' ? value : undefined
}

export function resolveSanitySyncEnabled(
  runtimeConfig: ReturnType<typeof useRuntimeConfig>,
  workerEnv?: Record<string, unknown> | null,
): boolean {
  const raw = pickString(workerEnv ?? undefined, 'NUXT_SANITY_SYNC_ENABLED')
  if (raw === 'true' || raw === '1') {
    return true
  }
  if (raw === 'false' || raw === '0') {
    return false
  }
  return Boolean(runtimeConfig.sanitySyncEnabled)
}

export function resolveSanitySyncConfigForWorker(
  runtimeConfig: ReturnType<typeof useRuntimeConfig>,
  workerEnv?: Record<string, unknown> | null,
) {
  const env = workerEnv ?? undefined
  return {
    sanityProjectId: pickString(env, 'NUXT_SANITY_PROJECT_ID') ?? String(runtimeConfig.sanityProjectId ?? ''),
    sanityDataset: pickString(env, 'NUXT_SANITY_DATASET') ?? String(runtimeConfig.sanityDataset ?? 'production'),
    sanityApiVersion: pickString(env, 'NUXT_SANITY_API_VERSION') ?? String(runtimeConfig.sanityApiVersion ?? '2023-10-01'),
    sanityReadToken: pickString(env, 'NUXT_SANITY_READ_TOKEN') ?? String(runtimeConfig.sanityReadToken ?? ''),
    sanityMarketingDocId: pickString(env, 'NUXT_SANITY_MARKETING_DOC_ID')
      ?? String(runtimeConfig.sanityMarketingDocId ?? 'gameMarketingPage'),
    caseSensitive: Boolean(runtimeConfig.caseSensitive),
  }
}

export function getWorkerEnvRecord(event: H3Event): Record<string, unknown> | undefined {
  return event.context?.cloudflare?.env as Record<string, unknown> | undefined
}
