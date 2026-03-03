import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',

  // Keep Prisma binaries on the server side only (Next.js 15 top-level option)
  serverExternalPackages: ['@prisma/client', 'prisma'],
}

export default nextConfig
