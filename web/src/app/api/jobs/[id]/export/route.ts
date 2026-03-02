import { NextRequest, NextResponse } from 'next/server'
import { stringify } from 'csv-stringify/sync'
import prisma from '@/lib/prisma'
import { getSessionIdFromRequest } from '@/lib/session'
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
      results: { orderBy: [{ assetId: 'asc' }, { field: 'asc' }] },
      overrides: true,
    },
  })

  if (!job) {
    return errorResponse('NOT_FOUND', 'Job not found.', 404)
  }

  const format = request.nextUrl.searchParams.get('format') ?? 'json'

  if (format === 'csv') {
    const overrideMap = new Map(job.overrides.map((o) => [o.field, o]))
    const assetMap = new Map(job.assets.map((a) => [a.id, a.filename]))

    const rows = job.results.map((r) => {
      const ov = overrideMap.get(r.field)
      return {
        jobId: job.id,
        assetId: r.assetId,
        assetFilename: assetMap.get(r.assetId) ?? '',
        field: r.field,
        expectedValue: r.expectedValue ?? '',
        foundValue: r.foundValue ?? '',
        confidence: r.confidence?.toFixed(3) ?? '',
        systemStatus: r.status,
        needsHuman: r.needsHuman ? 'yes' : 'no',
        overrideAction: ov?.action ?? '',
        overrideNote: ov?.note ?? '',
        processingTimeMs: r.processingTimeMs?.toFixed(1) ?? '',
      }
    })

    const csv = stringify(rows, { header: true })

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="job-${job.id}.csv"`,
      },
    })
  }

  return new NextResponse(
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        job: {
          id: job.id,
          status: job.status,
          brandName: job.brandName,
          classType: job.classType,
          alcoholContent: job.alcoholContent,
          netContents: job.netContents,
          createdAt: job.createdAt,
          finishedAt: job.finishedAt,
          metrics: {
            timeToFirstResult: job.timeToFirstResult,
            avgPerLabel: job.avgPerLabel,
            p95PerLabel: job.p95PerLabel,
            totalBatchTime: job.totalBatchTime,
          },
        },
        assets: job.assets.map((a) => ({
          id: a.id,
          filename: a.filename,
          order: a.assetOrder,
        })),
        results: job.results,
        overrides: job.overrides,
      },
      null,
      2
    ),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="job-${job.id}.json"`,
      },
    }
  )
}
