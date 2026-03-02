import { BlobServiceClient } from '@azure/storage-blob'
import type { StorageAdapter } from './interface'

function getContainerClient() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? 'labelpilotdb'
  if (!connectionString) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set')
  }
  return BlobServiceClient
    .fromConnectionString(connectionString)
    .getContainerClient(containerName)
}

export const azureBlobAdapter: StorageAdapter = {
  async saveFile(jobId, assetId, ext, data): Promise<string> {
    const blobName = `${jobId}/${assetId}${ext}`
    const containerClient = getContainerClient()
    await containerClient.createIfNotExists()
    const blobClient = containerClient.getBlockBlobClient(blobName)
    await blobClient.upload(data, data.length, {
      blobHTTPHeaders: { blobContentType: _mimeFromExt(ext) },
    })
    return blobName
  },

  async deleteJob(jobId): Promise<void> {
    const containerClient = getContainerClient()
    for await (const blob of containerClient.listBlobsFlat({ prefix: `${jobId}/` })) {
      await containerClient.deleteBlob(blob.name)
    }
  },

  async readFile(storedPath): Promise<Buffer> {
    const blobClient = getContainerClient().getBlockBlobClient(storedPath)
    return blobClient.downloadToBuffer()
  },
}

function _mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  }
  return map[ext.toLowerCase()] ?? 'application/octet-stream'
}
