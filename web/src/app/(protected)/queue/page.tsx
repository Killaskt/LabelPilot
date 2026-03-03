'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { type JobStatus } from '@/types'

// Only "submitted" (human clicked Done) and housekeeping statuses leave the Queue.
// ready/needs_human/error all stay — OCR confidence alone is not a human sign-off.
const HIDE_FROM_QUEUE = new Set<JobStatus>(['submitted', 'deleted', 'expired'])

interface QueueJob {
  id: string
  status: JobStatus
  brandName: string
  classType: string
  createdAt: string
  assets: { id: string; filename: string; assetOrder: number }[]
  _count: { results: number }
}

const stickyColHead: React.CSSProperties = {
  position: 'sticky',
  right: 0,
  background: '#f8fafc',
  boxShadow: '-2px 0 5px rgba(0,0,0,0.06)',
  zIndex: 1,
}

const stickyColCell: React.CSSProperties = {
  position: 'sticky',
  right: 0,
  background: '#fff',
  boxShadow: '-2px 0 5px rgba(0,0,0,0.06)',
}

const STATUS_LABEL: Record<string, string> = {
  uploading: 'Uploading',
  queued: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  needs_human: 'Needs Review',
  error: 'Error',
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

export default function QueuePage() {
  const [allJobs, setAllJobs] = useState<QueueJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/jobs')
      if (!res.ok) throw new Error('Failed to fetch jobs')
      const data = await res.json()
      const list: QueueJob[] = data.jobs ?? []
      setAllJobs(list)
      setLoading(false)

      // Poll until no jobs are in uploading/queued/processing
      const hasActive = list.some((j) => j.status === 'uploading' || j.status === 'queued' || j.status === 'processing')
      if (hasActive) {
        timerRef.current = setTimeout(fetchJobs, 2000)
      }
    } catch {
      setError('Could not load jobs.')
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchJobs()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Show everything except submitted/deleted/expired — human must sign off to leave the queue.
  const queueJobs = allJobs.filter((j) => !HIDE_FROM_QUEUE.has(j.status))
  const allDone = !loading && allJobs.length > 0 && queueJobs.length === 0

  return (
    <main className="page">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1>Job Queue</h1>
          <p className="page-subtitle">Active submissions. Auto-refreshes every 2 seconds while processing.</p>
        </div>
        <Link href="/upload" className="btn btn-primary btn-sm">+ New Submission</Link>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-secondary)' }}>
          <span className="spinner" /> Loading…
        </div>
      )}

      {error && <div className="alert alert-error mb-2">{error}</div>}

      {/* All jobs have been signed off by a human */}
      {allDone && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p style={{ fontWeight: 600, marginBottom: '0.4rem' }}>All submissions reviewed and signed off.</p>
          <p className="text-muted text-sm" style={{ marginBottom: '1.25rem' }}>
            Completed submissions are in History — re-open, export, or delete from there.
          </p>
          <Link href="/history" className="btn btn-primary" style={{ display: 'inline-flex' }}>
            Go to History
          </Link>
        </div>
      )}

      {/* Nothing submitted yet */}
      {!loading && allJobs.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p className="text-muted">No active submissions.</p>
          <Link href="/upload" className="btn btn-primary mt-2" style={{ display: 'inline-flex' }}>
            Submit your first label
          </Link>
        </div>
      )}

      {!loading && queueJobs.length > 0 && (
        <div className="table-wrap">
          <table style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Brand / Class</th>
                <th>Images</th>
                <th>Submitted</th>
                <th style={stickyColHead}>Action</th>
              </tr>
            </thead>
            <tbody>
              {queueJobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <span className={`badge badge-${job.status}`}>
                      {(job.status === 'processing' || job.status === 'uploading') && (
                        <span className="spinner" style={{ marginRight: 4, fontSize: '0.7em' }} />
                      )}
                      {STATUS_LABEL[job.status] ?? job.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{job.brandName}</div>
                    <div className="text-xs text-muted">{job.classType}</div>
                  </td>
                  <td>{job.assets.length}</td>
                  <td className="text-sm">{relativeTime(job.createdAt)}</td>
                  <td style={stickyColCell}>
                    {(job.status === 'ready' || job.status === 'needs_human' || job.status === 'error') ? (
                      <Link href={`/review/${job.id}`} className="btn btn-accent btn-xs">
                        Review
                      </Link>
                    ) : (
                      <span className="text-xs text-muted">Pending…</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
