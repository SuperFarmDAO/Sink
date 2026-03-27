import type { Link } from '#shared/schemas/link'
import type { H3Event } from 'h3'
import { getWorkerEnvRecord, resolveSanitySyncConfigForWorker } from '#server/utils/sanity-worker-config'
import { LinkSchema, nanoid } from '#shared/schemas/link'
import { IMAGE_ALLOWED_TYPES, IMAGE_MAX_SIZE } from '@/utils/image'

interface SanityMarketingLink {
  title?: string
  shortSlug?: string
  destinationUrl?: string
  ogTitle?: string
  ogDescription?: string
  ogImageUrl?: string
  campaignId?: string
  influencerSource?: string
  utmSource?: string
  utmCampaign?: string
  cloaking?: boolean
  password?: string
  isEnabled?: boolean
  expiresAt?: string
  instructions?: string
}

interface SanityQueryResponse {
  result?: {
    _id?: string
    customMarketingLinks?: SanityMarketingLink[]
  } | null
}

interface SyncConfig {
  sanityProjectId: string
  sanityDataset: string
  sanityApiVersion: string
  sanityReadToken: string
  sanityMarketingDocId: string
  caseSensitive: boolean
}

interface SyncOptions {
  dryRun?: boolean
}

interface SyncSummary {
  sourceCount: number
  upserted: number
  deleted: number
  skippedDisabled: number
  skippedInvalid: number
  errors: string[]
}

