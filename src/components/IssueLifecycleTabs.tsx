import { lifecycleLabels, type IssueLifecycle } from '../lib/issueWork'

export default function IssueLifecycleTabs({ value, onChange }: {
  value: IssueLifecycle; onChange: (value: IssueLifecycle) => void
}) {
  return (
    <nav aria-label="Issue lifecycle" className="mb-md flex flex-wrap gap-xs">
      {(Object.keys(lifecycleLabels) as IssueLifecycle[]).map((scope) => (
        <button key={scope} type="button" aria-pressed={value === scope} onClick={() => onChange(scope)}
          className={`rounded-md border px-md py-sm text-body-md font-semibold transition-colors focus-visible:outline-2 ${value === scope ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container'}`}>
          {lifecycleLabels[scope]}
        </button>
      ))}
    </nav>
  )
}
