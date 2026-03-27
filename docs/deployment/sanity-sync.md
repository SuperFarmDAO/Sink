# Sanity -> Sink Sync

Sink can pull `Custom Marketing Links` from your Sanity `gameMarketingPage` document and upsert them into KV.

## Configuration

Set these variables in your Worker environment:

- `NUXT_SANITY_PROJECT_ID`
- `NUXT_SANITY_DATASET` (usually `production`)
- `NUXT_SANITY_API_VERSION` (default `2023-10-01`)
- `NUXT_SANITY_READ_TOKEN` (optional but recommended for private datasets)
- `NUXT_SANITY_MARKETING_DOC_ID` (default `gameMarketingPage`)
- `NUXT_SANITY_SYNC_ENABLED=true` (optional; enables scheduled sync on cron)

## Manual Sync (recommended for publish flow)

Call:

- `POST /api/link/sync-sanity`

Body options:

- `{ "dryRun": true }` validate and preview without writing links
- `{ "dryRun": false }` (or empty body) performs upsert writes

This endpoint is protected by your existing auth middleware (Cloudflare Access and/or Bearer token).

## Upsert behavior

- Pulls from `customMarketingLinks` array in Sanity.
- Skips items with `isEnabled=false`.
- Uses `shortSlug`, or slugifies title if missing.
- Writes/updates Sink links by slug idempotently.
- Maps `expiresAt` into Sink `expiration` (unix seconds) when valid/future.
- Maps optional OpenGraph fields (`ogTitle`, `ogDescription`, `ogImage`) to Sink preview settings.
- Copies Sanity OG images into Sink R2 and stores the resulting `/_assets/...` path on the link.
- Maps optional `cloaking` toggle and `password` (empty password disables protection).
- Stores campaign/source/utm/instructions summary in `comment`.
- Marks synced links with metadata (`source=sanity-sync`) so they can be reconciled safely.
- Deletes previously synced Sanity-managed Sink links when they are removed or disabled in Sanity.

## Scheduled Sync

When `NUXT_SANITY_SYNC_ENABLED=true`, scheduled Worker events will also run sync.

Note: cron frequency is controlled by your Worker trigger config.

Scheduled jobs read `NUXT_SANITY_*` from the **Cloudflare Worker environment** (vars/secrets). Those values are merged with `useRuntimeConfig()` so dashboard-only settings still apply after deploy.

## Troubleshooting

- **GET `/api/link/sync-status`** (authenticated like other `/api/*` routes) returns whether sync is enabled and whether project ID / read token are present, without exposing secrets.
- Only **`customMarketingLinks`** on the `gameMarketingPage` document are synced. Changes under **Promo Codes** or other fields do not update Sink short links.
- **`NUXT_SANITY_MARKETING_DOC_ID`** must match the Sanity document `_id` (singleton is usually `gameMarketingPage`).
