/** Keep only failed files so retries never resubmit successful evidence. */
export async function uploadFiles(files: File[], upload: (file: File) => Promise<void>): Promise<File[]> {
  const failed: File[] = []
  for (const file of files) {
    try { await upload(file) }
    catch { failed.push(file) }
  }
  return failed
}
