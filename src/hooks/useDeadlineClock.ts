import { useSyncExternalStore } from 'react'
import { userTimezone } from '../lib/timezones'

const listeners = new Set<() => void>()
const snapshot = () => Math.floor(Date.now() / 60_000)
let minute = snapshot()
let timezone = userTimezone()
let timer: ReturnType<typeof setInterval> | undefined
const update = () => {
  const next = snapshot()
  const nextTimezone = userTimezone()
  if (minute === next && timezone === nextTimezone) return
  minute = next
  timezone = nextTimezone
  listeners.forEach((listener) => listener())
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    timer = setInterval(update, 1000)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
    }
  }
}
/** One shared clock keeps precise deadlines fresh without per-row timers. */
export function useDeadlineClock() {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function useUserTimezone() {
  return useSyncExternalStore(subscribe, userTimezone, userTimezone)
}
