'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface FormFields {
  brandName: string
  classType: string
  alcoholContent: string
  netContents: string
  bottlerInfo: string
  countryOfOrigin: string
}

interface SavedTemplate {
  name: string
  fields: FormFields
  images: Array<{ name: string; type: string; dataUrl: string }>
}

const STORAGE_KEY = 'labelpilot_templates'

const INITIAL_FIELDS: FormFields = {
  brandName: '',
  classType: '',
  alcoholContent: '',
  netContents: '',
  bottlerInfo: '',
  countryOfOrigin: '',
}

const PRESETS: Array<{ label: string; fields: FormFields; image: string }> = [
  {
    label: 'Old Tom',
    fields: {
      brandName: 'Old Tom Distillery',
      classType: 'Kentucky Straight Bourbon Whiskey',
      alcoholContent: '45% Alc./Vol. (90 Proof)',
      netContents: '750 mL',
      bottlerInfo: 'Mountain Creek Distillery, Bardstown, KY',
      countryOfOrigin: 'USA',
    },
    image: '/test-images/ttblabelexample-littletougher.jpg',
  },
  {
    label: 'Mountain Creek',
    fields: {
      brandName: 'Mountain Creek',
      classType: 'American Whisky',
      alcoholContent: '40% ALC./VOL. (80 PROOF)',
      netContents: '750 mL',
      bottlerInfo: 'Mountain Creek Distillery',
      countryOfOrigin: 'USA',
    },
    image: '/test-images/ttblabelexample-test2.jpg',
  },
]

function uniqueName(base: string, existing: SavedTemplate[]): string {
  const names = new Set(existing.map((t) => t.name))
  if (!names.has(base)) return base
  let i = 2
  while (names.has(`${base} (${i})`)) i++
  return `${base} (${i})`
}

function dataUrlToFile(dataUrl: string, name: string, type: string): File {
  const binary = atob(dataUrl.split(',')[1])
  const arr = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i)
  return new File([arr], name, { type })
}

function parseCSV(text: string): Partial<FormFields> | null {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return null
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''))
  const values = lines[1].match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) ?? []
  const row: Record<string, string> = {}
  headers.forEach((h, i) => { row[h] = (values[i] ?? '').trim().replace(/^"|"$/g, '') })
  return row as Partial<FormFields>
}

const SAMPLE_CSV =
  `brandName,classType,alcoholContent,netContents,bottlerInfo,countryOfOrigin\n` +
  `Old Tom Distillery,Kentucky Straight Bourbon Whiskey,45% Alc./Vol. (90 Proof),750 mL,Old Tom Distillery - Bardstown KY,USA`

const SAMPLE_JSON = JSON.stringify({
  brandName: 'Old Tom Distillery',
  classType: 'Kentucky Straight Bourbon Whiskey',
  alcoholContent: '45% Alc./Vol. (90 Proof)',
  netContents: '750 mL',
  bottlerInfo: 'Old Tom Distillery - Bardstown KY',
  countryOfOrigin: 'USA',
}, null, 2)

function downloadText(content: string, filename: string, mime: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type: mime }))
  a.download = filename
  a.click()
}

