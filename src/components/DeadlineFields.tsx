import type { DeadlineMode } from '../lib/database.types'
import { activeDeadlineKeys, deadlineLabel, modeLabels, timeKeys, type DeadlineInput, type DeadlineKey } from '../lib/deadlines'

const descriptions = { none: 'Track the issue without a scheduled cutoff.', single: 'Choose a date and time, or select End of day.', stages: 'Plan individual milestones. A separate overall deadline is optional.' }

export default function DeadlineFields({ value, onChange, timezone, prefix, disabled = false }: {
  value: DeadlineInput; onChange: (value: DeadlineInput) => void; timezone: string; prefix: string; disabled?: boolean
}) {
  const field = (key: DeadlineKey) => {
    const timeKey = timeKeys[key]
    const endOfDay = value.end_of_day[key]
    return (
      <fieldset key={key} className="min-w-0 rounded-md border border-outline-variant p-sm" disabled={disabled}>
        <legend className="px-xs text-label-md font-semibold">{deadlineLabel(key, value.deadline_mode)}{value.deadline_mode === 'stages' ? ' (optional)' : ''}</legend>
        <label htmlFor={`${prefix}-${key}`} className="mb-xs block text-body-md">Date</label>
        <input id={`${prefix}-${key}`} type="date" min="0001-01-01" max="9999-12-31" value={value[key]} required={value.deadline_mode === 'single'}
          onChange={(event) => onChange({ ...value, [key]: event.target.value })}
          className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-xs text-body-md focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60" />
        <label className="my-sm flex items-center gap-xs text-body-md">
          <input type="checkbox" checked={endOfDay} onChange={(event) => onChange({ ...value, end_of_day: { ...value.end_of_day, [key]: event.target.checked }, [timeKey]: value[timeKey] || '17:00' })} className="accent-primary focus-visible:outline-2" />
          End of day
        </label>
        <>
          <label htmlFor={`${prefix}-${timeKey}`} className="mb-xs block text-body-md">Time ({timezone})</label>
          <input id={`${prefix}-${timeKey}`} type="time" step="any" disabled={endOfDay} required={!endOfDay && !!value[key]} value={endOfDay ? '' : value[timeKey]}
            onChange={(event) => onChange({ ...value, [timeKey]: event.target.value })}
            className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-xs text-body-md focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60" />
        </>
      </fieldset>
    )
  }
  return (
    <section className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md text-on-surface">
      <fieldset disabled={disabled}>
        <legend className="mb-sm text-body-md font-bold">Deadline type</legend>
        <div className="grid gap-xs sm:grid-cols-3">
          {(Object.keys(modeLabels) as DeadlineMode[]).map((mode) => (
            <label key={mode} className={`flex cursor-pointer items-center gap-xs rounded-md border p-sm text-label-md font-semibold ${value.deadline_mode === mode ? 'border-primary bg-primary-fixed/30' : 'border-outline-variant'}`}>
              <input type="radio" name={`${prefix}-deadline-mode`} value={mode} checked={value.deadline_mode === mode} onChange={() => onChange({ ...value, deadline_mode: mode })} className="accent-primary focus-visible:outline-2" />
              {modeLabels[mode]}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="my-sm text-body-md text-on-surface-variant">{descriptions[value.deadline_mode]}</p>
      {value.deadline_mode !== 'none' && <>
        <div className={`grid gap-sm ${value.deadline_mode === 'stages' ? 'sm:grid-cols-2' : ''}`}>{activeDeadlineKeys(value.deadline_mode).map(field)}</div>
        {value.deadline_mode === 'stages' && <p className="mt-sm text-body-md text-on-surface-variant">QA decision records a pass or fail. A failed attempt keeps its targets until an owner or reporter reschedules them.</p>}
      </>}
    </section>
  )
}
