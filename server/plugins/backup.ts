/// <reference path="../../worker-configuration.d.ts" />
import { syncMarketingLinksWithKV } from '#server/utils/sanity-sync'
import { resolveSanitySyncConfigForWorker, resolveSanitySyncEnabled } from '#server/utils/sanity-worker-config'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async (cf) => {
    const runtimeConfig = useRuntimeConfig()
    const env = cf.env as Cloudflare.Env
    const workerEnv = cf.env as Record<string, unknown>
    if (runtimeConfig.disableAutoBackup) {
      console.info('[backup:kv] Auto backup is disabled by configuration')
    }
    else {
      await backupKVToR2(env)
    }

    const sanitySyncEnabled = resolveSanitySyncEnabled(runtimeConfig, workerEnv)
    if (!sanitySyncEnabled) {
      console.info('[sanity-sync] skipped: NUXT_SANITY_SYNC_ENABLED is not true (set Worker var or secret in Cloudflare dashboard)')
      return
    }

    try {
      const result = await syncMarketingLinksWithKV({
        KV: env.KV,
        R2: env.R2,
        config: resolveSanitySyncConfigForWorker(runtimeConfig, workerEnv),
      })
      console.info('[sanity-sync] completed', result)
    }
    catch (error) {
      console.error('[sanity-sync] failed:', error)
    }
  })
})
