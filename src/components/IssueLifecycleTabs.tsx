import { lifecycleLabels, type IssueLifecycle } from '../lib/issueWork'

export default function IssueLifecycleTabs({ value, onChange }: {
  value: IssueLifecycle; onChange: (value: IssueLifecycle) => void
}) {
  return (
    <nav aria-label="Issue lifecycle" className="flex flex-wrap gap-md">
      {(Object.keys(lifecycleLabels) as IssueLifecycle[]).map((scope) => (
        <button key={scope} type="button" aria-pressed={value === scope} onClick={() => onChange(scope)}
          className={`border-b-2 px-xs py-sm text-body-md font-semibold transition-colors focus-visible:outline-2 ${value === scope ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}>
          {lifecycleLabels[scope]}
        </button>
      ))}
    </nav>
  )
}
