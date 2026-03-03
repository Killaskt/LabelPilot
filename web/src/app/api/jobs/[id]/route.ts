import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getSessionIdFromRequest } from '@/lib/session'
import { getStorageAdapter } from '@/lib/storage'
import { errorResponse } from '@/lib/errors'

type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params
  const sessionId = getSessionIdFromRequest(request)
  if (!sessionId) {
    return errorResponse('UNAUTHORIZED', 'No session found.', 401)
  }

  const job = await prisma.job.findFirst({
    where: { id, sessionId, status: { not: 'deleted' } },
    include: {
      assets: { orderBy: { assetOrder: 'asc' } },
      results: { orderBy: { createdAt: 'asc' } },
      overrides: true,
    },
  })

  if (!job) {
    return errorResponse('NOT_FOUND', 'Job not found.', 404)
  }

  const assetsWithUrls = job.assets.map((a) => ({
    ...a,
    url: `/api/assets/${job.id}/${a.id}`,
  }))

  return NextResponse.json({ job: { ...job, assets: assetsWithUrls } })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const sessionId = getSessionIdFromRequest(request)
  if (!sessionId) {
    return errorResponse('UNAUTHORIZED', 'No session found.', 401)
  }

  const job = await prisma.job.findFirst({ where: { id, sessionId } })
  if (!job) {
    return errorResponse('NOT_FOUND', 'Job not found.', 404)
  }

  await prisma.job.update({ where: { id }, data: { status: 'submitted' } })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params
  const sessionId = getSessionIdFromRequest(request)
  if (!sessionId) {
    return errorResponse('UNAUTHORIZED', 'No session found.', 401)
  }

  const job = await prisma.job.findFirst({
    where: { id, sessionId },
  })

  if (!job) {
    return errorResponse('NOT_FOUND', 'Job not found.', 404)
  }

  if (job.status === 'deleted') {
    return new NextResponse(null, { status: 204 })
  }

  await getStorageAdapter().deleteJob(id).catch((err) => {
    console.warn('[DELETE /api/jobs/:id] File deletion warning:', err)
  })

  await prisma.job.update({
    where: { id },
    data: { status: 'deleted' },
  })

  return new NextResponse(null, { status: 204 })
}
