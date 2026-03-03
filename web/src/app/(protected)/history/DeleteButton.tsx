'use client'

export function DeleteButton({ jobId }: { jobId: string }) {
  const handleClick = async () => {
    if (!confirm('Delete this job? This cannot be undone.')) return
    await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' })
    window.location.reload()
  }

  return (
    <button type="button" className="btn btn-danger btn-xs" onClick={handleClick}>
      Delete
    </button>
  )
}
