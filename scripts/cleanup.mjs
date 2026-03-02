#!/usr/bin/env node
/**
 * Cleanup script — deletes expired jobs and their local files.
 *
 * Usage:
 *   node scripts/cleanup.mjs              # dry run (shows what would be deleted)
 *   node scripts/cleanup.mjs --execute    # actually deletes
 *
 * Or via npm: `npm run cleanup` from web/ (always dry-run unless --execute passed)
 */

import { PrismaClient } from '@prisma/client'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXECUTE = process.argv.includes('--execute')

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL ?? 'file:../web/prisma/dev.db' },
  },
})

function getUploadDir() {
  const env = process.env.UPLOAD_DIR
  if (env) return path.isAbsolute(env) ? env : path.resolve(process.cwd(), env)
  return path.resolve(__dirname, '..', 'local_uploads')
}

async function main() {
  console.log(`Cleanup script [${EXECUTE ? 'EXECUTE' : 'DRY RUN'}]`)
  console.log(`Timestamp: ${new Date().toISOString()}\n`)

  const now = new Date()
  const uploadDir = getUploadDir()

  // Find expired or deleted jobs
  const candidates = await prisma.job.findMany({
    where: {
      OR: [
        { expiresAt: { lt: now }, status: { not: 'deleted' } },
        { status: 'deleted' },
      ],
    },
    select: { id: true, status: true, expiresAt: true, brandName: true },
  })

  if (candidates.length === 0) {
    console.log('No expired or deleted jobs found.')
    await prisma.$disconnect()
    return
  }

  console.log(`Found ${candidates.length} job(s) to clean up:\n`)

  let deletedFiles = 0
  let deletedJobs = 0

  for (const job of candidates) {
    const jobDir = path.join(uploadDir, job.id)
    const reason = job.status === 'deleted' ? 'manually deleted' : `expired at ${job.expiresAt.toISOString()}`

    console.log(`  Job ${job.id} (${job.brandName}) — ${reason}`)

    if (EXECUTE) {
      // Delete files
      try {
        await fs.rm(jobDir, { recursive: true, force: true })
        console.log(`    ✓ Deleted files: ${jobDir}`)
        deletedFiles++
      } catch (err) {
        console.warn(`    ⚠ Could not delete files: ${err.message}`)
      }

      // Mark as expired (or truly delete — we soft-delete to preserve audit trail)
      await prisma.job.update({
        where: { id: job.id },
        data: { status: 'expired' },
      })
      deletedJobs++
    } else {
      console.log(`    [dry-run] Would delete: ${jobDir}`)
    }
  }

  if (EXECUTE) {
    console.log(`\nDone. ${deletedJobs} job(s) marked expired, ${deletedFiles} file folder(s) removed.`)
  } else {
    console.log(`\n[Dry run complete] Pass --execute to actually delete.`)
  }

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error('Cleanup failed:', err)
  process.exit(1)
})
