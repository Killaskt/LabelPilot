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

// Mirrors MATCH_CONF_THRESHOLD in worker.py
const MATCH_CONF_THRESHOLD = 0.70

const STATUS_PRIORITY: Record<string, number> = { match: 0, soft_mismatch: 1, mismatch: 2, not_found: 2 }

function parseBBox(bboxJson: string | null): BBox | null {
  if (!bboxJson) return null
  try { return JSON.parse(bboxJson) as BBox } catch { return null }
}

function statusBorderColor(status: string, isOverridden: boolean, action?: string): string {
  if (isOverridden) {
    if (action === 'accept') return 'var(--color-success)'
    if (action === 'reject') return 'var(--color-error)'
    return 'var(--color-warning)'
  }
  if (status === 'match') return 'var(--color-success)'
  if (status === 'soft_mismatch') return 'var(--color-warning)'
  if (status === 'mismatch' || status === 'not_found') return 'var(--color-error)'
  return 'var(--color-border)'
}

function ConfidencePill({ value }: { value: number | null }) {
  if (value === null) return null
  const pct = Math.round(value * 100)
  const bg = value >= 0.8 ? 'var(--color-success-bg)' : value >= 0.6 ? 'var(--color-warning-bg)' : 'var(--color-error-bg)'
  const fg = value >= 0.8 ? 'var(--color-success)' : value >= 0.6 ? 'var(--color-warning)' : 'var(--color-error)'
  return (
    <span style={{ padding: '0.1rem 0.35rem', borderRadius: 4, fontSize: '0.7rem', fontWeight: 700, background: bg, color: fg, marginLeft: 5 }}>
      {pct}%
    </span>
  )
}

function aggregateFieldStatus(
  results: JobResult[],
  field: FieldName,
  overrides: Override[]
): {
  status: string
  isOverridden: boolean
  override?: Override
  needsHuman: boolean
  hasConflict: boolean
  conflictCount: number
} {
  const override = overrides.find((o) => o.field === field)
  const fieldResults = results.filter((r) => r.field === field)

  const hasConfidentMatch = fieldResults.some(
    (r) => r.status === 'match' && (r.confidence ?? 0) >= MATCH_CONF_THRESHOLD
  )
  const needsHuman = !hasConfidentMatch && fieldResults.some((r) => r.needsHuman)

  const nonMatchCount = fieldResults.filter((r) => r.status !== 'match').length
  const hasConflict = fieldResults.length > 1 && hasConfidentMatch && nonMatchCount > 0
  const conflictCount = hasConflict ? nonMatchCount : 0

  if (override) {
    return { status: override.action, isOverridden: true, override, needsHuman, hasConflict, conflictCount }
  }

  if (fieldResults.length === 0) {
    return { status: 'pending', isOverridden: false, needsHuman: false, hasConflict: false, conflictCount: 0 }
  }

  let best = fieldResults[0]
  for (const r of fieldResults) {
    if ((STATUS_PRIORITY[r.status] ?? 3) < (STATUS_PRIORITY[best.status] ?? 3)) best = r
  }
  return { status: best.status, isOverridden: false, needsHuman, hasConflict, conflictCount }
}

const STATUS_ICON: Record<string, string> = {
  match: '✅', soft_mismatch: '⚠️', mismatch: '❌', not_found: '❌',
  accept: '✅', reject: '❌', needs_human: '⚠️', pending: '⏳',
}

