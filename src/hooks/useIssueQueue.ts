import { useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { changeQueue, queueParams, readQueue } from '../lib/issueQueue'
import type { QueuePath, QueueState, QueueReturn } from '../lib/issueQueue'

export function useIssueQueue(path: QueuePath, projectId: string) {
  const [params, setParams] = useSearchParams()
  const state = readQueue(path, params, projectId)
  const canonical = queueParams(path, state, projectId).toString()
  const raw = params.toString()
  useEffect(() => {
    if (raw !== canonical) setParams(canonical, { replace: true })
  }, [raw, canonical, setParams])
  const update = useCallback((patch: Partial<QueueState>, replace = false) => {
    setParams(changeQueue(path, readQueue(path, new URLSearchParams(canonical), projectId), patch, projectId), { replace })
  }, [path, canonical, projectId, setParams])
  const origin: QueueReturn = { pathname: path, search: `?${canonical}`, projectId }
  return { state, update, origin }
}
