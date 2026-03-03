'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface FormFields {
  brandName: string
  classType: string
  alcoholContent: string
  netContents: string
  bottlerInfo: string
  countryOfOrigin: string
}

const INITIAL_FIELDS: FormFields = {
  brandName: '',
  classType: '',
  alcoholContent: '',
  netContents: '',
  bottlerInfo: '',
  countryOfOrigin: '',
}

export default function UploadPage() {
  const router = useRouter()
  const [fields, setFields] = useState<FormFields>(INITIAL_FIELDS)
  const [files, setFiles] = useState<File[]>([])
  const [thumbnails, setThumbnails] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [additionalOpen, setAdditionalOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFieldChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFields((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length === 0) return

    thumbnails.forEach((url) => URL.revokeObjectURL(url))

    setFiles(selected)
    setThumbnails(selected.map((f) => URL.createObjectURL(f)))
    setError(null)
  }, [thumbnails])

  const removeFile = (index: number) => {
    URL.revokeObjectURL(thumbnails[index])
    setFiles((prev) => prev.filter((_, i) => i !== index))
    setThumbnails((prev) => prev.filter((_, i) => i !== index))
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

  return (
    <main className="page">
      <div className="page-title">
        <h1>Submit Label for Review</h1>
        <p className="page-subtitle">
          Enter the application fields and upload 1–10 label images (PNG or JPEG, max 10 MB each).
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ maxWidth: 640 }}>
        <div className="card mb-2">
          <h2 style={{ marginBottom: '1rem' }}>Application Fields</h2>

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
              <span className="text-sm text-muted" style={{ marginLeft: '0.75rem' }}>
                {files.length} file{files.length !== 1 ? 's' : ''} selected
              </span>
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
