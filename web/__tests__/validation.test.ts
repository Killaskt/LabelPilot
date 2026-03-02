import { validateUpload, sanitizeFilename, getExtension } from '@/lib/validation'

const MAGIC = {
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: new Uint8Array([0xff, 0xd8, 0xff]),
}

// Helper: create a minimal File-like object (no magic bytes — use makeImageFile for valid images)
function makeFile(name: string, size: number, type: string): File {
  const blob = new Blob([new Uint8Array(size)], { type })
  return new File([blob], name, { type })
}

// Helper: create a File that passes the magic-byte check (PNG or JPEG)
function makeImageFile(name: string, size: number, kind: 'png' | 'jpeg'): File {
  const mime = kind === 'png' ? 'image/png' : 'image/jpeg'
  const magic = kind === 'png' ? MAGIC.png : MAGIC.jpeg
  const padding = new Uint8Array(Math.max(0, size - magic.length))
  const blob = new Blob([magic, padding], { type: mime })
  return new File([blob], name, { type: mime })
}

describe('validateUpload', () => {
  it('returns error when no files provided', async () => {
    await expect(validateUpload([])).resolves.toMatchObject({ code: 'NO_FILES' })
  })

  it('accepts valid single image', async () => {
    const files = [makeImageFile('label.png', 1024, 'png')]
    await expect(validateUpload(files)).resolves.toBeNull()
  })

  it('accepts 10 valid images', async () => {
    const files = Array.from({ length: 10 }, (_, i) =>
      makeImageFile(`label${i}.jpg`, 1024, 'jpeg')
    )
    await expect(validateUpload(files)).resolves.toBeNull()
  })

  it('rejects more than 10 files', async () => {
    const files = Array.from({ length: 11 }, (_, i) =>
      makeImageFile(`label${i}.jpg`, 1024, 'jpeg')
    )
    await expect(validateUpload(files)).resolves.toMatchObject({ code: 'TOO_MANY_FILES' })
  })

  it('rejects unsupported MIME type', async () => {
    const files = [makeFile('doc.pdf', 1024, 'application/pdf')]
    await expect(validateUpload(files)).resolves.toMatchObject({ code: 'INVALID_FILE_TYPE' })
  })

  it('rejects empty file', async () => {
    const files = [makeFile('empty.png', 0, 'image/png')]
    await expect(validateUpload(files)).resolves.toMatchObject({ code: 'EMPTY_FILE' })
  })

  it('rejects double-extension filename', async () => {
    const files = [makeImageFile('evil.php.jpg', 1024, 'jpeg')]
    await expect(validateUpload(files)).resolves.toMatchObject({ code: 'SUSPICIOUS_FILENAME' })
  })

  it('rejects file exceeding size limit (MAX_FILE_SIZE_MB=10)', async () => {
    const overSize = 11 * 1024 * 1024
    const files = [makeImageFile('big.jpg', overSize, 'jpeg')]
    await expect(validateUpload(files)).resolves.toMatchObject({ code: 'FILE_TOO_LARGE' })
  })

  it('rejects file that does not have PNG/JPEG magic bytes', async () => {
    const files = [makeFile('fake.png', 1024, 'image/png')]
    await expect(validateUpload(files)).resolves.toMatchObject({ code: 'INVALID_FILE_CONTENT' })
  })
})

describe('sanitizeFilename', () => {
  it('strips path separators', () => {
    expect(sanitizeFilename('../../../etc/passwd')).not.toContain('/')
    expect(sanitizeFilename('../../../etc/passwd')).not.toContain('\\')
  })

  it('keeps safe characters', () => {
    expect(sanitizeFilename('My Label_v2.png')).toBe('My Label_v2.png')
  })

  it('replaces special characters', () => {
    const result = sanitizeFilename('hello<world>.jpg')
    expect(result).not.toContain('<')
    expect(result).not.toContain('>')
  })

  it('handles empty input', () => {
    expect(sanitizeFilename('')).toBe('upload')
  })
})

describe('getExtension', () => {
  it('extracts extension as lowercase', () => {
    expect(getExtension('label.PNG')).toBe('.png')
    expect(getExtension('photo.JPEG')).toBe('.jpeg')
    expect(getExtension('image.jpg')).toBe('.jpg')
  })

  it('returns .jpg as default for no extension', () => {
    expect(getExtension('noextension')).toBe('.jpg')
  })
})
