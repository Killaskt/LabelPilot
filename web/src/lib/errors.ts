import { NextResponse } from 'next/server'

export function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: unknown
): NextResponse {
  return NextResponse.json(
    { code, message, ...(details !== undefined ? { details } : {}) },
    { status }
  )
}