function normalizeSlugWithCase(slug: string, caseSensitive: boolean): string {
  return caseSensitive ? slug : slug.toLowerCase()
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function toExpiration(expiresAt?: string): number | undefined {
  if (!expiresAt) {
    return undefined
  }
  const timestamp = Math.floor(new Date(expiresAt).getTime() / 1000)
  if (!Number.isFinite(timestamp) || timestamp <= Math.floor(Date.now() / 1000)) {
    return undefined
  }
  return timestamp
}

function normalizeSanityApiVersion(version: string): string {
  const trimmed = version.trim()
  if (!trimmed) {
    return 'v2023-10-01'
  }
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`
}

function buildComment(link: SanityMarketingLink): string | undefined {
  const parts = [
    'source=sanity',
    link.campaignId ? `campaign=${link.campaignId}` : '',
    link.influencerSource ? `influencer=${link.influencerSource}` : '',
    link.utmSource ? `utm_source=${link.utmSource}` : '',
    link.utmCampaign ? `utm_campaign=${link.utmCampaign}` : '',
    link.instructions ? `notes=${link.instructions.replace(/\s+/g, ' ').trim()}` : '',
  ].filter(Boolean)

  if (!parts.length) {
    return undefined
  }

  return parts.join(' | ').slice(0, 2048)
}

interface MarketingSourceResult {
  documentId: string
  links: SanityMarketingLink[]
}

async function fetchMarketingLinksFromSanity(config: SyncConfig): Promise<MarketingSourceResult> {
  if (!config.sanityProjectId || !config.sanityDataset) {
    throw new Error('Sanity project or dataset is not configured')
  }

  const projection = `{_id, customMarketingLinks[]{title, shortSlug, destinationUrl, ogTitle, ogDescription, "ogImageUrl": ogImage.asset->url, campaignId, influencerSource, utmSource, utmCampaign, cloaking, password, isEnabled, expiresAt, instructions}}`
  const query = `coalesce(*[_type == "gameMarketingPage" && (_id == $docId || _id == "drafts." + $docId)]${projection}[0], *[_type == "gameMarketingPage"]${projection}[0])`
  const apiVersion = normalizeSanityApiVersion(config.sanityApiVersion)
  const endpoint = `https://${config.sanityProjectId}.api.sanity.io/${apiVersion}/data/query/${config.sanityDataset}`

  let response: SanityQueryResponse
  try {
    response = await $fetch<SanityQueryResponse>(endpoint, {
      query: {
        query,
        $docId: JSON.stringify(config.sanityMarketingDocId),
      },
      headers: config.sanityReadToken
        ? { Authorization: `Bearer ${config.sanityReadToken}` }
        : undefined,
    })
  }
  catch (error) {
    const fetchError = error as {
      status?: number
      statusCode?: number
      data?: unknown
      response?: { _data?: unknown }
      message?: string
    }
    const status = fetchError.status || fetchError.statusCode || 'unknown'
    const details = fetchError.data ?? fetchError.response?._data
    const detailsText = details
      ? ` ${JSON.stringify(details)}`
      : ''
    throw new Error(`[sanity-sync] query failed (${status}): ${fetchError.message || 'Unknown error'}${detailsText}`)
  }

  const result = response?.result
  if (!result) {
    throw new Error('Sanity gameMarketingPage document was not found; aborting sync')
  }

  return {
    documentId: result._id || config.sanityMarketingDocId,
    links: result.customMarketingLinks || [],
  }
}

function optionalTrimmedString(value: string | null | undefined): string | undefined {
  if (value == null) {
    return undefined
  }
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function createLinkPayload(source: SanityMarketingLink, caseSensitive: boolean): Link {
  const candidateSlug = source.shortSlug?.trim()
    || slugify(source.title || '')
    || `marketing-${nanoid(6)()}`
  const slug = normalizeSlugWithCase(candidateSlug, caseSensitive)
  const comment = buildComment(source)
  const expiration = toExpiration(source.expiresAt)

  const password = source.password?.trim() || undefined

  return LinkSchema.parse({
    slug,
    url: source.destinationUrl,
    title: optionalTrimmedString(source.ogTitle) ?? optionalTrimmedString(source.title),
    description: optionalTrimmedString(source.ogDescription),
    image: optionalTrimmedString(source.ogImageUrl),
    cloaking: source.cloaking,
    password,
    comment,
    expiration,
  })
}

export async function syncMarketingLinks(
  event: H3Event,
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const config: SyncConfig = resolveSanitySyncConfigForWorker(
    useRuntimeConfig(event),
    getWorkerEnvRecord(event),
  )
  return syncMarketingLinksWithKV({
    KV: event.context.cloudflare.env.KV,
    R2: event.context.cloudflare.env.R2,
    config,
    dryRun: options.dryRun,
  })
}

interface SyncWithKVOptions {
  KV: KVNamespace
  R2?: R2Bucket
  config: SyncConfig
  dryRun?: boolean
}

export async function syncMarketingLinksWithKV(options: SyncWithKVOptions): Promise<SyncSummary> {
  const summary: SyncSummary = {
    sourceCount: 0,
    upserted: 0,
    deleted: 0,
    skippedDisabled: 0,
    skippedInvalid: 0,
    errors: [],
  }

  const { KV, R2, config, dryRun } = options
  const sourceResult = await fetchMarketingLinksFromSanity(config)
  const sourceLinks = sourceResult.links
  summary.sourceCount = sourceLinks.length
  const now = Math.floor(Date.now() / 1000)
  const desiredSlugs = new Set<string>()

  for (const source of sourceLinks) {
    if (source.isEnabled === false) {
      summary.skippedDisabled += 1
      continue
    }

    try {
      const payload = createLinkPayload(source, config.caseSensitive)
      desiredSlugs.add(payload.slug)
      const key = `link:${payload.slug}`
      const { value: existingRaw, metadata } = await KV.getWithMetadata(key, { type: 'json' }) as {
        value: Link | null
        metadata: Record<string, unknown> | null
      }
      const existing = existingRaw
      const existingSourceImageUrl = typeof metadata?.sourceImageUrl === 'string' ? metadata.sourceImageUrl : undefined
      const imagePath = await resolveSyncedImagePath({
        source,
        slug: payload.slug,
        existingImagePath: existing?.image,
        existingSourceImageUrl,
        R2,
        dryRun: Boolean(dryRun),
      })
      const upsertedLink = LinkSchema.parse({
        ...existing,
        ...payload,
        image: imagePath || payload.image,
        slug: payload.slug,
        id: existing?.id || payload.id,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      })

      if (!dryRun) {
        await KV.put(key, JSON.stringify(upsertedLink), {
          expiration: upsertedLink.expiration,
          metadata: {
            source: 'sanity-sync',
            sanityDocId: sourceResult.documentId,
            syncedAt: now,
            sourceImageUrl: source.ogImageUrl,
            expiration: upsertedLink.expiration,
            url: upsertedLink.url,
            comment: upsertedLink.comment,
          },
        })
      }
      summary.upserted += 1
    }
    catch (error) {
      summary.skippedInvalid += 1
      summary.errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  const managedSlugs = await listManagedSanitySlugs(KV, sourceResult.documentId)
  const staleSlugs = managedSlugs.filter(slug => !desiredSlugs.has(slug))
  summary.deleted = staleSlugs.length

  if (!dryRun) {
    await Promise.all(staleSlugs.map(slug => KV.delete(`link:${slug}`)))
  }

  return summary
}

async function listManagedSanitySlugs(KV: KVNamespace, sanityDocId: string): Promise<string[]> {
  const managedSlugs: string[] = []
  let cursor: string | undefined

  do {
    const page = await KV.list({
      prefix: 'link:',
      cursor,
      limit: 1000,
    })
    cursor = page.list_complete ? undefined : page.cursor

    for (const key of page.keys || []) {
      const { metadata } = await KV.getWithMetadata(key.name)
      const meta = (metadata || {}) as Record<string, unknown>
      if (meta.source === 'sanity-sync' && meta.sanityDocId === sanityDocId) {
        managedSlugs.push(key.name.replace(/^link:/, ''))
      }
    }
  } while (cursor)

  return managedSlugs
}

interface ResolveImageOptions {
  source: SanityMarketingLink
  slug: string
  existingImagePath?: string
  existingSourceImageUrl?: string
  R2?: R2Bucket
  dryRun: boolean
}

async function resolveSyncedImagePath(options: ResolveImageOptions): Promise<string | undefined> {
  const { source, slug, existingImagePath, existingSourceImageUrl, R2, dryRun } = options
  const sourceUrl = source.ogImageUrl?.trim()
  if (!sourceUrl) {
    return undefined
  }

  if (existingImagePath && existingSourceImageUrl && existingSourceImageUrl === sourceUrl) {
    return existingImagePath
  }

  if (!R2 || dryRun) {
    return existingImagePath
  }

  const response = await fetch(sourceUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch OG image from Sanity: ${response.status}`)
  }

  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || ''
  if (!IMAGE_ALLOWED_TYPES.includes(contentType)) {
    throw new Error(`Unsupported OG image type: ${contentType || 'unknown'}`)
  }

  const imageBytes = await response.arrayBuffer()
  if (imageBytes.byteLength > IMAGE_MAX_SIZE) {
    throw new Error(`OG image exceeds max size (${IMAGE_MAX_SIZE} bytes)`)
  }

  const ext = extensionFromType(contentType, sourceUrl)
  const key = `images/${slug}/sanity-${nanoid(10)()}.${ext}`
  await R2.put(key, imageBytes, {
    httpMetadata: {
      contentType,
    },
  })

  return `/_assets/${key}`
}

function extensionFromType(contentType: string, sourceUrl: string): string {
  const extByType: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  }
  if (extByType[contentType]) {
    return extByType[contentType]
  }

  const path = sourceUrl.split('?')[0] || ''
  const matched = path.match(/\.([a-z0-9]+)$/i)
  return matched?.[1]?.toLowerCase() || 'jpg'
}
