import type { H3Event } from 'h3'

export function getAccessAuthenticatedUser(event: H3Event): string | null {
  const email = getHeader(event, 'cf-access-authenticated-user-email')
  if (email?.trim()) {
    return email.trim()
  }
  return null
}

export function isAccessAuthenticatedRequest(event: H3Event): boolean {
  const { accessAuthEnabled } = useRuntimeConfig(event)
  if (!accessAuthEnabled) {
    return false
  }

  const user = getAccessAuthenticatedUser(event)
  const jwtAssertion = getHeader(event, 'cf-access-jwt-assertion')
  return Boolean(user || jwtAssertion)
}
