export function userTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function localTimeInput(instant: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant))
  const part = (type: string) => parts.find((value) => value.type === type)!.value
  const seconds = part('second')
  const milliseconds = ((instant % 1000) + 1000) % 1000
  return `${part('hour')}:${part('minute')}${seconds !== '00' || milliseconds ? `:${seconds}${milliseconds ? `.${String(milliseconds).padStart(3, '0')}` : ''}` : ''}`
}
