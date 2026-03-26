import { isAccessAuthenticatedRequest } from '#server/utils/access-auth'

export default eventHandler((event) => {
  const token = getHeader(event, 'Authorization')?.replace(/^Bearer\s+/, '')
  const isAccessRequest = isAccessAuthenticatedRequest(event)

  if (event.path.startsWith('/api/') && !isAccessRequest && token !== useRuntimeConfig(event).siteToken) {
    throw createError({
      status: 401,
      statusText: 'Unauthorized',
    })
  }
  if (!isAccessRequest && token && token.length < 8) {
    throw createError({
      status: 401,
      statusText: 'Token is too short',
    })
  }
})
