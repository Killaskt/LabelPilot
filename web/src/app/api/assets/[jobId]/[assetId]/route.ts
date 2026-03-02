import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getSessionIdFromRequest } from '@/lib/session'
import { localStorageAdapter } from '@/lib/storage/local'
import { errorResponse } from '@/lib/errors'

type Params = { params: Promise<{ jobId: string; assetId: string }> }

// serves label images, checks session
export async function GET(request: NextRequest, { params }: Params) {
  const { jobId, assetId } = await params
  const sessionId = getSessionIdFromRequest(request)
  if (!sessionId) {
    return errorResponse('UNAUTHORIZED', 'No session found.', 401)
  }

  const asset = await prisma.jobAsset.findFirst({
    where: {
      id: assetId,
      jobId,
      job: { sessionId },
    },
  })

  if (!asset) {
    return errorResponse('NOT_FOUND', 'Asset not found.', 404)
  }

  let buffer: Buffer
  try {
    buffer = await localStorageAdapter.readFile(asset.storedPath)
  } catch {
    return errorResponse('NOT_FOUND', 'File not found on disk.', 404)
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': asset.mimeType,
      'Cache-Control': 'private, max-age=3600',
      'Content-Length': buffer.length.toString(),
    },
  })
}
