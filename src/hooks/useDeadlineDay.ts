import { useEffect, useState } from 'react'
import { dateInTimezone } from '../lib/deadlines'

export function useDeadlineDay(timezone = 'Asia/Manila') {
  const [day, setDay] = useState(() => dateInTimezone(new Date(), timezone))
  useEffect(() => {
    const update = () => setDay(dateInTimezone(new Date(), timezone))
    update()
    const timer = setInterval(update, 60_000)
    return () => clearInterval(timer)
  }, [timezone])
  return day
}
