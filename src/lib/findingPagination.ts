// Findings pages are zero-based. The same filtered query returns an exact count,
// so recovery jumps directly to the nearest valid page, not one page per fetch.
export function isFindingRangeError(page: number, status: number, code: string | undefined): boolean {
  return page > 0 && status === 416 && code === 'PGRST103'
}

export function recoverFindingPage(page: number, rowCount: number, total: number | null, pageSize: number): number {
  if (rowCount > 0 || page === 0) return page
  if (total === null || !Number.isSafeInteger(total) || total < 0 || pageSize < 1) {
    throw new Error('Finding page count unavailable.')
  }
  const nearest = Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1))
  // An inconsistent response must show Retry rather than refetch the same page.
  if (nearest === page) throw new Error('Finding page could not be verified.')
  return nearest
}