export default function UploadPage() {
  const router = useRouter()
  const [fields, setFields] = useState<FormFields>(INITIAL_FIELDS)
  const [files, setFiles] = useState<File[]>([])
  const [thumbnails, setThumbnails] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [additionalOpen, setAdditionalOpen] = useState(false)
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([])
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [showSchemaModal, setShowSchemaModal] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [copiedCSV, setCopiedCSV] = useState(false)
  const [copiedJSON, setCopiedJSON] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  const templateNameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) setSavedTemplates(JSON.parse(stored))
    } catch {}
  }, [])

  useEffect(() => {
    if (showSaveModal) setTimeout(() => templateNameInputRef.current?.focus(), 50)
  }, [showSaveModal])

  const loadPreset = async (preset: typeof PRESETS[0]) => {
    setFields(preset.fields)
    setAdditionalOpen(true)
    try {
      const res = await fetch(preset.image)
      const blob = await res.blob()
      const filename = preset.image.split('/').pop() ?? 'label.jpg'
      const file = new File([blob], filename, { type: blob.type || 'image/jpeg' })
      thumbnails.forEach((url) => URL.revokeObjectURL(url))
      setFiles([file])
      setThumbnails([URL.createObjectURL(file)])
      setError(null)
    } catch {
      setError('Could not load test image.')
    }
  }

  const openSaveModal = () => {
    setTemplateName(uniqueName(fields.brandName.trim() || 'Template', savedTemplates))
    setShowSaveModal(true)
  }

  const saveTemplate = async () => {
    const name = templateName.trim()
    if (!name) return
    const images = await Promise.all(
      files.map(
        (file) =>
          new Promise<SavedTemplate['images'][0]>((resolve) => {
            const reader = new FileReader()
            reader.onload = () =>
              resolve({ name: file.name, type: file.type, dataUrl: reader.result as string })
            reader.readAsDataURL(file)
          })
      )
    )
    const finalName = uniqueName(name, savedTemplates)
    const updated = [...savedTemplates, { name: finalName, fields, images }]
    setSavedTemplates(updated)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    setShowSaveModal(false)
  }

  const loadTemplate = (template: SavedTemplate) => {
    setFields(template.fields)
    setAdditionalOpen(true)
    thumbnails.forEach((url) => URL.revokeObjectURL(url))
    const newFiles = template.images.map((img) => dataUrlToFile(img.dataUrl, img.name, img.type))
    setFiles(newFiles)
    setThumbnails(newFiles.map((f) => URL.createObjectURL(f)))
    setError(null)
  }

  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseCSV(reader.result as string)
      if (!parsed || !parsed.brandName) { setError('Could not parse CSV. Check the expected format.'); return }
      setFields({ ...INITIAL_FIELDS, ...parsed })
      if (parsed.bottlerInfo || parsed.countryOfOrigin) setAdditionalOpen(true)
      setError(null)
    }
    reader.readAsText(file)
    if (csvInputRef.current) csvInputRef.current.value = ''
  }

  const handleJSONImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as Partial<FormFields>
        if (!parsed.brandName) { setError('Could not parse JSON. Check the expected format.'); return }
        setFields({ ...INITIAL_FIELDS, ...parsed })
        if (parsed.bottlerInfo || parsed.countryOfOrigin) setAdditionalOpen(true)
        setError(null)
      } catch { setError('Invalid JSON file.') }
    }
    reader.readAsText(file)
    if (jsonInputRef.current) jsonInputRef.current.value = ''
  }

  const deleteTemplate = (name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = savedTemplates.filter((t) => t.name !== name)
    setSavedTemplates(updated)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  }

  const handleFieldChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFields((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length === 0) return
    setFiles((prev) => [...prev, ...selected])
    setThumbnails((prev) => [...prev, ...selected.map((f) => URL.createObjectURL(f))])
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const removeFile = (index: number) => {
    URL.revokeObjectURL(thumbnails[index])
    setFiles((prev) => prev.filter((_, i) => i !== index))
    setThumbnails((prev) => prev.filter((_, i) => i !== index))
  }

  const clearFiles = () => {
    thumbnails.forEach((url) => URL.revokeObjectURL(url))
    setFiles([])
    setThumbnails([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (files.length === 0) {
      setError('Please select at least one label image.')
      return
    }

    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('brandName', fields.brandName.trim())
      fd.append('classType', fields.classType.trim())
      fd.append('alcoholContent', fields.alcoholContent.trim())
      fd.append('netContents', fields.netContents.trim())
      if (fields.bottlerInfo.trim()) fd.append('bottlerInfo', fields.bottlerInfo.trim())
      if (fields.countryOfOrigin.trim()) fd.append('countryOfOrigin', fields.countryOfOrigin.trim())
      files.forEach((f) => fd.append('files', f))

      const res = await fetch('/api/jobs', { method: 'POST', body: fd })
      const data = await res.json()

      if (!res.ok) {
        setError(data.message ?? 'Upload failed. Please try again.')
        return
      }

      router.push('/queue')
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const hasContent = fields.brandName.trim() || files.length > 0

  return (
    <main className="page">
      {/* ── Title + toolbar ─────────────────────────────────────────── */}
      <div className="page-title" style={{ marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h1>Submit Label for Review</h1>
            <p className="page-subtitle">
              Enter the application fields and upload 1–10 label images (PNG or JPEG, max 10 MB each).
            </p>
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.6rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginRight: '0.1rem' }}>Presets:</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => loadPreset(preset)}
              title={`Autofill with ${preset.label} test data`}
            >
              {preset.label}
            </button>
          ))}

          {savedTemplates.length > 0 && (
            <>
              <span style={{ width: 1, height: 16, background: 'var(--color-border)', margin: '0 0.15rem' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginRight: '0.1rem' }}>Saved:</span>
              {savedTemplates.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => loadTemplate(t)}
                  title={`Load ${t.name}`}
                  style={{ paddingRight: '0.3rem' }}
                >
                  {t.name}
                  <span
                    onClick={(e) => deleteTemplate(t.name, e)}
                    title="Delete template"
                    style={{ marginLeft: '0.35rem', opacity: 0.5, fontWeight: 400, fontSize: '0.85em', cursor: 'pointer' }}
                  >
                    ×
                  </span>
                </button>
              ))}
            </>
          )}

          <span style={{ width: 1, height: 16, background: 'var(--color-border)', margin: '0 0.15rem' }} />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={openSaveModal}
            disabled={!hasContent}
            title="Save current form as a reusable template"
          >
            Save template
          </button>
          {hasContent && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setFields(INITIAL_FIELDS); clearFiles(); setAdditionalOpen(false) }}
              title="Clear all fields and images"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Clear form
            </button>
          )}

        </div>
      </div>

      {/* ── Save modal ──────────────────────────────────────────────── */}
      {showSaveModal && (
        <div
          onClick={() => setShowSaveModal(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: 360, maxWidth: '90vw', padding: '1.25rem' }}
          >
            <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Save as template</h2>
            <label className="form-label" htmlFor="templateName">Template name</label>
            <input
              id="templateName"
              ref={templateNameInputRef}
              className="form-input"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveTemplate(); if (e.key === 'Escape') setShowSaveModal(false) }}
              style={{ marginBottom: '1rem' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={saveTemplate} disabled={!templateName.trim()}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Schema modal ────────────────────────────────────────────── */}
      {showSchemaModal && (
        <div
          onClick={() => setShowSchemaModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: 480, maxWidth: '95vw', padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h2 style={{ fontSize: '1rem', margin: 0 }}>Expected import format</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSchemaModal(false)}>✕</button>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
              Only <code>brandName</code>, <code>classType</code>, <code>alcoholContent</code>, and <code>netContents</code> are required. The rest are optional.
            </p>

            <p style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.25rem' }}>CSV — first row headers, second row values:</p>
            <div style={{ position: 'relative', marginBottom: '1rem' }}>
              <pre style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '0.6rem 0.75rem', fontSize: '0.72rem', overflowX: 'auto', margin: 0, whiteSpace: 'pre' }}>{SAMPLE_CSV}</pre>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ position: 'absolute', top: 4, right: 4, fontSize: '0.7rem', padding: '0.1rem 0.45rem', opacity: 0.8 }}
                onClick={() => { navigator.clipboard.writeText(SAMPLE_CSV); setCopiedCSV(true); setTimeout(() => setCopiedCSV(false), 1500) }}
              >{copiedCSV ? '✓ Copied' : 'Copy'}</button>
            </div>

            <p style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.25rem' }}>JSON — flat object:</p>
            <div style={{ position: 'relative', marginBottom: '1rem' }}>
              <pre style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '0.6rem 0.75rem', fontSize: '0.72rem', overflowX: 'auto', margin: 0, whiteSpace: 'pre' }}>{SAMPLE_JSON}</pre>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ position: 'absolute', top: 4, right: 4, fontSize: '0.7rem', padding: '0.1rem 0.45rem', opacity: 0.8 }}
                onClick={() => { navigator.clipboard.writeText(SAMPLE_JSON); setCopiedJSON(true); setTimeout(() => setCopiedJSON(false), 1500) }}
              >{copiedJSON ? '✓ Copied' : 'Copy'}</button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadText(SAMPLE_CSV, 'labelpilot-sample.csv', 'text/csv')}>Download CSV sample</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadText(SAMPLE_JSON, 'labelpilot-sample.json', 'application/json')}>Download JSON sample</button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ maxWidth: 640, width: '100%' }}>
        <div className="card mb-2">
          <div className="card-header">
            <h2 style={{ margin: 0 }}>Application Fields</h2>
            <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => csvInputRef.current?.click()}>From CSV</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => jsonInputRef.current?.click()}>From JSON</button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowSchemaModal(true)}
                title="View expected CSV / JSON format"
                style={{ fontWeight: 700, opacity: 0.6, padding: '0 0.4rem' }}
              >ⓘ</button>
              <input ref={csvInputRef} type="file" accept=".csv,text/csv" onChange={handleCSVImport} style={{ display: 'none' }} />
              <input ref={jsonInputRef} type="file" accept=".json,application/json" onChange={handleJSONImport} style={{ display: 'none' }} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="brandName">Brand Name *</label>
              <input
                id="brandName"
                name="brandName"
                className="form-input"
                value={fields.brandName}
                onChange={handleFieldChange}
                placeholder="e.g. Mountain Creek"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="classType">Class / Type *</label>
              <input
                id="classType"
                name="classType"
                className="form-input"
                value={fields.classType}
                onChange={handleFieldChange}
                placeholder="e.g. American Whisky"
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="alcoholContent">Alcohol Content *</label>
              <input
                id="alcoholContent"
                name="alcoholContent"
                className="form-input"
                value={fields.alcoholContent}
                onChange={handleFieldChange}
                placeholder="e.g. 40% alc. by vol."
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="netContents">Net Contents *</label>
              <input
                id="netContents"
                name="netContents"
                className="form-input"
                value={fields.netContents}
                onChange={handleFieldChange}
                placeholder="e.g. 750 mL"
                required
              />
            </div>
          </div>
        </div>

        {/* Collapsible additional fields */}
        <div className="card mb-2" style={{ padding: 0, overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => setAdditionalOpen((v) => !v)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1rem',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
              Additional Fields
              <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)', fontSize: '0.82rem', marginLeft: '0.4rem' }}>
                (optional — not OCR-verified)
              </span>
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', transition: 'transform 0.2s', display: 'inline-block', transform: additionalOpen ? 'rotate(180deg)' : 'none' }}>
              ▾
            </span>
          </button>

          {additionalOpen && (
            <div style={{ padding: '0 1rem 1rem' }}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="bottlerInfo">Bottler / Producer Name &amp; Address</label>
                  <input
                    id="bottlerInfo"
                    name="bottlerInfo"
                    className="form-input"
                    value={fields.bottlerInfo}
                    onChange={handleFieldChange}
                    placeholder="e.g. Mountain Creek Distillery, Louisville KY"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="countryOfOrigin">Country of Origin</label>
                  <input
                    id="countryOfOrigin"
                    name="countryOfOrigin"
                    className="form-input"
                    value={fields.countryOfOrigin}
                    onChange={handleFieldChange}
                    placeholder="e.g. USA"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="card mb-2">
          <h2 style={{ marginBottom: '0.75rem' }}>Label Images</h2>
          <p className="text-sm text-muted mb-1">
            Select 1–10 PNG or JPEG images. Each file must be under 10 MB.
          </p>

          <div style={{ marginBottom: '1rem' }}>
            <label
              htmlFor="fileInput"
              className="btn btn-ghost"
              style={{ cursor: 'pointer', display: 'inline-flex' }}
            >
              Choose Images
            </label>
            <input
              id="fileInput"
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              multiple
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            {files.length > 0 && (
              <>
                <span className="text-sm text-muted" style={{ marginLeft: '0.75rem' }}>
                  {files.length} file{files.length !== 1 ? 's' : ''} selected
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={clearFiles}
                  style={{ marginLeft: '0.5rem', fontSize: '0.78rem' }}
                >
                  Clear all
                </button>
              </>
            )}
          </div>

          {thumbnails.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                overflowX: 'auto',
                padding: '0.5rem 0',
                flexWrap: 'wrap',
              }}
            >
              {thumbnails.map((url, i) => (
                <div
                  key={i}
                  style={{ position: 'relative', flexShrink: 0 }}
                >
                  <img
                    src={url}
                    alt={files[i].name}
                    title={files[i].name}
                    style={{
                      width: 100,
                      height: 100,
                      objectFit: 'cover',
                      borderRadius: 4,
                      border: '1px solid var(--color-border)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    title="Remove"
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      background: 'rgba(0,0,0,0.6)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '50%',
                      width: 20,
                      height: 20,
                      cursor: 'pointer',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    ×
                  </button>
                  <div
                    className="text-xs text-muted"
                    style={{ marginTop: 2, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={files[i].name}
                  >
                    {files[i].name}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div className="alert alert-error mb-2">{error}</div>}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={submitting}
          style={{ width: '100%', padding: '0.75rem' }}
        >
          {submitting ? (
            <>
              <span className="spinner" /> Submitting…
            </>
          ) : (
            'Submit for Review'
          )}
        </button>
      </form>
    </main>
  )
}
