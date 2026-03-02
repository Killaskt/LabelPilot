import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'LabelPilot Assistant',
  description: 'Review TTB alcohol label submissions',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <span className="nav-brand">LabelPilot</span>
          <div className="nav-links">
            <Link href="/upload">Upload</Link>
            <Link href="/queue">Queue</Link>
            <Link href="/history">History</Link>
          </div>
          <form method="post" action="/api/auth/logout" style={{ marginLeft: 'auto' }}>
            <button
              type="submit"
              style={{
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 'var(--radius)',
                color: 'rgba(255,255,255,0.7)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 600,
                padding: '0.3rem 0.65rem',
              }}
            >
              Sign out
            </button>
          </form>
        </nav>
        {children}
      </body>
    </html>
  )
}
