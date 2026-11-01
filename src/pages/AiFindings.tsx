import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ChevronDown, RefreshCw, ScanSearch } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import ConfirmModal from '../components/ConfirmModal'
import LoadError from '../components/LoadError'
import { useProject } from '../contexts/ProjectContext'
import { supabase } from '../lib/supabase'
import { invalidateProjectCache } from '../lib/cache'
import type { AiFinding, FindingReceipt } from '../lib/database.types'

type Finding = AiFinding & { reviewer: { full_name: string | null } | null }
type Decision = 'CONFIRMED' | 'REJECTED'
const fields = 'id,project_id,connection_id,submission_id,title,description,suggested_priority,file_path,line_start,line_end,evidence_excerpt,status,reviewed_by,reviewed_at,review_note,issue_id,created_at,updated_at,reviewer:profiles!ai_findings_reviewed_by_fkey(full_name)' as const
const pageSize = 25
const statusLabel = { PENDING: 'Pending Review', CONFIRMED: 'Confirmed', REJECTED: 'Rejected' }

export default function AiFindings() {
  const { currentProject, canReportIssues } = useProject()
  if (!currentProject || !canReportIssues) return <Navigate to="/issues" replace />
  // Project switches cannot retain another project's findings or review form.
  return <Findings key={currentProject.id} projectId={currentProject.id} archived={currentProject.archived} />
}

