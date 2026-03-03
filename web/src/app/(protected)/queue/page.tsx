'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { TERMINAL_STATUSES, type JobStatus } from '@/types'

interface QueueJob {
  id: string
  status: JobStatus
  brandName: string
  classType: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  timeToFirstResult: number | null
  avgPerLabel: number | null
  p95PerLabel: number | null
  totalBatchTime: number | null
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
  queued: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  needs_human: 'Needs Review',
  error: 'Error',
  deleted: 'Deleted',
  expired: 'Expired',
}

function ms(val: number | null): string {
  if (val === null || val === undefined) return '—'
  if (val >= 1000) return `${(val / 1000).toFixed(1)}s`
  return `${Math.round(val)}ms`
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
  const [jobs, setJobs] = useState<QueueJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/jobs')
      if (!res.ok) throw new Error('Failed to fetch jobs')
      const data = await res.json()
      const list: QueueJob[] = data.jobs ?? []
      setJobs(list)
      setLoading(false)

      const hasActive = list.some((j) => !TERMINAL_STATUSES.has(j.status))
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

  return (
    <main className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1>Job Queue</h1>
          <p className="page-subtitle">Jobs from the last 24 hours. Auto-refreshes every 2 seconds while processing.</p>
        </div>
        <Link href="/upload" className="btn btn-primary btn-sm">+ New Submission</Link>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-secondary)' }}>
          <span className="spinner" /> Loading…
        </div>
      )}

      {error && <div className="alert alert-error mb-2">{error}</div>}

      {!loading && jobs.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p className="text-muted">No jobs found.</p>
          <Link href="/upload" className="btn btn-primary mt-2" style={{ display: 'inline-flex' }}>
            Submit your first label
          </Link>
        </div>
      )}

      {!loading && jobs.length > 0 && (
        <div className="table-wrap">
          <table style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Brand / Class</th>
                <th>Images</th>
                <th>Submitted</th>
                <th>1st Result</th>
                <th>Avg / Label</th>
                <th>p95 / Label</th>
                <th>Total</th>
                <th style={stickyColHead}>Action</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <span className={`badge badge-${job.status}`}>
                      {job.status === 'processing' && <span className="spinner" style={{ marginRight: 4, fontSize: '0.7em' }} />}
                      {STATUS_LABEL[job.status] ?? job.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{job.brandName}</div>
                    <div className="text-xs text-muted">{job.classType}</div>
                  </td>
                  <td>{job.assets.length}</td>
                  <td className="text-sm">{relativeTime(job.createdAt)}</td>
                  <td className="text-sm">{ms(job.timeToFirstResult)}</td>
                  <td className="text-sm">{ms(job.avgPerLabel)}</td>
                  <td className="text-sm">{ms(job.p95PerLabel)}</td>
                  <td className="text-sm">{ms(job.totalBatchTime)}</td>
                  <td style={stickyColCell}>
                    {TERMINAL_STATUSES.has(job.status) && job.status !== 'deleted' && job.status !== 'expired' ? (
                      <Link href={`/review/${job.id}`} className="btn btn-accent btn-xs">
                        Review
                      </Link>
                    ) : job.status === 'queued' || job.status === 'processing' ? (
                      <span className="text-xs text-muted">Pending…</span>
                    ) : (
                      <span className="text-xs text-muted">—</span>
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
