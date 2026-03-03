// Auth is enforced in app/(protected)/layout.tsx (server component) rather than
// here, because Next.js middleware runs in the Edge Runtime where runtime-injected
// env vars (e.g. INVITE_CODE set by Container Apps) are not available.
// This file is kept as a placeholder in case edge-level logic is added later.
export function middleware() {}
export const config = { matcher: [] }
