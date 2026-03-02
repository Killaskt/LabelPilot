/**
 * Tests for export formatting logic.
 * We test the shape of the data structures, not the HTTP handler directly.
 */

type ResultStatus = 'match' | 'soft_mismatch' | 'mismatch' | 'not_found'

interface MockResult {
  id: string
  assetId: string
  field: string
  expectedValue: string | null
  foundValue: string | null
  confidence: number | null
  status: ResultStatus
  needsHuman: boolean
  processingTimeMs: number | null
}

interface MockOverride {
  field: string
  action: string
  note: string | null
}

function buildExportRow(
  result: MockResult,
  assetFilename: string,
  override?: MockOverride
) {
  return {
    field: result.field,
    assetFilename,
    expectedValue: result.expectedValue ?? '',
    foundValue: result.foundValue ?? '',
    confidence: result.confidence !== null ? result.confidence.toFixed(3) : '',
    systemStatus: result.status,
    needsHuman: result.needsHuman ? 'yes' : 'no',
    overrideAction: override?.action ?? '',
    overrideNote: override?.note ?? '',
    processingTimeMs: result.processingTimeMs !== null ? result.processingTimeMs.toFixed(1) : '',
  }
}

describe('export row formatting', () => {
  const base: MockResult = {
    id: 'r1',
    assetId: 'a1',
    field: 'brandName',
    expectedValue: 'Mountain Creek',
    foundValue: 'Mountain Creek',
    confidence: 0.9,
    status: 'match',
    needsHuman: false,
    processingTimeMs: 42.5,
  }

  it('formats a match result correctly', () => {
    const row = buildExportRow(base, 'front.jpg')
    expect(row.systemStatus).toBe('match')
    expect(row.needsHuman).toBe('no')
    expect(row.confidence).toBe('0.900')
    expect(row.processingTimeMs).toBe('42.5')
    expect(row.overrideAction).toBe('')
  })

  it('formats a not_found result with override', () => {
    const result: MockResult = { ...base, status: 'not_found', foundValue: null, needsHuman: true }
    const override: MockOverride = { field: 'brandName', action: 'needs_human', note: 'Check back label' }
    const row = buildExportRow(result, 'back.jpg', override)
    expect(row.systemStatus).toBe('not_found')
    expect(row.needsHuman).toBe('yes')
    expect(row.foundValue).toBe('')
    expect(row.overrideAction).toBe('needs_human')
    expect(row.overrideNote).toBe('Check back label')
  })

  it('formats null values as empty strings', () => {
    const result: MockResult = { ...base, confidence: null, processingTimeMs: null, foundValue: null }
    const row = buildExportRow(result, 'label.png')
    expect(row.confidence).toBe('')
    expect(row.processingTimeMs).toBe('')
    expect(row.foundValue).toBe('')
  })

  it('overrideNote is empty string when null', () => {
    const override: MockOverride = { field: 'brandName', action: 'accept', note: null }
    const row = buildExportRow(base, 'label.png', override)
    expect(row.overrideNote).toBe('')
  })
})
