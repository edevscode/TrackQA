import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { deadlineInput, type DeadlineInput } from '../lib/deadlines'
import { useUserTimezone } from './useDeadlineClock'

export function useLocalDeadlineInput(initial: Parameters<typeof deadlineInput>[0]) {
  const timezone = useUserTimezone()
  const [stored, setStored] = useState(() => deadlineInput(initial, timezone))
  const input = stored.entry_timezone === timezone ? stored : deadlineInput(stored, timezone)
  const setInput = useCallback<Dispatch<SetStateAction<DeadlineInput>>>((action) => {
    setStored((previous) => typeof action === 'function'
      ? action(previous.entry_timezone === timezone ? previous : deadlineInput(previous, timezone))
      : action)
  }, [timezone])
  return [input, setInput] as const
}
