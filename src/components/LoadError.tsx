export default function LoadError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  if (!message) return null
  return (
    <div role="alert" className="mb-md flex items-center justify-between gap-sm rounded-md border border-error/30 bg-error-container px-md py-sm text-body-md text-on-error-container">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="shrink-0 rounded px-sm py-xs font-semibold underline focus-visible:outline-2">Retry</button>
    </div>
  )
}
