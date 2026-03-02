/**
 * Tests for the storage adapter factory.
 *
 * Covers:
 *   - getStorageAdapter() returns local adapter by default
 *   - getStorageAdapter() returns local adapter when STORAGE_BACKEND=local
 *   - getStorageAdapter() returns azure adapter when STORAGE_BACKEND=azure
 *   - Returned adapter objects satisfy the StorageAdapter interface shape
 *   - Factory re-evaluates the env var on each call (no cached singleton)
 */

import { getStorageAdapter } from '@/lib/storage'
import { localStorageAdapter } from '@/lib/storage/local'
import { azureBlobAdapter } from '@/lib/storage/azure-blob'

// Save original env so we can restore it after each test
const originalEnv = process.env.STORAGE_BACKEND

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.STORAGE_BACKEND
  } else {
    process.env.STORAGE_BACKEND = originalEnv
  }
})

// ─── Factory routing ──────────────────────────────────────────────────────────

describe('getStorageAdapter — routing', () => {
  it('returns local adapter when STORAGE_BACKEND is not set', () => {
    delete process.env.STORAGE_BACKEND
    expect(getStorageAdapter()).toBe(localStorageAdapter)
  })

  it('returns local adapter when STORAGE_BACKEND=local', () => {
    process.env.STORAGE_BACKEND = 'local'
    expect(getStorageAdapter()).toBe(localStorageAdapter)
  })

  it('returns local adapter for an unrecognised value', () => {
    process.env.STORAGE_BACKEND = 's3'
    expect(getStorageAdapter()).toBe(localStorageAdapter)
  })

  it('returns azure adapter when STORAGE_BACKEND=azure', () => {
    process.env.STORAGE_BACKEND = 'azure'
    expect(getStorageAdapter()).toBe(azureBlobAdapter)
  })

  it('re-evaluates env var on each call', () => {
    process.env.STORAGE_BACKEND = 'local'
    expect(getStorageAdapter()).toBe(localStorageAdapter)

    process.env.STORAGE_BACKEND = 'azure'
    expect(getStorageAdapter()).toBe(azureBlobAdapter)
  })
})

// ─── Interface shape ──────────────────────────────────────────────────────────

describe('adapter interface shape', () => {
  const REQUIRED_METHODS = ['saveFile', 'readFile', 'deleteJob'] as const

  it('local adapter exposes all required methods', () => {
    for (const method of REQUIRED_METHODS) {
      expect(typeof localStorageAdapter[method]).toBe('function')
    }
  })

  it('azure adapter exposes all required methods', () => {
    for (const method of REQUIRED_METHODS) {
      expect(typeof azureBlobAdapter[method]).toBe('function')
    }
  })
})
