-- CreateTable
CREATE TABLE IF NOT EXISTS "Job" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "brandName" TEXT NOT NULL,
    "classType" TEXT NOT NULL,
    "alcoholContent" TEXT NOT NULL,
    "netContents" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "timeToFirstResult" DOUBLE PRECISION,
    "avgPerLabel" DOUBLE PRECISION,
    "p95PerLabel" DOUBLE PRECISION,
    "totalBatchTime" DOUBLE PRECISION,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobAsset" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "assetOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobResult" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "foundValue" TEXT,
    "expectedValue" TEXT,
    "confidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "bboxJson" TEXT,
    "needsHuman" BOOLEAN NOT NULL DEFAULT false,
    "processingTimeMs" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Override" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "assetId" TEXT,
    "field" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Override_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Override_jobId_field_key" ON "Override"("jobId", "field");

-- AddForeignKey (safe to re-run with DO $$)
DO $$ BEGIN
  ALTER TABLE "JobAsset" ADD CONSTRAINT "JobAsset_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "JobResult" ADD CONSTRAINT "JobResult_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "JobResult" ADD CONSTRAINT "JobResult_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "JobAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Override" ADD CONSTRAINT "Override_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