function Findings({ projectId, archived }: { projectId: string; archived: boolean }) {
  const [reviewed, setReviewed] = useState(false)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Finding[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [decision, setDecision] = useState<Decision | null>(null)
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState<FindingReceipt | null>(null)
  const request = useRef(0)
  const cancellation = useRef<AbortController | null>(null)
  const submitting = useRef(false)
  const finding = rows.find((row) => row.id === selected)

  const load = useCallback(async () => {
    const version = ++request.current
    const signal = cancellation.current?.signal
    try {
      let query = supabase.from('ai_findings').select(fields).eq('project_id', projectId)
      if (signal) query = query.abortSignal(signal)
      query = reviewed ? query.neq('status', 'PENDING') : query.eq('status', 'PENDING')
      const { data, error: failed } = await query.order('created_at', { ascending: false })
        .order('id', { ascending: false }).range(page * pageSize, (page + 1) * pageSize)
      if (failed) throw failed
      if (signal?.aborted || version !== request.current) return
      setError(null)
      setRows(data.slice(0, pageSize))
      setHasMore(data.length > pageSize)
    } catch {
      if (!signal?.aborted && version === request.current) setError('Unable to load findings. Check your project access and retry.')
    } finally {
      if (!signal?.aborted && version === request.current) setLoading(false)
    }
  }, [projectId, reviewed, page])

  useEffect(() => {
    const controller = new AbortController()
    cancellation.current = controller
    // Synchronize with PostgREST; result state updates follow the awaited query.
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
    const refresh = () => { if (!submitting.current) { setLoading(true); void load() } }
    window.addEventListener('focus', refresh)
    return () => { controller.abort(); window.removeEventListener('focus', refresh) }
  }, [load])

  function refresh() { setLoading(true); void load() }
  function selectStatus(value: boolean) {
    if (reviewed === value) return
    setReviewed(value)
    setPage(0)
    setSelected(null)
    setDecision(null)
    setNote('')
    setRows([])
    setLoading(true)
  }
  function selectPage(value: number) {
    setPage(value)
    setSelected(null)
    setDecision(null)
    setNote('')
    setLoading(true)
  }

  async function review() {
    if (!finding || !decision || submitting.current) return
    submitting.current = true
    setSaving(true)
    setError(null)
    try {
      const { data, error: failed } = await supabase.rpc('review_ai_finding', {
        p_finding_id: finding.id, p_decision: decision, p_review_note: note.trim() || null,
      })
      if (failed || data?.length !== 1 || data[0].project_id !== projectId) throw new Error('Review failed')
      setReceipt(data[0])
      setSelected(null)
      setNote('')
      setDecision(null)
      invalidateProjectCache(projectId)
      await load()
    } catch {
      setDecision(null)
      setError('Review could not be completed. Refresh to check its current status before retrying.')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="mx-auto w-full max-w-[1120px] flex-1 px-md py-md lg:px-lg lg:py-lg">
          <div className="mb-lg flex items-start justify-between gap-md">
            <div>
              <h1 className="text-headline-xl font-bold text-on-surface">AI Findings</h1>
              <p className="mt-xs text-body-md text-on-surface-variant">Review potential bugs before they become official issues. Confirmed issues are reported under your name.</p>
            </div>
            <button type="button" onClick={refresh} disabled={loading || saving} aria-label="Refresh findings" title="Refresh findings" className="rounded-md border border-outline-variant p-sm text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50"><RefreshCw size={18} /></button>
          </div>
          <div className="mb-md flex gap-md border-b border-outline-variant" role="group" aria-label="Finding status">
            {[false, true].map((value) => <button key={String(value)} type="button" disabled={saving} aria-pressed={reviewed === value} onClick={() => selectStatus(value)} className={`border-b-2 px-xs py-sm text-label-lg font-semibold ${reviewed === value ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant'}`}>{value ? 'Reviewed' : 'Pending Review'}</button>)}
          </div>
          <LoadError message={error} onRetry={refresh} />
          {receipt && <div role="status" className="mb-md rounded-md border border-outline-variant bg-surface-container-lowest p-md text-body-md text-on-surface">Finding {receipt.status === 'CONFIRMED' ? 'confirmed' : 'rejected'}.{receipt.issue_id && <> <Link to={`/issues/${receipt.issue_id}`} className="font-semibold text-primary underline">View issue</Link></>}</div>}
          {loading ? <p className="py-lg text-body-md text-on-surface-variant" role="status">Loading findings…</p> : !error && rows.length === 0 ? (
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-xl text-center">
              <ScanSearch size={28} className="mx-auto mb-sm text-outline" />
              <p className="font-semibold text-on-surface">{reviewed ? 'No reviewed findings' : 'No findings awaiting review'}</p>
              <p className="mt-xs text-body-md text-on-surface-variant">AI submissions appear here for QA or Owner review.</p>
            </div>
          ) : <div className="space-y-sm">{rows.map((row) => (
            <article key={row.id} className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
              <button type="button" aria-expanded={selected === row.id} disabled={saving} onClick={() => { setSelected(selected === row.id ? null : row.id); setDecision(null); setNote('') }} className="flex w-full items-center justify-between gap-md p-md text-left hover:bg-surface-container-low">
                <div className="min-w-0">
                  <h2 className="break-words text-body-lg font-semibold text-on-surface">{row.title}</h2>
                  <p className="mt-xs text-label-md text-on-surface-variant">{row.suggested_priority} · {statusLabel[row.status]} · {new Date(row.created_at).toLocaleString()}</p>
                </div>
                <ChevronDown size={18} className={`shrink-0 text-on-surface-variant ${selected === row.id ? 'rotate-180' : ''}`} />
              </button>
              {selected === row.id && <div className="space-y-md border-t border-outline-variant p-md">
                <p className="whitespace-pre-wrap break-words text-body-md text-on-surface">{row.description}</p>
                {row.file_path && <p className="break-all font-mono text-code-sm text-on-surface-variant">{row.file_path}{row.line_start !== null ? `:${row.line_start}` : ''}{row.line_end !== null ? `–${row.line_end}` : ''}</p>}
                {row.evidence_excerpt && <div><p className="mb-xs text-label-md font-semibold text-on-surface-variant">AI-supplied evidence · untrusted text</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-container-low p-md font-mono text-code-sm text-on-surface">{row.evidence_excerpt}</pre></div>}
                {row.status === 'PENDING' ? <>
                  <label className="block text-label-md font-semibold text-on-surface">Review note <span className="font-normal text-on-surface-variant">(optional)</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={4000} disabled={saving || archived} rows={2} className="mt-xs w-full rounded-md border border-outline-variant bg-surface-container-lowest p-sm text-body-md font-normal outline-none focus:border-primary" /></label>
                  <div className="flex justify-end gap-sm">
                    <button type="button" disabled={saving || archived} onClick={() => setDecision('REJECTED')} className="rounded-md border border-outline-variant px-md py-sm text-label-md font-semibold text-on-surface disabled:opacity-50">Reject</button>
                    <button type="button" disabled={saving || archived} onClick={() => setDecision('CONFIRMED')} className="rounded-md bg-primary px-md py-sm text-label-md font-semibold text-on-primary hover:bg-primary-container disabled:opacity-50">Confirm & create issue</button>
                  </div>
                </> : <div className="text-body-md text-on-surface-variant">
                  <p>{statusLabel[row.status]} by {row.reviewer?.full_name || (row.reviewed_by ? 'a project reviewer' : 'a former project member')}{row.reviewed_at ? ` · ${new Date(row.reviewed_at).toLocaleString()}` : ''}</p>
                  {row.review_note && <p className="mt-xs whitespace-pre-wrap break-words">{row.review_note}</p>}
                  {row.issue_id && <Link to={`/issues/${row.issue_id}`} className="mt-sm inline-block font-semibold text-primary underline">View linked issue</Link>}
                  {row.status === 'CONFIRMED' && !row.issue_id && <p className="mt-xs">The linked issue has been deleted. This finding remains confirmed.</p>}
                </div>}
              </div>}
            </article>
          ))}</div>}
          {(page > 0 || hasMore) && <div className="mt-md flex items-center justify-end gap-md text-body-md text-on-surface-variant"><button type="button" disabled={page === 0 || loading || saving} onClick={() => selectPage(page - 1)} className="disabled:opacity-40">Previous</button><span>Page {page + 1}</span><button type="button" disabled={!hasMore || loading || saving} onClick={() => selectPage(page + 1)} className="disabled:opacity-40">Next</button></div>}
        </main>
      </div>
      <ConfirmModal open={!!finding && !!decision} onClose={() => { if (!saving) setDecision(null) }} onConfirm={review} isLoading={saving} variant={decision === 'CONFIRMED' ? 'primary' : 'warning'} title={decision === 'CONFIRMED' ? 'Create official issue?' : 'Reject finding?'} description={decision === 'CONFIRMED' ? 'This creates one OPEN issue with you as its reporter and QA verifier. Check the finding and evidence before confirming.' : 'This closes the finding without creating an issue.'} confirmLabel={decision === 'CONFIRMED' ? 'Confirm & create issue' : 'Reject finding'} />
    </div>
  )
}
