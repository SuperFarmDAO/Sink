import { getWorkerEnvRecord, resolveSanitySyncConfigForWorker, resolveSanitySyncEnabled } from '#server/utils/sanity-worker-config'

defineRouteMeta({
  openAPI: {
    description: 'Sanity sync configuration status (no secrets returned)',
    security: [{ bearerAuth: [] }],
  },
})

export default eventHandler((event) => {
  const runtimeConfig = useRuntimeConfig(event)
  const workerEnv = getWorkerEnvRecord(event)
  const sanitySyncEnabled = resolveSanitySyncEnabled(runtimeConfig, workerEnv)
  const sanity = resolveSanitySyncConfigForWorker(runtimeConfig, workerEnv)

  return {
    sanitySyncEnabled,
    sanityProjectIdPresent: Boolean(sanity.sanityProjectId),
    sanityDataset: sanity.sanityDataset,
    sanityMarketingDocId: sanity.sanityMarketingDocId,
    sanityReadTokenPresent: Boolean(sanity.sanityReadToken),
    caseSensitive: sanity.caseSensitive,
  }
})
