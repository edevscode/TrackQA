type ConnectionCheck = {
  data: { id: string; project_id: string; revoked_at: string | null } | null
  error: unknown
}

/** A successful mutation alone is not independent evidence of revocation. */
export async function verifyConnectionRevoked(
  lookup: () => PromiseLike<ConnectionCheck>, projectId: string, connectionId: string,
): Promise<boolean> {
  try {
    const { data, error } = await lookup()
    return !error && data?.id === connectionId && data.project_id === projectId
      && typeof data.revoked_at === 'string' && Number.isFinite(Date.parse(data.revoked_at))
  } catch { return false }
}
