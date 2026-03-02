const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png'])

// file header bytes for png/jpeg
const MAGIC = {
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: new Uint8Array([0xff, 0xd8, 0xff]),
} as const

// block stuff like evil.php.jpg
const DOUBLE_EXT_RE = /\.[a-zA-Z0-9]{2,4}\.[a-zA-Z0-9]{2,4}$/

function getMaxFileSize(): number {
  return (parseInt(process.env.MAX_FILE_SIZE_MB ?? '10', 10) || 10) * 1024 * 1024
}

function getMaxFiles(): number {
  return parseInt(process.env.MAX_FILES ?? '10', 10) || 10
}

export interface UploadValidationError {
  code: string
  message: string
  status: number
}

// peek first 8 bytes to see if it's actually png/jpeg
async function getDetectedImageType(file: File): Promise<'image/png' | 'image/jpeg' | null> {
  const header = await file.slice(0, 8).arrayBuffer()
  const bytes = new Uint8Array(header)
  if (bytes.length >= MAGIC.png.length && MAGIC.png.every((b, i) => bytes[i] === b)) {
    return 'image/png'
  }
  if (bytes.length >= MAGIC.jpeg.length && MAGIC.jpeg.every((b, i) => bytes[i] === b)) {
    return 'image/jpeg'
  }
  return null
}

export async function validateUpload(files: File[]): Promise<UploadValidationError | null> {
  if (!files || files.length === 0) {
    return { code: 'NO_FILES', message: 'At least one file is required.', status: 400 }
  }

  const maxFiles = getMaxFiles()
  if (files.length > maxFiles) {
    return {
      code: 'TOO_MANY_FILES',
      message: `Maximum ${maxFiles} files allowed per submission.`,
      status: 400,
    }
  }

  const maxSize = getMaxFileSize()

  for (const file of files) {
    if (DOUBLE_EXT_RE.test(file.name)) {
      return {
        code: 'SUSPICIOUS_FILENAME',
        message: `Suspicious filename rejected: "${file.name}".`,
        status: 400,
      }
    }

    const mime = file.type || 'application/octet-stream'
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      return {
        code: 'INVALID_FILE_TYPE',
        message: `File type "${mime}" is not allowed. Upload PNG or JPEG images only.`,
        status: 400,
      }
    }

    if (file.size === 0) {
      return {
        code: 'EMPTY_FILE',
        message: `File "${file.name}" is empty.`,
        status: 400,
      }
    }

    if (file.size > maxSize) {
      return {
        code: 'FILE_TOO_LARGE',
        message: `File "${file.name}" exceeds the ${process.env.MAX_FILE_SIZE_MB ?? 10} MB limit.`,
        status: 413,
      }
    }

    const detectedType = await getDetectedImageType(file)
    if (!detectedType) {
      return {
        code: 'INVALID_FILE_CONTENT',
        message: `File "${file.name}" does not appear to be a valid PNG or JPEG image (invalid or missing magic bytes).`,
        status: 400,
      }
    }
  }

  return null
}

export function sanitizeFilename(raw: string): string {
  const base = raw
    .replace(/[/\\]/g, '')
    .replace(/\0/g, '')
    .replace(/[^a-zA-Z0-9._\- ]/g, '_')
  return base.slice(0, 255) || 'upload'
}

export function getExtension(filename: string): string {
  const m = filename.match(/\.([a-zA-Z0-9]+)$/)
  return m ? `.${m[1].toLowerCase()}` : '.jpg'
}
