import { deadlineKeys, deadlineLabels, type DeadlineInput } from '../lib/deadlines'

export default function DeadlineFields({ value, onChange, timezone, prefix, disabled = false }: {
  value: DeadlineInput; onChange: (value: DeadlineInput) => void; timezone: string; prefix: string; disabled?: boolean
}) {
  const field = (key: keyof DeadlineInput) => (
    <div key={key}>
      <label htmlFor={`${prefix}-${key}`} className="mb-xs block text-label-md font-semibold">{deadlineLabels[key]} <span className="font-normal text-on-surface-variant">(optional)</span></label>
      <input id={`${prefix}-${key}`} type="date" max="9999-12-31" value={value[key]} disabled={disabled}
        onChange={(event) => onChange({ ...value, [key]: event.target.value })}
        className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-md text-on-surface focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60" />
    </div>
  )
  return (
    <section className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md text-on-surface">
      <h3 className="mb-sm text-body-md font-bold">Deadlines</h3>
      {field('resolve_by')}
      <p className="mt-xs text-body-md text-on-surface-variant">Target for verified completion and closure. Dates run through the end of the day in {timezone}.</p>
      <details className="mt-md" open={deadlineKeys.slice(0, 3).some((key) => !!value[key]) || undefined}>
        <summary className="cursor-pointer rounded text-label-md font-semibold focus-visible:outline-2">Stage targets (optional)</summary>
        <div className="mt-sm grid gap-sm sm:grid-cols-3">{deadlineKeys.slice(0, 3).map(field)}</div>
        <p className="mt-sm text-body-md text-on-surface-variant">QA decision records a pass or fail. Targets remain unchanged after failed QA until an owner or reporter reschedules them.</p>
      </details>
    </section>
  )
}
