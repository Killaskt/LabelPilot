'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ALL_FIELDS,
  FIELD_LABELS,
  TERMINAL_STATUSES,
  type FieldName,
  type JobDetail,
  type JobResult,
  type Override,
  type OverrideAction,
  type BBox,
} from '@/types'

interface Props {
  initialJob: JobDetail
}

const STATUS_ICON: Record<string, string> = {
  match: '✅',
  soft_mismatch: '🟡',
  mismatch: '🔴',
  not_found: '🔴',
}

const OVERRIDE_DOT_COLOR: Record<string, string> = {
  accept: 'var(--color-success)',
  reject: 'var(--color-error)',
  needs_human: 'var(--color-warning)',
}

function parseBBox(bboxJson: string | null): BBox | null {
  if (!bboxJson) return null
  try {
    return JSON.parse(bboxJson) as BBox
  } catch {
    return null
  }
}

function aggregateFieldStatus(
  results: JobResult[],
  field: FieldName,
  overrides: Override[]
): { status: string; icon: string; isOverridden: boolean; override?: Override; needsHuman: boolean } {
  const override = overrides.find((o) => o.field === field)
  const fieldResults = results.filter((r) => r.field === field)
  const needsHuman = fieldResults.some((r) => r.needsHuman)

  if (override) {
    return {
      status: override.action,
      icon: override.action === 'accept' ? '✅' : override.action === 'reject' ? '🔴' : '🟡',
      isOverridden: true,
      override,
      needsHuman,
    }
  }

  if (fieldResults.length === 0) return { status: 'pending', icon: '⏳', isOverridden: false, needsHuman: false }

  const priority: Record<string, number> = { match: 0, soft_mismatch: 1, mismatch: 2, not_found: 2 }
  let worst = fieldResults[0]
  for (const r of fieldResults) {
    if ((priority[r.status] ?? 0) > (priority[worst.status] ?? 0)) worst = r
  }
  return { status: worst.status, icon: STATUS_ICON[worst.status] ?? '—', isOverridden: false, needsHuman }
}

