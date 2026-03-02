import type { StorageAdapter } from './interface'
import { localStorageAdapter } from './local'
import { azureBlobAdapter } from './azure-blob'

export function getStorageAdapter(): StorageAdapter {
  return process.env.STORAGE_BACKEND === 'azure'
    ? azureBlobAdapter
    : localStorageAdapter
}
