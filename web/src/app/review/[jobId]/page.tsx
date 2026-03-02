import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import type { JobDetail } from '@/types'
import ReviewClient from './ReviewClient'

interface Props {
  params: Promise<{ jobId: string }>
}

export default async function ReviewPage({ params }: Props) {
  const { jobId } = await params
  const cookieStore = await cookies()
  const sessionId = cookieStore.get('reviewerSessionId')?.value

  if (!sessionId) return notFound()

  const job = await prisma.job.findFirst({
    where: { id: jobId, sessionId, status: { not: 'deleted' } },
    include: {
      assets: { orderBy: { assetOrder: 'asc' } },
      results: { orderBy: [{ assetId: 'asc' }, { field: 'asc' }] },
      overrides: true,
    },
  })

  if (!job) return notFound()

  const serializable = {
    ...job,
    expiresAt: job.expiresAt.toISOString(),
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    assets: job.assets.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
      url: `/api/assets/${job.id}/${a.id}`,
    })),
    results: job.results.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
    overrides: job.overrides.map((o) => ({
      ...o,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    })),
  } as unknown as JobDetail

  return <ReviewClient initialJob={serializable} />
}