export default function ReviewClient({ initialJob }: Props) {
  const router = useRouter()
  const [job, setJob] = useState(initialJob)
  const [activeAssetIdx, setActiveAssetIdx] = useState(0)
  const [activeHighlightField, setActiveHighlightField] = useState<FieldName | null>(null)
  const [overrideLoading, setOverrideLoading] = useState<FieldName | null>(null)
  const [overrideError, setOverrideError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const imgRef = useRef<HTMLImageElement>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isTerminal = TERMINAL_STATUSES.has(job.status)

  const pollJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${job.id}`)
      if (!res.ok) return
      const data = await res.json()
      if (data.job) {
        setJob(data.job)
        if (!TERMINAL_STATUSES.has(data.job.status)) {
          pollRef.current = setTimeout(pollJob, 2000)
        }
      }
    } catch {}
  }, [job.id])

  useEffect(() => {
    if (!isTerminal) {
      pollRef.current = setTimeout(pollJob, 2000)
    }
    return () => { if (pollRef.current) clearTimeout(pollRef.current) }
  }, [isTerminal, pollJob])

  const activeAsset = job.assets[activeAssetIdx]
  const activeResults = job.results.filter((r) => r.assetId === activeAsset?.id)
  const highlightResult = activeResults.find((r) => r.field === activeHighlightField)
  const highlightBBox = highlightResult ? parseBBox(highlightResult.bboxJson) : null
  void highlightBBox

  const jumpToHighlight = (field: FieldName) => {
    const withBBox = job.results.find((r) => r.field === field && r.bboxJson)
    const target = withBBox ?? job.results.find((r) => r.field === field)
    if (target) {
      const idx = job.assets.findIndex((a) => a.id === target.assetId)
      if (idx >= 0) setActiveAssetIdx(idx)
    }
    setActiveHighlightField(field)
  }

  const applyOverride = async (field: FieldName, action: OverrideAction, note?: string) => {
    setOverrideLoading(field)
    setOverrideError(null)
    try {
      const res = await fetch(`/api/jobs/${job.id}/overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, action, note }),
      })
      const data = await res.json()
      if (!res.ok) {
        setOverrideError(data.message ?? 'Override failed')
        return
      }
      setJob((prev) => {
        const existing = prev.overrides.findIndex((o) => o.field === field)
        const updated = [...prev.overrides]
        if (existing >= 0) {
          updated[existing] = data.override
        } else {
          updated.push(data.override)
        }
        return { ...prev, overrides: updated }
      })
    } catch {
      setOverrideError('Network error.')
    } finally {
      setOverrideLoading(null)
    }
  }

  const resetOverride = async (field: FieldName) => {
    setOverrideLoading(field)
    setOverrideError(null)
    try {
      await fetch(`/api/jobs/${job.id}/overrides?field=${field}`, { method: 'DELETE' })
      setJob((prev) => ({
        ...prev,
        overrides: prev.overrides.filter((o) => o.field !== field),
      }))
    } catch {
      setOverrideError('Network error.')
    } finally {
      setOverrideLoading(null)
    }
  }

  const deleteJob = async () => {
    if (!confirm('Delete this job and its files? This cannot be undone.')) return
    await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' })
    router.push('/history')
  }

  const finishReview = () => {
    router.push('/history')
  }

  const adjustZoom = (delta: number) => {
    setZoom((z) => Math.min(4, Math.max(0.5, Math.round((z + delta) * 4) / 4))
    )
  }

  return (
    // Full-height flex column so the split pane fills exactly the remaining viewport
    <main
      className="page-wide"
      style={{
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '100vh',
        paddingTop: '1.25rem',
        paddingBottom: '0.75rem',
        overflow: 'hidden',
      }}
    >
      {/* Header — fixed height, doesn't scroll */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1>{job.brandName}</h1>
          <div className="text-sm text-muted" style={{ marginTop: 4 }}>
            {job.classType} &mdash; {job.alcoholContent} &mdash; {job.netContents}
          </div>
          <div style={{ marginTop: 6 }}>
            <span className={`badge badge-${job.status}`}>{job.status.replace('_', ' ')}</span>
            {job.totalBatchTime && (
              <span className="text-xs text-muted" style={{ marginLeft: 8 }}>
                Processed in {(job.totalBatchTime / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </div>
        <div className="flex-gap" style={{ flexWrap: 'wrap' }}>
          <Link href={`/api/jobs/${job.id}/export?format=csv`} className="btn btn-ghost btn-sm">
            Export CSV
          </Link>
          <Link href={`/api/jobs/${job.id}/export?format=json`} className="btn btn-ghost btn-sm">
            Export JSON
          </Link>
          <button className="btn btn-danger btn-sm" onClick={deleteJob}>Delete</button>
          {isTerminal && (
            <button className="btn btn-primary btn-sm" onClick={finishReview}>
              ✓ Finish Review
            </button>
          )}
        </div>
      </div>

      {!isTerminal && (
        <div className="alert alert-info" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
          <span className="spinner" /> Processing… results will appear automatically.
        </div>
      )}

      {overrideError && (
        <div className="alert alert-error" style={{ flexShrink: 0, marginBottom: '0.5rem' }}>{overrideError}</div>
      )}

      {/* Split pane — takes all remaining vertical space */}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '360px 1fr', gap: '1.5rem', alignItems: 'stretch' }}>
        {/* ─── Left: Field Checklist ─────────────────────────────────────── */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
          <h2 style={{ flexShrink: 0, padding: '1.25rem 1.25rem 0.75rem', borderBottom: '1px solid var(--color-border)' }}>Field Checklist</h2>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.75rem 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {ALL_FIELDS.map((field) => {
              const { status, icon, isOverridden, override, needsHuman } = aggregateFieldStatus(
                job.results,
                field,
                job.overrides
              )
              const fieldResults = job.results.filter((r) => r.field === field)
              const representative = fieldResults[0]
              const isLoading = overrideLoading === field

              return (
                <div
                  key={field}
                  style={{
                    padding: '0.75rem',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--color-border)',
                    background: activeHighlightField === field ? 'var(--color-primary-light)' : '#fff',
                  }}
                >
                  {/* Field header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {icon} {FIELD_LABELS[field]}
                      {/* Colored dot when overridden — replaces verbose badge */}
                      {isOverridden && (
                        <span
                          title={`Decision: ${override?.action?.replace('_', ' ')}`}
                          style={{
                            width: 9, height: 9, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
                            background: OVERRIDE_DOT_COLOR[override?.action ?? 'needs_human'] ?? 'var(--color-warning)',
                          }}
                        />
                      )}
                    </span>
                    {/* Non-clickable warning tag when OCR flagged needs_human */}
                    {needsHuman && !isOverridden && (
                      <span
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          padding: '0.15rem 0.45rem',
                          borderRadius: 999,
                          background: 'var(--color-warning-bg)',
                          color: 'var(--color-warning)',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          userSelect: 'none',
                        }}
                      >
                        ⚠ Needs review
                      </span>
                    )}
                  </div>

                  {/* Values */}
                  {representative && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                      <div>
                        <span style={{ fontWeight: 500 }}>Expected:</span>{' '}
                        {representative.expectedValue ?? '—'}
                      </div>
                      <div>
                        <span style={{ fontWeight: 500 }}>Found:</span>{' '}
                        {representative.foundValue ?? <em>not found</em>}
                        {representative.confidence !== null && (
                          <span style={{ marginLeft: 4, color: '#94a3b8' }}>
                            ({(representative.confidence * 100).toFixed(0)}%)
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Override decision note */}
                  {isOverridden && override?.note && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                      Note: {override.note}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: 4 }}>
                    {representative?.bboxJson && (
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => jumpToHighlight(field)}
                      >
                        Show on image
                      </button>
                    )}
                    {isTerminal && (
                      <>
                        <button
                          className="btn btn-xs"
                          style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)' }}
                          disabled={isLoading || status === 'accept'}
                          onClick={() => applyOverride(field, 'accept')}
                        >
                          Accept
                        </button>
                        <button
                          className="btn btn-xs"
                          style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)' }}
                          disabled={isLoading || status === 'reject'}
                          onClick={() => applyOverride(field, 'reject')}
                        >
                          Reject
                        </button>
                        {isOverridden && (
                          <button
                            className="btn btn-ghost btn-xs"
                            disabled={isLoading}
                            onClick={() => resetOverride(field)}
                          >
                            Undo
                          </button>
                        )}
                      </>
                    )}
                    {isLoading && <span className="spinner" style={{ fontSize: '0.8em', marginLeft: 4 }} />}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ─── Right: Image viewer ──────────────────────────────────────── */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
          {/* Asset tabs */}
          {job.assets.length > 1 && (
            <div style={{ flexShrink: 0, display: 'flex', gap: '0.5rem', padding: '0.75rem 1.25rem 0', flexWrap: 'wrap' }}>
              {job.assets.map((asset, i) => (
                <button
                  key={asset.id}
                  className={`btn btn-sm ${i === activeAssetIdx ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => {
                    setActiveAssetIdx(i)
                    setActiveHighlightField(null)
                  }}
                >
                  {asset.filename}
                </button>
              ))}
            </div>
          )}

          {activeAsset ? (
            <>
              {/* Zoom controls */}
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1.25rem', borderBottom: '1px solid var(--color-border)' }}>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => adjustZoom(-0.25)}
                  disabled={zoom <= 0.5}
                  aria-label="Zoom out"
                  style={{ fontSize: '1rem', lineHeight: 1, padding: '0.1rem 0.5rem' }}
                >
                  −
                </button>
                <span className="text-xs text-muted" style={{ minWidth: '3.5rem', textAlign: 'center' }}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => adjustZoom(0.25)}
                  disabled={zoom >= 4}
                  aria-label="Zoom in"
                  style={{ fontSize: '1rem', lineHeight: 1, padding: '0.1rem 0.5rem' }}
                >
                  +
                </button>
                {zoom !== 1 && (
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => setZoom(1)}
                    style={{ marginLeft: 2 }}
                  >
                    Reset
                  </button>
                )}
                {zoom > 1 && (
                  <span className="text-xs text-muted" style={{ marginLeft: 8 }}>
                    Scroll to pan
                  </span>
                )}
              </div>

              {/* Image scrolls inside this flex-grow container — no manual height calculation needed */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    display: 'inline-block',
                    width: zoom <= 1 ? '100%' : `${zoom * 100}%`,
                    minWidth: '100%',
                  }}
                >
                  <img
                    ref={imgRef}
                    src={activeAsset.url ?? `/api/assets/${job.id}/${activeAsset.id}`}
                    alt={activeAsset.filename}
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                  />

                  {/* Highlight overlays — percentage-based, scale with image naturally */}
                  {activeResults.map((result) => {
                    const bbox = parseBBox(result.bboxJson)
                    if (!bbox) return null
                    const isActive = activeHighlightField === result.field

                    const borderColor =
                      result.status === 'match'
                        ? 'var(--color-success)'
                        : result.status === 'soft_mismatch'
                        ? 'var(--color-warning)'
                        : 'var(--color-error)'

                    return (
                      <div
                        key={result.id}
                        onClick={() => setActiveHighlightField(result.field as FieldName)}
                        style={{
                          position: 'absolute',
                          left: `${bbox.x * 100}%`,
                          top: `${bbox.y * 100}%`,
                          width: `${bbox.w * 100}%`,
                          height: `${bbox.h * 100}%`,
                          border: `${isActive ? 3 : 2}px solid ${borderColor}`,
                          borderRadius: 2,
                          background: isActive ? `${borderColor}22` : 'transparent',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          boxShadow: isActive ? `0 0 0 2px ${borderColor}44` : 'none',
                        }}
                        title={`${FIELD_LABELS[result.field as FieldName]}: ${result.foundValue ?? 'not found'}`}
                      />
                    )
                  })}
                </div>
              </div>

              {/* Metrics */}
              {job.totalBatchTime && (
                <div style={{ flexShrink: 0, padding: '0.6rem 1.25rem', borderTop: '1px solid var(--color-border)', fontSize: '0.8rem', color: 'var(--color-text-secondary)', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <span>First result: <strong>{job.timeToFirstResult ? `${(job.timeToFirstResult / 1000).toFixed(2)}s` : '—'}</strong></span>
                  <span>Avg / label: <strong>{job.avgPerLabel ? `${(job.avgPerLabel / 1000).toFixed(2)}s` : '—'}</strong></span>
                  <span>p95 / label: <strong>{job.p95PerLabel ? `${(job.p95PerLabel / 1000).toFixed(2)}s` : '—'}</strong></span>
                </div>
              )}
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>
              No images available.
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
