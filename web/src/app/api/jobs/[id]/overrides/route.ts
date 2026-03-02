import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { getSessionIdFromRequest } from '@/lib/session'
import { errorResponse } from '@/lib/errors'
import { ALL_FIELDS } from '@/types'

const overrideSchema = z.object({
  field: z.enum(ALL_FIELDS as [string, ...string[]]),
  action: z.enum(['accept', 'reject', 'needs_human']),
  assetId: z.string().optional(),
  note: z.string().max(500).optional(),
})

const resetSchema = z.object({
  field: z.enum(ALL_FIELDS as [string, ...string[]]),
})

type Params = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const sessionId = getSessionIdFromRequest(request)
  if (!sessionId) {
    return errorResponse('UNAUTHORIZED', 'No session found.', 401)
  }

  const job = await prisma.job.findFirst({
    where: { id, sessionId, status: { not: 'deleted' } },
  })
  if (!job) {
    return errorResponse('NOT_FOUND', 'Job not found.', 404)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('INVALID_REQUEST', 'Invalid JSON body.', 400)
  }

  const parsed = overrideSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('VALIDATION_ERROR', 'Invalid override data.', 400, parsed.error.issues)
  }

  const { field, action, assetId, note } = parsed.data

  const override = await prisma.override.upsert({
    where: { jobId_field: { jobId: id, field } },
    create: { jobId: id, field, action, assetId: assetId ?? null, note: note ?? null },
    update: { action, assetId: assetId ?? null, note: note ?? null },
  })

  return NextResponse.json({ override }, { status: 200 })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params
  const sessionId = getSessionIdFromRequest(request)
  if (!sessionId) {
    return errorResponse('UNAUTHORIZED', 'No session found.', 401)
  }

  const job = await prisma.job.findFirst({
    where: { id, sessionId, status: { not: 'deleted' } },
  })
  if (!job) {
    return errorResponse('NOT_FOUND', 'Job not found.', 404)
  }

  const field = request.nextUrl.searchParams.get('field')
  const parsed = resetSchema.safeParse({ field })
  if (!parsed.success) {
    return errorResponse('VALIDATION_ERROR', 'Invalid field.', 400)
  }

  await prisma.override.deleteMany({
    where: { jobId: id, field: parsed.data.field },
  })

  return new NextResponse(null, { status: 204 })
}
