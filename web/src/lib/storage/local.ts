import path from 'path'
import fs from 'fs/promises'
import type { StorageAdapter } from './interface'

function getUploadDir(): string {
  const env = process.env.UPLOAD_DIR
  if (env) {
    return path.isAbsolute(env) ? env : path.resolve(process.cwd(), env)
  }
  return path.resolve(process.cwd(), '..', 'local_uploads')
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export const localStorageAdapter: StorageAdapter = {
  async saveFile(jobId, assetId, ext, data): Promise<string> {
    const uploadDir = getUploadDir()
    const jobDir = path.join(uploadDir, jobId)
    await ensureDir(jobDir)

    const filename = `${assetId}${ext}`
    const filePath = path.join(jobDir, filename)
    await fs.writeFile(filePath, data)
    return `${jobId}/${filename}`
  },

  async deleteJob(jobId): Promise<void> {
    const uploadDir = getUploadDir()
    const jobDir = path.join(uploadDir, jobId)
    await fs.rm(jobDir, { recursive: true, force: true })
  },

  async readFile(storedPath): Promise<Buffer> {
    const uploadDir = getUploadDir()
    const filePath = path.join(uploadDir, storedPath)
    return fs.readFile(filePath)
  },
}
