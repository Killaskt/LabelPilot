import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'TTB Label Review Assistant',
  description: 'Review TTB alcohol label submissions',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <span className="nav-brand">TTB Label Review</span>
          <div className="nav-links">
            <Link href="/upload">Upload</Link>
            <Link href="/queue">Queue</Link>
            <Link href="/history">History</Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  )
}
