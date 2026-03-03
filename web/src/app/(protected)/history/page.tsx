import { cookies } from 'next/headers'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { DeleteButton } from './DeleteButton'
import type { CSSProperties } from 'react'

const stickyColHead: CSSProperties = {
  position: 'sticky',
  right: 0,
  background: '#f8fafc',
  boxShadow: '-2px 0 5px rgba(0,0,0,0.06)',
  zIndex: 1,
}

const stickyColCell: CSSProperties = {
  position: 'sticky',
  right: 0,
  background: '#fff',
  boxShadow: '-2px 0 5px rgba(0,0,0,0.06)',
}

const STATUS_LABEL: Record<string, string> = {
  ready: 'Ready',
  needs_human: 'Needs Review',
  error: 'Error',
  deleted: 'Deleted',
  expired: 'Expired',
}

function formatDate(iso: Date): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default async function HistoryPage() {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get('reviewerSessionId')?.value

  const jobs = sessionId
    ? await prisma.job.findMany({
        where: {
          sessionId,
          status: { notIn: ['deleted'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          _count: { select: { assets: true, results: true } },
        },
      })
    : []

  return (
    <main className="page">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1>Review History</h1>
          <p className="page-subtitle">
            Your recent submissions. Jobs are automatically deleted 24 hours after submission.
          </p>
        </div>
        <Link href="/upload" className="btn btn-primary btn-sm">+ New Submission</Link>
      </div>

      <div className="alert alert-warning mb-2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        ⚠️ All submissions auto-delete 24 hours after creation. Export before they expire.
      </div>

      {jobs.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p className="text-muted">No history found for this session.</p>
          <Link href="/upload" className="btn btn-primary mt-2" style={{ display: 'inline-flex' }}>
            Submit your first label
          </Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Brand / Class</th>
                <th>Status</th>
                <th>Images</th>
                <th>Submitted</th>
                <th>Processed</th>
                <th>Expires</th>
                <th style={stickyColHead}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const isReviewable = ['ready', 'needs_human'].includes(job.status)
                const expiresAt = new Date(job.expiresAt)
                const isExpiringSoon = (expiresAt.getTime() - Date.now()) < 2 * 60 * 60 * 1000

                return (
                  <tr key={job.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{job.brandName}</div>
                      <div className="text-xs text-muted">{job.classType}</div>
                    </td>
                    <td>
                      <span className={`badge badge-${job.status}`}>
                        {STATUS_LABEL[job.status] ?? job.status}
                      </span>
                    </td>
                    <td className="text-sm">{job._count.assets}</td>
                    <td className="text-sm">{formatDate(job.createdAt)}</td>
                    <td className="text-sm">{job.finishedAt ? formatDate(job.finishedAt) : '—'}</td>
                    <td className="text-sm" style={{ color: isExpiringSoon ? 'var(--color-error)' : undefined }}>
                      {formatDate(expiresAt)}
                    </td>
                    <td style={stickyColCell}>
                      <div className="flex-gap">
                        {isReviewable && (
                          <Link href={`/review/${job.id}`} className="btn btn-accent btn-xs">
                            Review
                          </Link>
                        )}
                        {isReviewable && (
                          <>
                            <Link href={`/api/jobs/${job.id}/export?format=csv`} className="btn btn-ghost btn-xs">CSV</Link>
                            <Link href={`/api/jobs/${job.id}/export?format=json`} className="btn btn-ghost btn-xs">JSON</Link>
                          </>
                        )}
                        <DeleteButton jobId={job.id} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}

