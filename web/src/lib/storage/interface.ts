// swap for azure blob later if needed
export interface StorageAdapter {
  saveFile(
    jobId: string,
    assetId: string,
    ext: string,
    data: Buffer
  ): Promise<string>
  deleteJob(jobId: string): Promise<void>
  readFile(storedPath: string): Promise<Buffer>
}
