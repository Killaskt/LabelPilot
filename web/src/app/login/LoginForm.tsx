'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (res.ok) {
        const raw = searchParams.get('next') ?? '/'
        const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
        router.push(next)
      } else {
        setError('Invalid access code. Please try again.')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg)',
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 360, padding: '2rem' }}>
        <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
          <span style={{
            fontWeight: 700,
            fontSize: '1.25rem',
            color: 'var(--color-primary)',
            display: 'block',
            marginBottom: '0.4rem',
          }}>
            LabelPilot
          </span>
          <p className="text-muted text-sm">Enter your access code to continue</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="lp-code">Access code</label>
            <input
              id="lp-code"
              type="password"
              className="form-input"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="••••••••"
              autoFocus
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <div className="alert alert-error mb-2" role="alert">{error}</div>
          )}
          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={loading || !code}
          >
            {loading && <span className="spinner" style={{ marginRight: '0.4rem' }} />}
            {loading ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
