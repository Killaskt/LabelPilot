export type JobStatus =
  | 'queued'
  | 'processing'
  | 'ready'
  | 'needs_human'
  | 'error'
  | 'deleted'
  | 'expired'

export type ResultStatus = 'match' | 'soft_mismatch' | 'mismatch' | 'not_found'

export type OverrideAction = 'accept' | 'reject' | 'needs_human'

export type FieldName =
  | 'brandName'
  | 'classType'
  | 'alcoholContent'
  | 'netContents'
  | 'governmentWarning'

export const FIELD_LABELS: Record<FieldName, string> = {
  brandName: 'Brand Name',
  classType: 'Class / Type',
  alcoholContent: 'Alcohol Content',
  netContents: 'Net Contents',
  governmentWarning: 'Government Warning',
}

export const ALL_FIELDS: FieldName[] = [
  'brandName',
  'classType',
  'alcoholContent',
  'netContents',
  'governmentWarning',
]

export const TERMINAL_STATUSES = new Set<JobStatus>([
  'ready',
  'needs_human',
  'error',
  'deleted',
  'expired',
])

export interface BBox {
  x: number // normalized 0–1
  y: number
  w: number
  h: number
}

export interface JobAsset {
  id: string
  jobId: string
  filename: string
  storedPath: string
  mimeType: string
  assetOrder: number
  createdAt: string
  url?: string // injected by API
}

export interface JobResult {
  id: string
  jobId: string
  assetId: string
  field: FieldName
  foundValue: string | null
  expectedValue: string | null
  confidence: number | null
  status: ResultStatus
  bboxJson: string | null
  needsHuman: boolean
  processingTimeMs: number | null
  createdAt: string
}

export interface Override {
  id: string
  jobId: string
  assetId: string | null
  field: FieldName
  action: OverrideAction
  note: string | null
  createdAt: string
  updatedAt: string
}

export interface Job {
  id: string
  sessionId: string
  status: JobStatus
  brandName: string
  classType: string
  alcoholContent: string
  netContents: string
  bottlerInfo: string | null
  countryOfOrigin: string | null
  expiresAt: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  errorMessage: string | null
  timeToFirstResult: number | null
  avgPerLabel: number | null
  p95PerLabel: number | null
  totalBatchTime: number | null
}

export interface JobDetail extends Job {
  assets: JobAsset[]
  results: JobResult[]
  overrides: Override[]
}

export interface ApiError {
  code: string
  message: string
  details?: unknown
}
