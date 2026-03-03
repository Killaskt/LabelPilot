import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { getOrCreateSessionId, getSessionIdFromRequest, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/session'
import { validateUpload, sanitizeFilename, getExtension } from '@/lib/validation'
import { getStorageAdapter } from '@/lib/storage'
import { errorResponse } from '@/lib/errors'
import { checkRateLimit } from '@/lib/rateLimit'

const jobFieldsSchema = z.object({
  brandName: z.string().min(1, 'Brand name is required').max(200),
  classType: z.string().min(1, 'Class/type is required').max(200),
  alcoholContent: z.string().min(1, 'Alcohol content is required').max(100),
  netContents: z.string().min(1, 'Net contents is required').max(100),
  bottlerInfo: z.string().max(500).optional(),
  countryOfOrigin: z.string().max(200).optional(),
})

export async function POST(request: NextRequest) {
  const { sessionId, isNew } = getOrCreateSessionId(request)

  const rateLimit = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '20', 10)
  const rateWindow = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10)
  if (!checkRateLimit(`upload:${sessionId}`, rateLimit, rateWindow)) {
    return errorResponse('RATE_LIMIT_EXCEEDED', 'Too many requests. Please wait a minute.', 429)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return errorResponse('INVALID_REQUEST', 'Could not parse form data.', 400)
  }

  const fieldsResult = jobFieldsSchema.safeParse({
    brandName: formData.get('brandName'),
    classType: formData.get('classType'),
    alcoholContent: formData.get('alcoholContent'),
    netContents: formData.get('netContents'),
    bottlerInfo: formData.get('bottlerInfo') || undefined,
    countryOfOrigin: formData.get('countryOfOrigin') || undefined,
  })
  if (!fieldsResult.success) {
    return errorResponse('VALIDATION_ERROR', 'Invalid application fields.', 400, fieldsResult.error.issues)
  }

  const files = formData.getAll('files') as File[]
  const uploadError = await validateUpload(files)
  if (uploadError) {
    return errorResponse(uploadError.code, uploadError.message, uploadError.status)
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  let job: Awaited<ReturnType<typeof prisma.job.create>> & {
    assets: Array<{ id: string; assetOrder: number }>
  }

  try {
    job = await prisma.job.create({
      data: {
        sessionId,
        status: 'queued',
        brandName: fieldsResult.data.brandName,
        classType: fieldsResult.data.classType,
        alcoholContent: fieldsResult.data.alcoholContent,
        netContents: fieldsResult.data.netContents,
        bottlerInfo: fieldsResult.data.bottlerInfo ?? null,
        countryOfOrigin: fieldsResult.data.countryOfOrigin ?? null,
        expiresAt,
        assets: {
          create: files.map((file, i) => ({
            filename: sanitizeFilename(file.name),
            storedPath: '',
            mimeType: file.type || 'image/jpeg',
            assetOrder: i,
          })),
        },
      },
      include: { assets: { orderBy: { assetOrder: 'asc' } } },
    })
  } catch (err) {
    console.error('[POST /api/jobs] DB error:', err)
    return errorResponse('DB_ERROR', 'Failed to create job.', 500)
  }

  try {
    await Promise.all(
      files.map(async (file, i) => {
        const asset = job.assets[i]
        const ext = getExtension(file.name)
        const buffer = Buffer.from(await file.arrayBuffer())
        const storedPath = await getStorageAdapter().saveFile(job.id, asset.id, ext, buffer)
        await prisma.jobAsset.update({ where: { id: asset.id }, data: { storedPath } })
      })
    )
  } catch (err) {
    console.error('[POST /api/jobs] Storage error:', err)
    await prisma.job.delete({ where: { id: job.id } }).catch(() => undefined)
    await getStorageAdapter().deleteJob(job.id).catch(() => undefined)
    return errorResponse('STORAGE_ERROR', 'Failed to save uploaded files.', 500)
  }

  const response = NextResponse.json({ jobId: job.id }, { status: 201 })
  if (isNew) {
    response.cookies.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      maxAge: SESSION_MAX_AGE,
      path: '/',
      sameSite: 'lax',
    })
  }
  return response
}

export async function GET(request: NextRequest) {
  const sessionId = getSessionIdFromRequest(request)
  if (!sessionId) {
    return NextResponse.json({ jobs: [] })
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const jobs = await prisma.job.findMany({
    where: {
      sessionId,
      createdAt: { gte: since },
      status: { not: 'deleted' },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      assets: {
        select: { id: true, filename: true, assetOrder: true },
        orderBy: { assetOrder: 'asc' },
      },
      _count: { select: { results: true } },
    },
  })

  return NextResponse.json({ jobs })
}
