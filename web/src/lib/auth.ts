export const AUTH_COOKIE = 'lp_auth'
export const AUTH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60  // 30 days

/**
 * Returns true if the cookie value is valid for the current INVITE_CODE.
 * If INVITE_CODE is not set, auth is disabled and all requests are allowed.
 */
export function checkAuth(cookieValue: string | undefined): boolean {
  const required = process.env.INVITE_CODE
  if (!required) return true          // auth disabled in dev
  if (!cookieValue) return false
  return cookieValue === required
}