export default function ReviewClient({ initialJob }: Props) {
  const router = useRouter()
  const [job, setJob] = useState(initialJob)
  const [activeAssetIdx, setActiveAssetIdx] = useState(0)
  const [activeHighlightField, setActiveHighlightField] = useState<FieldName | null>(null)
  const [overrideLoading, setOverrideLoading] = useState<FieldName | null>(null)
  const [overrideError, setOverrideError] = useState<string | null>(null)
  const [additionalOpen, setAdditionalOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const imgRef = useRef<HTMLImageElement>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Resizable split pane
  const [panelWidth, setPanelWidth] = useState(340)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const onDragStart = (e: React.MouseEvent) => {
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartWidth.current = panelWidth
    e.preventDefault()
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const newWidth = Math.max(260, Math.min(540, dragStartWidth.current + e.clientX - dragStartX.current))
      setPanelWidth(newWidth)
    }
    const onUp = () => { isDragging.current = false }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

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
    if (!isTerminal) pollRef.current = setTimeout(pollJob, 2000)
    return () => { if (pollRef.current) clearTimeout(pollRef.current) }
  }, [isTerminal, pollJob])

  const activeAsset = job.assets[activeAssetIdx]
  const activeResults = job.results.filter((r) => r.assetId === activeAsset?.id)

  const jumpToHighlight = (field: FieldName) => {
    const fieldResults = job.results.filter((r) => r.field === field)
    const withBBox = [...fieldResults]
      .filter((r) => r.bboxJson)
      .sort((a, b) => (STATUS_PRIORITY[a.status] ?? 3) - (STATUS_PRIORITY[b.status] ?? 3))[0]
    const target = withBBox ?? fieldResults[0]
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
      if (!res.ok) { setOverrideError(data.message ?? 'Override failed'); return }
      setJob((prev) => {
        const existing = prev.overrides.findIndex((o) => o.field === field)
        const updated = [...prev.overrides]
        if (existing >= 0) updated[existing] = data.override
        else updated.push(data.override)
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
      setJob((prev) => ({ ...prev, overrides: prev.overrides.filter((o) => o.field !== field) }))
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

  return (
    <main className="review-main" style={{
      height: 'calc(100vh - 56px)',
      display: 'flex',
      flexDirection: 'column',
      padding: '0.75rem 1.25rem 0.75rem',
      overflow: 'hidden',
      boxSizing: 'border-box',
    }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: '1.15rem', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.brandName}</h1>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>
              {job.classType} &middot; {job.alcoholContent} &middot; {job.netContents}
            </div>
          </div>
          <span className={`badge badge-${job.status}`} style={{ flexShrink: 0 }}>
            {job.status.replace('_', ' ')}
          </span>
          {job.totalBatchTime && (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', flexShrink: 0 }}>
              {(job.totalBatchTime / 1000).toFixed(1)}s
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link href={`/api/jobs/${job.id}/export?format=csv`} className="btn btn-ghost btn-sm">CSV</Link>
          <Link href={`/api/jobs/${job.id}/export?format=json`} className="btn btn-ghost btn-sm">JSON</Link>
          <button className="btn btn-danger btn-sm" onClick={deleteJob}>Delete</button>
          {isTerminal && (
            <button className="btn btn-primary btn-sm" onClick={() => router.push('/history')}>
              ✓ Done
            </button>
          )}
        </div>
      </div>

      {!isTerminal && (
        <div className="alert alert-info" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem', padding: '0.5rem 0.75rem' }}>
          <span className="spinner" style={{ flexShrink: 0 }} /> Processing… results will appear automatically.
        </div>
      )}

      {overrideError && (
        <div className="alert alert-error" style={{ flexShrink: 0, marginBottom: '0.4rem', padding: '0.5rem 0.75rem' }}>{overrideError}</div>
      )}

      {/* ── Split pane ─────────────────────────────────────────────────── */}
      <div className="review-split" style={{ flex: 1, minHeight: 0, display: 'flex', gap: 0 }}>

        {/* Left: Field checklist */}
        <div className="review-panel-left" style={{ width: panelWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
            <div style={{ flexShrink: 0, padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.35rem' }}>
              <h2 style={{ fontSize: '0.9rem', margin: 0 }}>Compliance Checklist</h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                {job.results.filter((r) => r.status === 'match').length > 0
                  ? `${ALL_FIELDS.filter((f) => {
                      const agg = aggregateFieldStatus(job.results, f, job.overrides)
                      return agg.status === 'match' || agg.status === 'accept'
                    }).length}/${ALL_FIELDS.length} passed`
                  : `${ALL_FIELDS.length} fields`}
              </span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.5rem', paddingBottom: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {/* Checklist fields */}
              {ALL_FIELDS.map((field) => {
                const { status, isOverridden, override, needsHuman, hasConflict, conflictCount } = aggregateFieldStatus(
                  job.results, field, job.overrides
                )
                const fieldResults = job.results.filter((r) => r.field === field)
                const representative = fieldResults.length > 0
                  ? fieldResults.reduce((best, r) =>
                      (STATUS_PRIORITY[r.status] ?? 3) < (STATUS_PRIORITY[best.status] ?? 3) ? r : best
                    )
                  : undefined
                const isLoading = overrideLoading === field
                const isActive = activeHighlightField === field
                const borderColor = statusBorderColor(status, isOverridden, override?.action)

                return (
                  <div
                    key={field}
                    onClick={() => representative?.bboxJson && jumpToHighlight(field)}
                    style={{
                      borderRadius: 'var(--radius)',
                      border: '1px solid var(--color-border)',
                      borderLeft: `3px solid ${borderColor}`,
                      background: isActive ? 'var(--color-primary-light)' : 'var(--color-surface)',
                      transition: 'background 0.15s',
                      cursor: representative?.bboxJson ? 'pointer' : 'default',
                    }}
                  >
                    {/* Main content */}
                    <div style={{ padding: '0.45rem 0.65rem', display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                      <span style={{ fontSize: '0.9rem', lineHeight: 1, marginTop: 2, flexShrink: 0 }}>
                        {STATUS_ICON[status] ?? '—'}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Field name + badges */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 3 }}>
                          <span style={{ fontWeight: 600, fontSize: '0.81rem' }}>{FIELD_LABELS[field]}</span>
                          {isOverridden && (
                            <span title={`Decision: ${override?.action}`}
                              style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, display: 'inline-block', background: borderColor }} />
                          )}
                          {hasConflict && !isOverridden && (
                            <span title={`${conflictCount} image${conflictCount > 1 ? 's' : ''} non-compliant; passed on another`}
                              style={pillStyle('var(--color-warning-bg)', 'var(--color-warning)')}>
                              {conflictCount} conflict{conflictCount > 1 ? 's' : ''}
                            </span>
                          )}
                          {needsHuman && !isOverridden && (
                            <span style={pillStyle('var(--color-warning-bg)', 'var(--color-warning)')}>⚠ Review</span>
                          )}
                        </div>

                        {/* Expected / Found — compact two-line layout */}
                        {representative ? (
                          <div style={{ fontSize: '0.76rem', color: 'var(--color-text-secondary)' }}>
                            <div style={{ display: 'flex', gap: 3, alignItems: 'baseline' }}>
                              <span style={{ fontWeight: 600, color: '#94a3b8', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0, minWidth: 46 }}>Exp</span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {representative.expectedValue ?? '—'}
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginTop: 1 }}>
                              <span style={{ fontWeight: 600, color: '#94a3b8', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0, minWidth: 46 }}>Got</span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                {representative.foundValue ?? <em style={{ color: '#cbd5e1' }}>not found</em>}
                              </span>
                              <ConfidencePill value={representative.confidence} />
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>Waiting…</div>
                        )}

                        {isOverridden && override?.note && (
                          <div style={{ marginTop: 3, fontSize: '0.72rem', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
                            {override.note}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions — always visible when terminal, separated by a hairline */}
                    {isTerminal && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          borderTop: '1px solid var(--color-border)',
                          padding: '0.3rem 0.65rem',
                          display: 'flex',
                          gap: 4,
                          alignItems: 'center',
                          background: '#fafbfc',
                          borderRadius: '0 0 calc(var(--radius) - 1px) calc(var(--radius) - 1px)',
                        }}
                      >
                        {representative?.bboxJson && (
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => jumpToHighlight(field)}
                            style={{ fontSize: '0.7rem' }}
                          >
                            📍
                          </button>
                        )}
                        <button
                          className="btn btn-xs"
                          style={{ background: status === 'accept' ? 'var(--color-success)' : 'var(--color-success-bg)', color: status === 'accept' ? '#fff' : 'var(--color-success)', fontWeight: 700 }}
                          disabled={isLoading || status === 'accept'}
                          onClick={() => applyOverride(field, 'accept')}
                        >
                          ✓ Accept
                        </button>
                        <button
                          className="btn btn-xs"
                          style={{ background: status === 'reject' ? 'var(--color-error)' : 'var(--color-error-bg)', color: status === 'reject' ? '#fff' : 'var(--color-error)', fontWeight: 700 }}
                          disabled={isLoading || status === 'reject'}
                          onClick={() => applyOverride(field, 'reject')}
                        >
                          ✗ Reject
                        </button>
                        {isOverridden && (
                          <button className="btn btn-ghost btn-xs" disabled={isLoading} onClick={() => resetOverride(field)}>
                            Undo
                          </button>
                        )}
                        {isLoading && <span className="spinner" style={{ fontSize: '0.7em', marginLeft: 2 }} />}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Additional context — collapsible */}
              {(job.bottlerInfo || job.countryOfOrigin) && (
                <div style={{ borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setAdditionalOpen((v) => !v)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.45rem 0.65rem',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '0.81rem' }}>Additional Context</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', display: 'inline-block', transition: 'transform 0.2s', transform: additionalOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                  </button>
                  {additionalOpen && (
                    <div style={{ padding: '0 0.65rem 0.55rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      <p style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', margin: '0 0 0.3rem', fontStyle: 'italic' }}>
                        Provided for reference — not OCR-verified.
                      </p>
                      {job.bottlerInfo && (
                        <div style={{ fontSize: '0.76rem' }}>
                          <span style={{ fontWeight: 600, color: '#94a3b8', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Bottler</span>
                          <div style={{ marginTop: 2 }}>{job.bottlerInfo}</div>
                        </div>
                      )}
                      {job.countryOfOrigin && (
                        <div style={{ fontSize: '0.76rem' }}>
                          <span style={{ fontWeight: 600, color: '#94a3b8', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Country of Origin</span>
                          <div style={{ marginTop: 2 }}>{job.countryOfOrigin}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Resize handle */}
        <div
          className="review-resize-handle"
          onMouseDown={onDragStart}
          style={{ width: 10, flexShrink: 0, cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' }}
          title="Drag to resize"
        >
          <div style={{ width: 3, height: 48, borderRadius: 2, background: 'var(--color-border)', transition: 'background 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#94a3b8')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-border)')}
          />
        </div>

        {/* Right: Image viewer */}
        <div className="review-panel-right" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>

            {/* Asset tabs + zoom controls */}
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.9rem', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
              {job.assets.length > 1 && job.assets.map((asset, i) => (
                <button
                  key={asset.id}
                  className={`btn btn-sm ${i === activeAssetIdx ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize: '0.78rem' }}
                  onClick={() => { setActiveAssetIdx(i); setActiveHighlightField(null) }}
                >
                  {asset.filename}
                </button>
              ))}
              {job.assets.length <= 1 && activeAsset && (
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{activeAsset.filename}</span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 4) / 4))}
                  disabled={zoom <= 0.5}
                  style={{ minWidth: 28 }}
                >−</button>
                <span style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', minWidth: 36, textAlign: 'center' }}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 4) / 4))}
                  disabled={zoom >= 4}
                  style={{ minWidth: 28 }}
                >+</button>
                {zoom !== 1 && (
                  <button className="btn btn-ghost btn-xs" onClick={() => setZoom(1)}>1:1</button>
                )}
              </div>
            </div>

            {/* Image area */}
            {activeAsset ? (
              <>
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  <div style={{
                    position: 'relative',
                    display: 'inline-block',
                    width: zoom <= 1 ? '100%' : `${zoom * 100}%`,
                    minWidth: '100%',
                  }}>
                    <img
                      ref={imgRef}
                      src={activeAsset.url ?? `/api/assets/${job.id}/${activeAsset.id}`}
                      alt={activeAsset.filename}
                      style={{ width: '100%', height: 'auto', display: 'block' }}
                    />

                    {/* Bbox overlays */}
                    {activeResults.map((result) => {
                      const bbox = parseBBox(result.bboxJson)
                      if (!bbox) return null
                      const isActive = activeHighlightField === result.field
                      const color = result.status === 'match'
                        ? 'var(--color-success)'
                        : result.status === 'soft_mismatch'
                        ? 'var(--color-warning)'
                        : 'var(--color-error)'
                      return (
                        <div
                          key={result.id}
                          onClick={() => setActiveHighlightField(result.field as FieldName)}
                          title={`${FIELD_LABELS[result.field as FieldName]}: ${result.foundValue ?? 'not found'}`}
                          style={{
                            position: 'absolute',
                            left: `${bbox.x * 100}%`,
                            top: `${bbox.y * 100}%`,
                            width: `${bbox.w * 100}%`,
                            height: `${bbox.h * 100}%`,
                            border: `${isActive ? 3 : 2}px solid ${color}`,
                            borderRadius: 2,
                            background: isActive ? `${color}22` : 'transparent',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                            boxShadow: isActive ? `0 0 0 2px ${color}44` : 'none',
                          }}
                        />
                      )
                    })}
                  </div>
                </div>

                {/* Metrics bar */}
                {job.totalBatchTime && (
                  <div style={{ flexShrink: 0, padding: '0.4rem 0.9rem', borderTop: '1px solid var(--color-border)', fontSize: '0.75rem', color: 'var(--color-text-secondary)', display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
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
      </div>
    </main>
  )
}

function pillStyle(bg: string, fg: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center',
    padding: '0.1rem 0.4rem',
    borderRadius: 999,
    background: bg,
    color: fg,
    fontSize: '0.68rem',
    fontWeight: 700,
    userSelect: 'none',
    whiteSpace: 'nowrap',
  }
}
