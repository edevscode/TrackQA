import {
  AlertCircle,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUp,
  ChevronUp,
  CircleCheck,
  Clock,
  Code2,
  Equal,
  FileText,
  FlaskConical,
  MessageSquare,
  Paperclip,
  Pencil,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ConfirmModal from '../components/ConfirmModal'
import ImagePreviewModal, { type PreviewImage } from '../components/ImagePreviewModal'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import { invalidateProjectCache } from '../lib/cache'
import { MAX_UPLOAD_BYTES, uploadToCloudinary } from '../lib/cloudinary'
import { supabase } from '../lib/supabase'
import type {
  ActivityAction,
  Issue,
  IssueAttachment,
  IssuePriority,
  IssueStatus,
  Project,
  ProjectRole,
  QaVerification,
  QaVerificationAttachment,
} from '../lib/database.types'

const workflowSteps: { status: IssueStatus; label: string; stepNumber: string }[] = [
  { status: 'OPEN', label: 'Open', stepNumber: '01' },
  { status: 'IN_PROGRESS', label: 'In Dev', stepNumber: '02' },
  { status: 'FOR_TESTING', label: 'For QA', stepNumber: '03' },
  { status: 'PASSED', label: 'Verified', stepNumber: '04' },
  { status: 'DONE', label: 'Closed', stepNumber: '05' },
]

const priorityConfig: Record<
  IssuePriority,
  { label: string; icon: typeof ChevronsUp; badgeClass: string; iconClass: string }
> = {
  CRITICAL: {
    label: 'Critical',
    icon: ChevronsUp,
    badgeClass: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
    iconClass: 'text-rose-600',
  },
  HIGH: {
    label: 'High',
    icon: ChevronUp,
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    iconClass: 'text-amber-600',
  },
  MEDIUM: {
    label: 'Medium',
    icon: Equal,
    badgeClass: 'border-outline-variant bg-surface-container-low text-on-surface-variant',
    iconClass: 'text-outline',
  },
  LOW: {
    label: 'Low',
    icon: ChevronDown,
    badgeClass: 'border-outline-variant bg-surface-container-low text-on-surface-variant',
    iconClass: 'text-outline',
  },
}

const statusConfig: Record<
  IssueStatus,
  { label: string; dotClass: string; badgeClass: string }
> = {
  OPEN: {
    label: 'Open',
    dotClass: 'bg-outline',
    badgeClass: 'border-outline-variant bg-surface-container-low text-on-surface-variant',
  },
  IN_PROGRESS: {
    label: 'In Progress',
    dotClass: 'bg-primary',
    badgeClass: 'border-primary/30 bg-primary-fixed/30 text-primary',
  },
  FOR_TESTING: {
    label: 'For Testing',
    dotClass: 'bg-amber-500 animate-pulse',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  PASSED: {
    label: 'QA Passed',
    dotClass: 'bg-emerald-500',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  FAILED: {
    label: 'QA Failed',
    dotClass: 'bg-rose-500',
    badgeClass: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
  },
  DONE: {
    label: 'Closed',
    dotClass: 'bg-slate-400',
    badgeClass: 'border-outline-variant bg-surface-container-low text-on-surface-variant',
  },
}

const activityText: Partial<Record<ActivityAction, (a: TimelineActivity) => string>> = {
  CREATED: () => 'created this issue',
  ASSIGNED: () => 'assigned this issue',
  REASSIGNED: () => 'reassigned this issue',
  PRIORITY_CHANGED: (a) => `changed priority from ${a.from_value} to ${a.to_value}`,
  STATUS_CHANGED: (a) => `changed status to ${a.to_value}`,
  SUBMITTED_FOR_TESTING: () => 'submitted this issue for QA verification',
  QA_PASSED: () => 'marked QA as PASSED',
  QA_FAILED: () => 'marked QA as FAILED',
  MARKED_DONE: () => 'closed this issue as DONE',
}

type Member = {
  user_id: string
  full_name: string | null
  avatar_url?: string | null
  role: ProjectRole
}

type TimelineActivity = {
  id: string
  action: ActivityAction
  from_value: string | null
  to_value: string | null
  created_at: string
  actor: { full_name: string | null } | null
}

type TimelineComment = {
  id: string
  content: string
  created_at: string
  author: { full_name: string | null; avatar_url: string | null } | null
}

type AttachmentRow = IssueAttachment & {
  uploader: { full_name: string | null } | null
}

function isImageAttachment(mimeType: string | null, fileName?: string | null) {
  if (mimeType && mimeType.startsWith('image/')) return true
  if (fileName) {
    return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(fileName)
  }
  return false
}

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function IssueDetail() {
  const { issueId } = useParams<{ issueId: string }>()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { currentProject, setCurrentProjectId } = useProject()

  const [issue, setIssue] = useState<Issue | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [reporter, setReporter] = useState<{
    full_name: string | null
    avatar_url: string | null
  } | null>(null)
  const [latestFailure, setLatestFailure] = useState<QaVerification | null>(null)
  const [latestFailureAttachments, setLatestFailureAttachments] = useState<
    QaVerificationAttachment[]
  >([])
  const [members, setMembers] = useState<Member[]>([])
  const [comments, setComments] = useState<TimelineComment[]>([])
  const [activity, setActivity] = useState<TimelineActivity[]>([])
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null)

  const [comment, setComment] = useState('')
  const [postingComment, setPostingComment] = useState(false)
  const [verification, setVerification] = useState('')
  const [verifying, setVerifying] = useState(false)
  const verificationFileInputRef = useRef<HTMLInputElement>(null)
  const [verificationFiles, setVerificationFiles] = useState<File[]>([])
  const [verificationFileError, setVerificationFileError] = useState<string | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)

  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editPriority, setEditPriority] = useState<IssuePriority>('MEDIUM')
  const [editAssigneeId, setEditAssigneeId] = useState<string>('')
  const [editDescription, setEditDescription] = useState('')
  const [editExpectedResult, setEditExpectedResult] = useState('')
  const [editActualResult, setEditActualResult] = useState('')
  const [editStepsToReproduce, setEditStepsToReproduce] = useState('')
  const [editDevice, setEditDevice] = useState('')
  const [editBrowser, setEditBrowser] = useState('')
  const [editAppVersion, setEditAppVersion] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [confirmModal, setConfirmModal] = useState<{
    open: boolean
    title: string
    description: ReactNode
    confirmLabel: string
    variant: 'danger' | 'warning' | 'primary'
    icon?: ReactNode
    isLoading?: boolean
    onConfirm: () => void | Promise<void>
  }>({
    open: false,
    title: '',
    description: '',
    confirmLabel: 'Confirm',
    variant: 'danger',
    onConfirm: () => {},
  })

  const load = useCallback(async () => {
    if (!issueId) return
    setLoading(true)

    const { data: issueData, error: issueError } = await supabase
      .from('issues')
      .select('*, project:projects(*), reporter:profiles!issues_reporter_id_fkey(full_name, avatar_url)')
      .eq('id', issueId)
      .single()

    if (issueError || !issueData) {
      setNotFound(true)
      setLoading(false)
      return
    }

    const { reporter: reporterProfile, project: projectData, ...issueRow } =
      issueData as unknown as Issue & {
        project: Project | null
        reporter: { full_name: string | null; avatar_url: string | null } | null
      }

    setIssue(issueRow)
    setProject(projectData)
    setReporter(reporterProfile)

    if (projectData && localStorage.getItem('trackqa:currentProjectId') !== projectData.id) {
      setCurrentProjectId(projectData.id)
    }

    const [commentsRes, activityRes, attachmentsRes] = await Promise.all([
      supabase
        .from('issue_comments')
        .select(
          'id, content, created_at, author:profiles!issue_comments_author_id_fkey(full_name, avatar_url)',
        )
        .eq('issue_id', issueId)
        .order('created_at', { ascending: true }),
      supabase
        .from('issue_activity')
        .select('id, action, from_value, to_value, created_at, actor:profiles!issue_activity_actor_id_fkey(full_name)')
        .eq('issue_id', issueId)
        .neq('action', 'COMMENT_ADDED')
        .order('created_at', { ascending: true }),
      supabase
        .from('issue_attachments')
        .select('*, uploader:profiles!issue_attachments_uploaded_by_fkey(full_name)')
        .eq('issue_id', issueId)
        .order('created_at', { ascending: false }),
    ])
    setComments((commentsRes.data as unknown as TimelineComment[]) ?? [])
    setActivity((activityRes.data as unknown as TimelineActivity[]) ?? [])
    setAttachments((attachmentsRes.data as unknown as AttachmentRow[]) ?? [])

    if (issueRow.status === 'FAILED') {
      const { data: failureData } = await supabase
        .from('qa_verifications')
        .select('*')
        .eq('issue_id', issueId)
        .eq('result', 'FAILED')
        .order('verified_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setLatestFailure(failureData)

      if (failureData) {
        const { data: evidenceData } = await supabase
          .from('qa_verification_attachments')
          .select('*')
          .eq('qa_verification_id', failureData.id)
          .order('created_at', { ascending: true })
        setLatestFailureAttachments(evidenceData ?? [])
      } else {
        setLatestFailureAttachments([])
      }
    } else {
      setLatestFailure(null)
      setLatestFailureAttachments([])
    }

    setLoading(false)
  }, [issueId, setCurrentProjectId])

  useEffect(() => {
    load()
  }, [load])

  useRealtimeSync({
    projectId: issue?.project_id || project?.id || currentProject?.id,
    userId: user?.id,
    issueId: issueId,
    onRefresh: () => load(),
  })

  useEffect(() => {
    const projectId = issue?.project_id || project?.id || currentProject?.id
    if (!projectId) return
    supabase
      .from('project_members')
      .select('user_id, role, profiles(full_name, avatar_url)')
      .eq('project_id', projectId)
      .then(({ data }) => {
        setMembers(
          (data ?? []).map((m) => {
            const prof = (
              m as unknown as {
                profiles: { full_name: string | null; avatar_url: string | null } | null
              }
            ).profiles
            return {
              user_id: m.user_id,
              role: m.role,
              full_name: prof?.full_name ?? null,
              avatar_url: prof?.avatar_url ?? null,
            }
          }),
        )
      })
  }, [issue?.project_id, project?.id, currentProject?.id])

  const updateStatus = async (status: IssueStatus) => {
    if (!issue) return
    setTransitioning(true)
    setActionError(null)
    const { error } = await supabase.from('issues').update({ status }).eq('id', issue.id)
    setTransitioning(false)
    if (error) {
      setActionError(error.message)
      return
    }
    invalidateProjectCache(issue.project_id)
    load()
  }

  const addVerificationFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const incoming = Array.from(fileList)
    const oversized = incoming.some((f) => f.size > MAX_UPLOAD_BYTES)
    setVerificationFileError(
      oversized ? 'Some files exceed the 50MB limit and were skipped.' : null,
    )
    setVerificationFiles((prev) => [...prev, ...incoming.filter((f) => f.size <= MAX_UPLOAD_BYTES)])
  }

  const handleVerificationFilesSelected = (e: ChangeEvent<HTMLInputElement>) => {
    addVerificationFiles(e.target.files)
    e.target.value = ''
  }

  const removeVerificationFile = (index: number) => {
    setVerificationFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleQaVerify = async (result: 'PASSED' | 'FAILED') => {
    if (!issue || !user) return
    setVerifying(true)
    setActionError(null)
    const { data: verificationId, error } = await supabase.rpc('qa_verify_issue', {
      p_issue_id: issue.id,
      p_result: result,
      p_comment: result === 'PASSED' ? verification || null : null,
      p_failure_reason: result === 'FAILED' ? verification || null : null,
    })
    if (error || !verificationId) {
      setVerifying(false)
      setActionError(error?.message ?? 'Failed to record verification')
      return
    }

    for (const file of verificationFiles) {
      try {
        const uploadResult = await uploadToCloudinary(file, `trackqa/qa/${verificationId}`)
        await supabase.from('qa_verification_attachments').insert({
          qa_verification_id: verificationId,
          uploaded_by: user.id,
          storage_path: uploadResult.url,
          file_name: file.name,
          mime_type: file.type || null,
          file_size_bytes: uploadResult.bytes,
        })
      } catch {
        // Verification was already recorded
      }
    }

    setVerifying(false)
    setVerification('')
    setVerificationFiles([])
    invalidateProjectCache(issue.project_id)
    load()
  }

  const handlePostComment = async (e: FormEvent) => {
    e.preventDefault()
    if (!issue || !user || !comment.trim()) return
    setPostingComment(true)
    const { error } = await supabase.from('issue_comments').insert({
      issue_id: issue.id,
      author_id: user.id,
      content: comment.trim(),
    })
    setPostingComment(false)
    if (!error) {
      setComment('')
      load()
    }
  }

  const openEditModal = () => {
    if (!issue) return
    setEditTitle(issue.title)
    setEditPriority(issue.priority)
    setEditAssigneeId(issue.assignee_id ?? '')
    setEditDescription(issue.description ?? '')
    setEditExpectedResult(issue.expected_result ?? '')
    setEditActualResult(issue.actual_result ?? '')
    setEditStepsToReproduce(issue.steps_to_reproduce ?? '')
    setEditDevice(issue.environment_device ?? '')
    setEditBrowser(issue.environment_browser ?? '')
    setEditAppVersion(issue.environment_app_version ?? '')
    setEditError(null)
    setEditModalOpen(true)
  }

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!issue || !editTitle.trim()) return
    setSavingEdit(true)
    setEditError(null)

    const { error } = await supabase
      .from('issues')
      .update({
        title: editTitle.trim(),
        priority: editPriority,
        assignee_id: editAssigneeId || null,
        description: editDescription.trim() || null,
        expected_result: editExpectedResult.trim() || null,
        actual_result: editActualResult.trim() || null,
        steps_to_reproduce: editStepsToReproduce.trim() || null,
        environment_device: editDevice.trim() || null,
        environment_browser: editBrowser.trim() || null,
        environment_app_version: editAppVersion.trim() || null,
      })
      .eq('id', issue.id)

    setSavingEdit(false)
    if (error) {
      setEditError(error.message)
    } else {
      setEditModalOpen(false)
      invalidateProjectCache(issue.project_id)
      load()
    }
  }

  const handleUploadAttachment = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (attachmentInputRef.current) attachmentInputRef.current.value = ''
    if (!file || !issue || !user) return

    setUploadingAttachment(true)
    setAttachmentError(null)
    try {
      const result = await uploadToCloudinary(file, `trackqa/issues/${issue.id}`)
      const { error } = await supabase.from('issue_attachments').insert({
        issue_id: issue.id,
        uploaded_by: user.id,
        storage_path: result.url,
        file_name: file.name,
        mime_type: file.type || null,
        file_size_bytes: result.bytes,
      })
      if (error) throw error
      load()
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingAttachment(false)
    }
  }

  const promptDeleteAttachment = (attachmentId: string, fileName: string) => {
    setConfirmModal({
      open: true,
      title: 'Delete Attachment',
      description: `Are you sure you want to delete "${fileName}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }))
        const { error } = await supabase.from('issue_attachments').delete().eq('id', attachmentId)
        setConfirmModal((prev) => ({ ...prev, open: false, isLoading: false }))
        if (error) {
          setAttachmentError(error.message)
          return
        }
        setAttachments((prev) => prev.filter((a) => a.id !== attachmentId))
      },
    })
  }

  const handleDeleteIssue = () => {
    if (!issue) return
    const projectKey = activeProject?.key ?? 'TASK'
    const issueCode = `${projectKey}-${issue.issue_number}`
    setConfirmModal({
      open: true,
      title: 'Delete Task',
      description: `Are you sure you want to delete [${issueCode}]: "${issue.title}"? All comments, attachments, and QA verification logs will be permanently deleted.`,
      confirmLabel: 'Delete Task',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }))
        const { error } = await supabase.from('issues').delete().eq('id', issue.id)
        if (error) {
          setConfirmModal((prev) => ({ ...prev, open: false, isLoading: false }))
          setActionError(error.message)
          return
        }
        invalidateProjectCache(issue.project_id)
        setConfirmModal((prev) => ({ ...prev, open: false, isLoading: false }))
        navigate('/issues')
      },
    })
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-surface">
        <Sidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <TopBar />
          <main className="flex-1 p-lg flex items-center justify-center">
            <div className="flex items-center gap-sm text-body-md text-on-surface-variant font-mono">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Loading ticket record…
            </div>
          </main>
        </div>
      </div>
    )
  }

  if (notFound || !issue) {
    return (
      <div className="flex min-h-screen bg-surface">
        <Sidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <TopBar />
          <main className="flex-1 p-lg">
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-xl text-center">
              <AlertCircle size={32} className="mx-auto mb-sm text-error" />
              <h2 className="text-headline-md font-bold text-on-surface">Issue Not Found</h2>
              <p className="mt-xs text-body-md text-on-surface-variant">
                This issue does not exist in this project or you do not have permission to view it.
              </p>
              <div className="mt-md">
                <Link
                  to="/issues"
                  className="inline-flex items-center gap-xs rounded-md bg-primary px-md py-sm text-body-md font-semibold text-on-primary hover:bg-primary-container transition-colors"
                >
                  Return to Backlog
                </Link>
              </div>
            </div>
          </main>
        </div>
      </div>
    )
  }

  const activeProject = project || currentProject
  const isOwner = activeProject?.owner_id === user?.id
  const myRole = members.find((m) => m.user_id === user?.id)?.role
  const assigneeMember = members.find((m) => m.user_id === issue.assignee_id)
  const isAssignee = issue.assignee_id === user?.id
  const canDev = isAssignee && (isOwner || myRole === 'DEVELOPER')
  const isDone = issue.status === 'DONE'
  const isReporter = issue.reporter_id === user?.id
  // QA verification is reserved for the reporter alone — not the owner, not
  // QA-role members, no one else. Only the person who filed the report can
  // record a pass/fail result on it.
  const canQa = isReporter
  const canManageIssue = !isDone && (isOwner || isReporter)
  const canDeleteIssue = isReporter || isOwner
  const canInteract =
    isOwner ||
    isReporter ||
    issue.assignee_id === user?.id ||
    (myRole === 'QA' && (issue.status === 'FOR_TESTING' || issue.status === 'FAILED'))

  const PriorityInfo = priorityConfig[issue.priority]
  const StatusInfo = statusConfig[issue.status]
  const PriorityIcon = PriorityInfo.icon
  const ticketAnchor = `[${activeProject?.key ?? 'TASK'}-${issue.issue_number}]`

  const currentStepIdx = (() => {
    switch (issue.status) {
      case 'OPEN':
        return 0
      case 'IN_PROGRESS':
        return 1
      case 'FOR_TESTING':
      case 'FAILED':
        return 2
      case 'PASSED':
        return 3
      case 'DONE':
        return 4
      default:
        return 0
    }
  })()

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />

        <main className="mx-auto w-full max-w-[1360px] flex-1 px-md py-md lg:px-lg lg:py-lg">
          {/* Breadcrumb & Navigation */}
          <div className="mb-sm flex items-center justify-between text-body-md text-on-surface-variant">
            <div className="flex items-center gap-xs">
              <Link to="/issues" className="text-body-md text-on-surface-variant hover:text-primary transition-colors">
                Backlog
              </Link>
              <ChevronRight size={14} className="text-outline" />
              <span className="font-mono text-code-xs font-bold text-on-surface">
                {ticketAnchor}
              </span>
            </div>
            <div className="flex items-center gap-xs">
              <span className="font-mono text-code-xs text-outline">ID: {issue.id.slice(0, 8)}</span>
            </div>
          </div>

          {/* Issue Header Banner */}
          <div className="mb-md flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface-container-lowest p-md lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-xs sm:gap-sm">
                <span className="rounded bg-surface-container-highest px-xs py-0.5 font-mono text-code-sm font-bold text-on-surface tracking-tight">
                  {ticketAnchor}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded border px-xs py-0.5 text-label-md font-semibold ${StatusInfo.badgeClass}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${StatusInfo.dotClass}`} />
                  {StatusInfo.label}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded border px-xs py-0.5 text-label-md font-semibold ${PriorityInfo.badgeClass}`}
                >
                  <PriorityIcon size={13} className={PriorityInfo.iconClass} />
                  {PriorityInfo.label}
                </span>
              </div>
              <h1 className="mt-xs text-headline-lg font-bold tracking-tight text-on-surface break-words">
                {issue.title}
              </h1>
            </div>

            <div className="flex shrink-0 items-center gap-xs">
              {canManageIssue && (
                <button
                  type="button"
                  onClick={openEditModal}
                  className="inline-flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-md py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors"
                >
                  <Pencil size={14} className="text-outline" />
                  <span>Edit</span>
                </button>
              )}
              {canDeleteIssue && (
                <button
                  type="button"
                  onClick={handleDeleteIssue}
                  className="inline-flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-md py-xs text-label-md font-semibold text-error hover:bg-rose-500/10 hover:border-rose-500/30 transition-colors"
                >
                  <Trash2 size={14} />
                  <span>Delete</span>
                </button>
              )}
            </div>
          </div>

          {/* Precision Lab QA Workflow Stepper */}
          <div className="mb-md overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
            <div className="grid grid-cols-2 divide-y divide-outline-variant sm:grid-cols-5 sm:divide-y-0 sm:divide-x">
              {workflowSteps.map((step, idx) => {
                const isPassed = idx < currentStepIdx
                const isCurrent = idx === currentStepIdx
                const isFailureState = step.status === 'FOR_TESTING' && issue.status === 'FAILED'

                return (
                  <div
                    key={step.status}
                    className={`flex flex-col justify-between p-sm transition-colors ${
                      isCurrent
                        ? isFailureState
                          ? 'bg-rose-500/10 text-rose-800 dark:text-rose-300'
                          : 'bg-primary-fixed/40 text-primary'
                        : isPassed
                          ? 'bg-surface-container-low text-on-surface'
                          : 'text-on-surface-variant'
                    }`}
                  >
                    <div className="flex items-center justify-between text-code-xs font-mono">
                      <span className="font-semibold text-outline">{step.stepNumber}</span>
                      {isPassed && <Check size={14} className="text-emerald-600" />}
                      {isCurrent && isFailureState && <XCircle size={14} className="text-rose-600" />}
                      {isCurrent && !isFailureState && (
                        <span className="h-2 w-2 rounded-full bg-primary animate-ping" />
                      )}
                    </div>
                    <div className="mt-xs">
                      <p
                        className={`text-label-md font-bold uppercase tracking-wider ${
                          isFailureState
                            ? 'text-rose-700 dark:text-rose-400'
                            : isCurrent
                              ? 'text-primary'
                              : 'text-on-surface'
                        }`}
                      >
                        {isFailureState ? 'QA Failed' : step.label}
                      </p>
                      <p className="font-mono text-code-xs text-on-surface-variant">
                        {isCurrent ? 'Current Stage' : isPassed ? 'Completed' : 'Pending'}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {actionError && (
            <div className="mb-md flex items-center gap-xs rounded-md border border-rose-500/30 bg-rose-500/10 p-sm text-body-md text-rose-800 dark:text-rose-300">
              <AlertCircle size={16} className="shrink-0" />
              <span>{actionError}</span>
            </div>
          )}

          {/* Workbench Split Layout */}
          <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
            {/* Primary Workbench Column (Left 2 cols) */}
            <div className="flex flex-col gap-md lg:col-span-2">
              {/* QA Verification Bench / Action Surface */}
              {issue.status === 'FOR_TESTING' && (
                <div className="rounded-lg border-2 border-primary/50 bg-surface-container-lowest p-md">
                  <div className="mb-sm flex items-center justify-between border-b border-outline-variant pb-xs">
                    <div className="flex items-center gap-xs">
                      <FlaskConical size={18} className="text-primary" />
                      <h3 className="text-body-md font-bold uppercase tracking-wider text-primary">
                        QA Verification Bench
                      </h3>
                    </div>
                    <span className="rounded bg-amber-500/10 border border-amber-500/30 px-xs py-0.5 font-mono text-code-xs font-semibold text-amber-700 dark:text-amber-400">
                      AWAITING QA VERIFICATION
                    </span>
                  </div>

                  {canQa ? (
                    <div className="space-y-sm">
                      <p className="text-body-md text-on-surface-variant">
                        Execute the reproduction steps against the deployed build. Record verification findings, attachments, and outcome.
                      </p>

                      <div>
                        <label className="mb-xs block text-label-md font-semibold text-on-surface">
                          Verification Notes & Observations
                        </label>
                        <textarea
                          value={verification}
                          onChange={(e) => setVerification(e.target.value)}
                          rows={3}
                          placeholder="e.g. Build v1.2.4 verified. Fix confirmed in Chrome 124. Steps 1-3 no longer trigger runtime exception."
                          className="w-full rounded-md border border-outline-variant bg-surface-container-low p-sm font-sans text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors"
                        />
                      </div>

                      {/* Evidence Attachment Bench */}
                      <div>
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => verificationFileInputRef.current?.click()}
                            className="inline-flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-low px-sm py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors"
                          >
                            <Paperclip size={14} className="text-outline" />
                            <span>Attach Run Evidence (Screenshots / Logs)</span>
                          </button>
                          <span className="font-mono text-code-xs text-outline">Max 50MB</span>
                        </div>
                        <input
                          ref={verificationFileInputRef}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={handleVerificationFilesSelected}
                        />

                        {verificationFileError && (
                          <p className="mt-xs text-body-md text-error">{verificationFileError}</p>
                        )}

                        {verificationFiles.length > 0 && (
                          <div className="mt-xs flex flex-wrap gap-xs">
                            {verificationFiles.map((file, i) => (
                              <div
                                key={`${file.name}-${i}`}
                                className="flex items-center gap-xs rounded border border-outline-variant bg-surface-container-low px-xs py-0.5 text-code-xs font-mono text-on-surface"
                              >
                                <FileText size={12} className="text-outline shrink-0" />
                                <span className="max-w-[160px] truncate">{file.name}</span>
                                <span className="text-outline">({formatBytes(file.size)})</span>
                                <button
                                  type="button"
                                  onClick={() => removeVerificationFile(i)}
                                  className="text-outline hover:text-error"
                                  title="Remove"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Decisive Pass / Fail Workbench Controls */}
                      <div className="pt-xs flex flex-col sm:flex-row gap-sm">
                        <button
                          type="button"
                          disabled={verifying}
                          onClick={() => handleQaVerify('PASSED')}
                          className="flex flex-1 items-center justify-center gap-xs rounded-md bg-emerald-600 px-md py-sm text-label-md font-bold uppercase tracking-wider text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                        >
                          <CircleCheck size={16} />
                          <span>{verifying ? 'Recording…' : 'Pass Verification'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={verifying}
                          onClick={() => handleQaVerify('FAILED')}
                          className="flex flex-1 items-center justify-center gap-xs rounded-md bg-error px-md py-sm text-label-md font-bold uppercase tracking-wider text-on-error hover:bg-rose-700 transition-colors disabled:opacity-50"
                        >
                          <XCircle size={16} />
                          <span>{verifying ? 'Recording…' : 'Fail Verification'}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-sm text-body-md text-on-surface-variant">
                      <Clock size={18} className="text-amber-600 shrink-0" />
                      <span>
                        This ticket is submitted for QA verification. Only the reporter who filed this issue can verify and record pass/fail results.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* QA FAILED Alert Banner */}
              {issue.status === 'FAILED' && (
                <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-md">
                  <div className="mb-xs flex items-center justify-between">
                    <div className="flex items-center gap-xs text-rose-800 dark:text-rose-300">
                      <XCircle size={18} />
                      <h3 className="text-body-md font-bold uppercase tracking-wider">
                        QA Verification Failed
                      </h3>
                    </div>
                    {latestFailure && (
                      <span className="font-mono text-code-xs text-rose-700 dark:text-rose-400">
                        {new Date(latestFailure.verified_at).toLocaleString()}
                      </span>
                    )}
                  </div>

                  {latestFailure?.failure_reason ? (
                    <div className="mt-xs rounded border border-rose-500/30 bg-surface-container-lowest p-sm text-body-md text-on-surface">
                      <p className="font-mono text-code-xs font-bold text-rose-700 dark:text-rose-400 mb-xs">
                        FAILURE ANALYSIS / TEST LOG:
                      </p>
                      <p className="whitespace-pre-line">{latestFailure.failure_reason}</p>
                    </div>
                  ) : (
                    <p className="text-body-md text-rose-800 dark:text-rose-300">
                      QA flagged this fix as failed. Review attached evidence and resume development.
                    </p>
                  )}

                  {latestFailureAttachments.length > 0 && (
                    <div className="mt-sm">
                      <p className="mb-xs font-mono text-code-xs font-semibold text-rose-800 dark:text-rose-300">
                        ATTACHED FAILURE EVIDENCE ({latestFailureAttachments.length}):
                      </p>
                      <div className="flex flex-wrap gap-xs">
                        {latestFailureAttachments.map((a) =>
                          isImageAttachment(a.mime_type, a.file_name) ? (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() =>
                                setPreviewImage({
                                  url: a.storage_path,
                                  title: a.file_name,
                                  size: formatBytes(a.file_size_bytes),
                                })
                              }
                              className="group relative block overflow-hidden rounded border border-rose-500/30 bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer text-left"
                              title="Click to preview image"
                            >
                              <img
                                src={a.storage_path}
                                alt={a.file_name}
                                className="h-16 w-24 object-cover group-hover:scale-105 transition-transform"
                              />
                            </button>
                          ) : (
                            <a
                              key={a.id}
                              href={a.storage_path}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-xs rounded border border-rose-500/30 bg-surface-container-lowest px-sm py-xs font-mono text-code-xs text-on-surface hover:underline"
                            >
                              <FileText size={14} className="text-rose-600" />
                              <span className="truncate max-w-[140px]">{a.file_name}</span>
                            </a>
                          ),
                        )}
                      </div>
                    </div>
                  )}

                  {canDev && (
                    <div className="mt-sm pt-xs border-t border-rose-500/20 flex justify-end">
                      <button
                        type="button"
                        disabled={transitioning}
                        onClick={() => updateStatus('IN_PROGRESS')}
                        className="inline-flex items-center gap-xs rounded-md bg-primary px-md py-xs text-label-md font-semibold text-on-primary hover:bg-primary-container transition-colors disabled:opacity-50"
                      >
                        <RotateCcw size={14} />
                        <span>Resume Development</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* QA PASSED Banner */}
              {issue.status === 'PASSED' && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-sm">
                  <div>
                    <div className="flex items-center gap-xs text-emerald-800 dark:text-emerald-300">
                      <CircleCheck size={18} />
                      <h3 className="text-body-md font-bold uppercase tracking-wider">
                        QA Verification Passed
                      </h3>
                    </div>
                    <p className="mt-xs text-body-md text-emerald-900 dark:text-emerald-200">
                      All test criteria verified successfully. Ready for final closure by project owner.
                    </p>
                  </div>
                  {isOwner && (
                    <button
                      type="button"
                      disabled={transitioning}
                      onClick={() => updateStatus('DONE')}
                      className="inline-flex shrink-0 items-center justify-center gap-xs rounded-md bg-emerald-700 px-md py-xs text-label-md font-bold uppercase tracking-wider text-white hover:bg-emerald-800 transition-colors disabled:opacity-50"
                    >
                      <Check size={16} />
                      <span>Close Ticket (Done)</span>
                    </button>
                  )}
                </div>
              )}

              {/* Developer Start Progress Banner */}
              {issue.status === 'OPEN' && (
                <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-sm">
                  <div>
                    <p className="text-body-md font-medium text-on-surface">
                      Status: <span className="font-mono font-semibold">OPEN (TRIAGE)</span>
                    </p>
                    <p className="text-body-md text-on-surface-variant">
                      {isAssignee
                        ? 'This defect is assigned to you. Move to development once active work commences.'
                        : assigneeMember
                          ? `Assigned to ${assigneeMember.full_name ?? 'developer'}. Waiting for work to start.`
                          : 'Unassigned defect. Assign an operator to begin resolution.'}
                    </p>
                  </div>
                  {canDev && (
                    <button
                      type="button"
                      disabled={transitioning}
                      onClick={() => updateStatus('IN_PROGRESS')}
                      className="inline-flex shrink-0 items-center justify-center gap-xs rounded-md bg-primary px-md py-xs text-label-md font-semibold text-on-primary hover:bg-primary-container transition-colors disabled:opacity-50"
                    >
                      <Code2 size={16} />
                      <span>Start Development</span>
                    </button>
                  )}
                </div>
              )}

              {/* In Progress Submit for QA Banner */}
              {issue.status === 'IN_PROGRESS' && (
                <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-sm">
                  <div>
                    <p className="text-body-md font-medium text-on-surface">
                      Status: <span className="font-mono font-semibold text-primary">IN DEVELOPMENT</span>
                    </p>
                    <p className="text-body-md text-on-surface-variant">
                      {isAssignee
                        ? 'Active development in progress. Once code is deployed to the test target, submit for QA.'
                        : `Work in progress by ${assigneeMember?.full_name ?? 'the assigned developer'}.`}
                    </p>
                  </div>
                  {canDev && (
                    <button
                      type="button"
                      disabled={transitioning}
                      onClick={() => updateStatus('FOR_TESTING')}
                      className="inline-flex shrink-0 items-center justify-center gap-xs rounded-md bg-primary px-md py-xs text-label-md font-semibold text-on-primary hover:bg-primary-container transition-colors disabled:opacity-50"
                    >
                      <FlaskConical size={16} />
                      <span>Submit for Testing</span>
                    </button>
                  )}
                </div>
              )}

              {/* Closed State Banner */}
              {issue.status === 'DONE' && (
                <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md flex items-center gap-sm">
                  <CircleCheck size={20} className="text-emerald-600 shrink-0" />
                  <div>
                    <p className="text-body-md font-semibold text-on-surface">Defect Closed and Resolved</p>
                    <p className="font-mono text-code-xs text-on-surface-variant">
                      All verification stages satisfied. Defect resolved.
                    </p>
                  </div>
                </div>
              )}

              {/* Defect Description Panel */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
                <div className="mb-xs flex items-center justify-between border-b border-outline-variant pb-xs">
                  <h2 className="text-body-md font-bold uppercase tracking-wider text-on-surface">
                    Defect Description
                  </h2>
                  <span className="font-mono text-code-xs text-outline">PRIMARY SPEC</span>
                </div>
                <div className="pt-xs text-body-md leading-relaxed text-on-surface whitespace-pre-line">
                  {issue.description || (
                    <span className="text-on-surface-variant italic">No description provided.</span>
                  )}
                </div>
              </div>

              {/* Steps to Reproduce */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
                <div className="mb-xs flex items-center justify-between border-b border-outline-variant pb-xs">
                  <h2 className="text-body-md font-bold uppercase tracking-wider text-on-surface">
                    Steps to Reproduce
                  </h2>
                  <span className="font-mono text-code-xs text-outline">EXECUTION STEPS</span>
                </div>
                {issue.steps_to_reproduce ? (
                  <div className="mt-xs rounded-md border border-outline-variant bg-surface-container-low p-sm font-mono text-code-sm leading-relaxed text-on-surface whitespace-pre-line">
                    {issue.steps_to_reproduce}
                  </div>
                ) : (
                  <p className="pt-xs text-body-md text-on-surface-variant italic">
                    No discrete reproduction sequence recorded.
                  </p>
                )}
              </div>

              {/* Expected vs. Actual Outcomes Matrix */}
              <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
                <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
                  <div className="mb-xs flex items-center justify-between border-b border-outline-variant pb-xs">
                    <span className="text-label-md font-bold uppercase tracking-wider text-on-surface">
                      Expected Outcome
                    </span>
                    <span className="rounded bg-emerald-500/10 px-1 py-0.2 font-mono text-code-xs text-emerald-700 dark:text-emerald-400">
                      TARGET
                    </span>
                  </div>
                  <div className="pt-xs text-body-md text-on-surface">
                    {issue.expected_result || (
                      <span className="text-on-surface-variant italic">Not documented</span>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
                  <div className="mb-xs flex items-center justify-between border-b border-outline-variant pb-xs">
                    <span className="text-label-md font-bold uppercase tracking-wider text-on-surface">
                      Actual Observed Failure
                    </span>
                    <span className="rounded bg-rose-500/10 px-1 py-0.2 font-mono text-code-xs text-rose-700 dark:text-rose-400">
                      ANOMALY
                    </span>
                  </div>
                  <div className="pt-xs text-body-md text-on-surface">
                    {issue.actual_result || (
                      <span className="text-on-surface-variant italic">Not documented</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Environment Manifest Inspector */}
              {(issue.environment_device ||
                issue.environment_browser ||
                issue.environment_app_version) && (
                <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
                  <div className="mb-xs flex items-center justify-between border-b border-outline-variant pb-xs">
                    <h2 className="text-body-md font-bold uppercase tracking-wider text-on-surface">
                      Environment Manifest
                    </h2>
                    <span className="font-mono text-code-xs text-outline">TARGET RUNTIME</span>
                  </div>
                  <div className="pt-xs grid grid-cols-1 gap-xs sm:grid-cols-3">
                    <div className="rounded border border-outline-variant bg-surface-container-low p-sm">
                      <span className="block font-mono text-code-xs uppercase text-on-surface-variant">
                        Device / OS
                      </span>
                      <span className="font-mono text-code-sm font-semibold text-on-surface">
                        {issue.environment_device || '—'}
                      </span>
                    </div>
                    <div className="rounded border border-outline-variant bg-surface-container-low p-sm">
                      <span className="block font-mono text-code-xs uppercase text-on-surface-variant">
                        Browser Engine
                      </span>
                      <span className="font-mono text-code-sm font-semibold text-on-surface">
                        {issue.environment_browser || '—'}
                      </span>
                    </div>
                    <div className="rounded border border-outline-variant bg-surface-container-low p-sm">
                      <span className="block font-mono text-code-xs uppercase text-on-surface-variant">
                        Build / Version
                      </span>
                      <span className="font-mono text-code-sm font-semibold text-on-surface">
                        {issue.environment_app_version || '—'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Attachments Bench */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
                <div className="mb-xs flex items-center justify-between border-b border-outline-variant pb-xs">
                  <div className="flex items-center gap-xs">
                    <Paperclip size={16} className="text-outline" />
                    <h2 className="text-body-md font-bold uppercase tracking-wider text-on-surface">
                      Evidence & Artifacts
                    </h2>
                  </div>
                  <div className="flex items-center gap-sm">
                    <span className="font-mono text-code-xs text-outline">
                      {attachments.length} {attachments.length === 1 ? 'FILE' : 'FILES'}
                    </span>
                    <button
                      type="button"
                      disabled={uploadingAttachment}
                      onClick={() => attachmentInputRef.current?.click()}
                      className="inline-flex items-center gap-xs rounded border border-outline-variant bg-surface-container-low px-xs py-0.5 font-mono text-code-xs font-semibold text-on-surface hover:bg-surface-container transition-colors disabled:opacity-50"
                    >
                      <UploadCloud size={12} />
                      <span>{uploadingAttachment ? 'UPLOADING…' : 'UPLOAD'}</span>
                    </button>
                    <input
                      ref={attachmentInputRef}
                      type="file"
                      className="hidden"
                      onChange={handleUploadAttachment}
                    />
                  </div>
                </div>

                {attachmentError && (
                  <p className="my-xs text-body-md text-error">{attachmentError}</p>
                )}

                {attachments.length === 0 ? (
                  <p className="pt-xs text-body-md text-on-surface-variant italic">
                    No attachments uploaded for this ticket.
                  </p>
                ) : (
                  <div className="pt-xs grid grid-cols-1 gap-xs sm:grid-cols-2">
                    {attachments.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between gap-xs rounded-md border border-outline-variant bg-surface-container-low p-xs hover:bg-surface-container transition-colors"
                      >
                        <div className="flex min-w-0 items-center gap-xs">
                          {isImageAttachment(a.mime_type, a.file_name) ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewImage({
                                  url: a.storage_path,
                                  title: a.file_name,
                                  size: formatBytes(a.file_size_bytes),
                                  uploader: a.uploader?.full_name ?? undefined,
                                })
                              }
                              className="group shrink-0 overflow-hidden rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
                              title="Click to preview image"
                            >
                              <img
                                src={a.storage_path}
                                alt={a.file_name}
                                className="h-9 w-9 object-cover group-hover:scale-110 transition-transform"
                              />
                            </button>
                          ) : (
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-outline-variant bg-surface-container text-on-surface-variant">
                              <FileText size={16} />
                            </div>
                          )}
                          <div className="min-w-0">
                            {isImageAttachment(a.mime_type, a.file_name) ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setPreviewImage({
                                    url: a.storage_path,
                                    title: a.file_name,
                                    size: formatBytes(a.file_size_bytes),
                                    uploader: a.uploader?.full_name ?? undefined,
                                  })
                                }
                                className="block truncate font-mono text-code-xs font-semibold text-on-surface hover:text-primary transition-colors text-left cursor-pointer"
                                title="Click to preview image"
                              >
                                {a.file_name}
                              </button>
                            ) : (
                              <a
                                href={a.storage_path}
                                target="_blank"
                                rel="noreferrer"
                                className="block truncate font-mono text-code-xs font-semibold text-on-surface hover:text-primary transition-colors"
                              >
                                {a.file_name}
                              </a>
                            )}
                            <p className="font-mono text-code-xs text-outline">
                              {formatBytes(a.file_size_bytes)} {a.uploader?.full_name ? `· ${a.uploader.full_name}` : ''}
                            </p>
                          </div>
                        </div>

                        {canManageIssue && (
                          <button
                            type="button"
                            onClick={() => promptDeleteAttachment(a.id, a.file_name)}
                            className="p-xs text-outline hover:text-error transition-colors"
                            title="Delete file"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Activity & Comments Timeline */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
                <div className="mb-md flex items-center justify-between border-b border-outline-variant pb-xs">
                  <div className="flex items-center gap-xs">
                    <MessageSquare size={16} className="text-outline" />
                    <h2 className="text-body-md font-bold uppercase tracking-wider text-on-surface">
                      Activity & Discussion Timeline
                    </h2>
                  </div>
                  <span className="font-mono text-code-xs text-outline">
                    {comments.length} NOTES · {activity.length} AUDIT EVENTS
                  </span>
                </div>

                {/* Comment Entry Form */}
                {isDone ? (
                  <p className="mb-md text-body-md text-on-surface-variant font-mono text-code-xs">
                    [TICKET CLOSED] Comments and discussions are locked.
                  </p>
                ) : !canInteract ? (
                  <p className="mb-md text-body-md text-on-surface-variant">
                    Only ticket collaborators (assignee, reporter, or QA verifier) may add comments.
                  </p>
                ) : (
                  <form onSubmit={handlePostComment} className="mb-md">
                    <div className="flex gap-sm">
                      <Avatar
                        name={profile?.full_name}
                        avatarUrl={profile?.avatar_url}
                        size={32}
                        className="shrink-0"
                      />
                      <div className="flex-1">
                        <textarea
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          rows={2}
                          placeholder="Add engineering notes, test updates, or repro questions…"
                          className="w-full rounded-md border border-outline-variant bg-surface-container-low p-sm text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors"
                        />
                        <div className="mt-xs flex justify-end">
                          <button
                            type="submit"
                            disabled={postingComment || !comment.trim()}
                            className="inline-flex items-center gap-xs rounded-md bg-primary px-md py-xs text-label-md font-semibold text-on-primary hover:bg-primary-container transition-colors disabled:opacity-50"
                          >
                            <span>{postingComment ? 'Posting…' : 'Post Note'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </form>
                )}

                {/* Chronological Timeline */}
                <div className="space-y-sm">
                  {[
                    ...comments.map((c) => ({ type: 'comment' as const, at: c.created_at, data: c })),
                    ...activity.map((a) => ({ type: 'activity' as const, at: a.created_at, data: a })),
                  ]
                    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
                    .map((entry) =>
                      entry.type === 'comment' ? (
                        <div
                          key={entry.data.id}
                          className="rounded-md border border-outline-variant bg-surface-container-low p-sm"
                        >
                          <div className="mb-xs flex items-center justify-between">
                            <div className="flex items-center gap-xs">
                              <Avatar
                                name={entry.data.author?.full_name}
                                avatarUrl={entry.data.author?.avatar_url}
                                size={20}
                              />
                              <span className="text-body-md font-semibold text-on-surface">
                                {entry.data.author?.full_name ?? 'Unknown'}
                              </span>
                            </div>
                            <span className="font-mono text-code-xs text-outline">
                              {new Date(entry.data.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-body-md text-on-surface whitespace-pre-line pl-6">
                            {entry.data.content}
                          </p>
                        </div>
                      ) : (
                        <div
                          key={entry.data.id}
                          className="flex items-center justify-between rounded border border-outline-variant/60 bg-surface-container-lowest px-sm py-xs text-code-xs font-mono text-on-surface-variant"
                        >
                          <div className="flex items-center gap-xs">
                            <Code2 size={13} className="text-outline shrink-0" />
                            <span>
                              <strong className="text-on-surface">
                                {entry.data.actor?.full_name ?? 'System'}
                              </strong>{' '}
                              {activityText[entry.data.action]?.(entry.data) ?? entry.data.action}
                            </span>
                          </div>
                          <span className="text-outline shrink-0 ml-xs">
                            {new Date(entry.data.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      ),
                    )}

                  {comments.length === 0 && activity.length === 0 && (
                    <p className="text-body-md text-on-surface-variant italic">
                      No activity recorded on this issue yet.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar Meta Rail (Right 1 col) */}
            <div className="flex flex-col gap-md">
              {/* Ticket State Overview */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
                <div className="mb-sm flex items-center justify-between border-b border-outline-variant pb-xs">
                  <h2 className="text-body-md font-bold uppercase tracking-wider text-on-surface">
                    Attributes
                  </h2>
                  <span className="font-mono text-code-xs text-outline">METRICS</span>
                </div>

                <div className="space-y-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-code-xs uppercase text-on-surface-variant">
                      Status
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded border px-xs py-0.5 text-label-md font-semibold ${StatusInfo.badgeClass}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${StatusInfo.dotClass}`} />
                      {StatusInfo.label}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="font-mono text-code-xs uppercase text-on-surface-variant">
                      Priority
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-xs py-0.5 text-label-md font-semibold ${PriorityInfo.badgeClass}`}
                    >
                      <PriorityIcon size={13} className={PriorityInfo.iconClass} />
                      {PriorityInfo.label}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="font-mono text-code-xs uppercase text-on-surface-variant">
                      Type
                    </span>
                    <span className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-xs py-0.5 font-mono text-code-xs font-semibold text-rose-700 dark:text-rose-400">
                      <Bug size={13} className="text-rose-600" />
                      BUG DEFECT
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="font-mono text-code-xs uppercase text-on-surface-variant">
                      Project
                    </span>
                    <span className="font-mono text-code-xs font-bold text-on-surface">
                      {activeProject?.name ?? '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* People & Roles */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
                <div className="mb-sm flex items-center justify-between border-b border-outline-variant pb-xs">
                  <h2 className="text-body-md font-bold uppercase tracking-wider text-on-surface">
                    Personnel
                  </h2>
                  <span className="font-mono text-code-xs text-outline">ROLES</span>
                </div>

                <div className="space-y-sm">
                  <div>
                    <span className="block font-mono text-code-xs uppercase text-on-surface-variant mb-xs">
                      Assignee
                    </span>
                    {assigneeMember ? (
                      <div className="flex items-center gap-xs rounded border border-outline-variant bg-surface-container-low p-xs">
                        <Avatar
                          name={assigneeMember.full_name}
                          avatarUrl={assigneeMember.avatar_url}
                          size={24}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-body-md font-medium text-on-surface">
                            {assigneeMember.full_name ?? 'Unnamed'}
                          </p>
                          <p className="font-mono text-code-xs uppercase text-outline">
                            {assigneeMember.role}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded border border-dashed border-outline-variant p-xs text-center text-body-md text-on-surface-variant italic">
                        Unassigned
                      </div>
                    )}
                  </div>

                  <div>
                    <span className="block font-mono text-code-xs uppercase text-on-surface-variant mb-xs">
                      Reporter
                    </span>
                    <div className="flex items-center gap-xs rounded border border-outline-variant bg-surface-container-low p-xs">
                      <Avatar
                        name={reporter?.full_name}
                        avatarUrl={reporter?.avatar_url}
                        size={24}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-body-md font-medium text-on-surface">
                          {reporter?.full_name ?? 'Unknown'}
                        </p>
                        <p className="font-mono text-code-xs uppercase text-outline">
                          Originator
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Timestamps */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
                <div className="mb-sm flex items-center justify-between border-b border-outline-variant pb-xs">
                  <h2 className="text-body-md font-bold uppercase tracking-wider text-on-surface">
                    Timestamps
                  </h2>
                  <span className="font-mono text-code-xs text-outline">DATES</span>
                </div>

                <div className="space-y-xs font-mono text-code-xs">
                  <div className="flex justify-between text-on-surface-variant">
                    <span>CREATED:</span>
                    <span className="font-semibold text-on-surface">
                      {new Date(issue.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-on-surface-variant">
                    <span>UPDATED:</span>
                    <span className="font-semibold text-on-surface">
                      {new Date(issue.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-on-surface-variant">
                    <span>KEY:</span>
                    <span className="font-semibold text-primary">{ticketAnchor}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Edit Issue Modal */}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md animate-in fade-in duration-100">
          <div
            className="fixed inset-0"
            onClick={() => !savingEdit && setEditModalOpen(false)}
          />
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-[700px] flex-col rounded-lg border border-outline-variant bg-surface-container-lowest shadow-sm">
            <div className="flex items-center justify-between border-b border-outline-variant px-md py-sm">
              <div className="flex items-center gap-xs">
                <Pencil size={16} className="text-primary" />
                <h2 className="text-headline-md font-bold text-on-surface">
                  Edit Issue {ticketAnchor}
                </h2>
              </div>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => setEditModalOpen(false)}
                title="Close"
                aria-label="Close edit issue dialog"
                className="rounded p-xs text-outline hover:bg-surface-container hover:text-on-surface transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-md space-y-md">
                {editError && (
                  <p className="rounded border border-rose-500/30 bg-rose-500/10 p-sm text-body-md text-rose-800 dark:text-rose-300">
                    {editError}
                  </p>
                )}

                <div>
                  <label className="mb-xs block text-label-md font-bold text-on-surface">
                    Title <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-xs text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                    placeholder="Issue title"
                  />
                </div>

                <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
                  <div>
                    <label className="mb-xs block text-label-md font-bold text-on-surface">
                      Priority
                    </label>
                    <select
                      value={editPriority}
                      onChange={(e) => setEditPriority(e.target.value as IssuePriority)}
                      className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-xs text-body-md font-semibold text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                    >
                      {(Object.keys(priorityConfig) as IssuePriority[]).map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-xs block text-label-md font-bold text-on-surface">
                      Assignee
                    </label>
                    <select
                      value={editAssigneeId}
                      onChange={(e) => setEditAssigneeId(e.target.value)}
                      className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-xs text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                    >
                      <option value="">Unassigned</option>
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name ?? 'Unnamed'} ({m.role})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-xs block text-label-md font-bold text-on-surface">
                    Description
                  </label>
                  <textarea
                    rows={3}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-xs text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                    placeholder="Detailed explanation of the issue"
                  />
                </div>

                <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
                  <div>
                    <label className="mb-xs block text-label-md font-bold text-on-surface">
                      Expected Result
                    </label>
                    <textarea
                      rows={2}
                      value={editExpectedResult}
                      onChange={(e) => setEditExpectedResult(e.target.value)}
                      className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-xs text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                      placeholder="What should have happened"
                    />
                  </div>
                  <div>
                    <label className="mb-xs block text-label-md font-bold text-on-surface">
                      Actual Result
                    </label>
                    <textarea
                      rows={2}
                      value={editActualResult}
                      onChange={(e) => setEditActualResult(e.target.value)}
                      className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-xs text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                      placeholder="What actually happened"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-xs block text-label-md font-bold text-on-surface">
                    Steps to Reproduce
                  </label>
                  <textarea
                    rows={3}
                    value={editStepsToReproduce}
                    onChange={(e) => setEditStepsToReproduce(e.target.value)}
                    className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-xs font-mono text-code-sm text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                    placeholder="1. Go to...&#10;2. Click on...&#10;3. See error"
                  />
                </div>

                <div>
                  <label className="mb-xs block text-label-md font-bold text-on-surface">
                    Environment Manifest
                  </label>
                  <div className="grid grid-cols-1 gap-xs sm:grid-cols-3">
                    <input
                      type="text"
                      value={editDevice}
                      onChange={(e) => setEditDevice(e.target.value)}
                      className="w-full rounded border border-outline-variant bg-surface-container-low px-xs py-1 font-mono text-code-xs text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                      placeholder="Device / OS"
                    />
                    <input
                      type="text"
                      value={editBrowser}
                      onChange={(e) => setEditBrowser(e.target.value)}
                      className="w-full rounded border border-outline-variant bg-surface-container-low px-xs py-1 font-mono text-code-xs text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                      placeholder="Browser"
                    />
                    <input
                      type="text"
                      value={editAppVersion}
                      onChange={(e) => setEditAppVersion(e.target.value)}
                      className="w-full rounded border border-outline-variant bg-surface-container-low px-xs py-1 font-mono text-code-xs text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                      placeholder="App Version"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-sm border-t border-outline-variant bg-surface-container-low px-md py-sm">
                <button
                  type="button"
                  disabled={savingEdit}
                  onClick={() => setEditModalOpen(false)}
                  className="rounded-md border border-outline-variant bg-surface-container-lowest px-md py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="rounded-md bg-primary px-lg py-xs text-label-md font-semibold text-on-primary hover:bg-primary-container transition-colors disabled:opacity-50"
                >
                  {savingEdit ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmModal.open}
        onClose={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        description={confirmModal.description}
        confirmLabel={confirmModal.confirmLabel}
        variant={confirmModal.variant}
        icon={confirmModal.icon}
        isLoading={confirmModal.isLoading}
      />

      <ImagePreviewModal
        image={previewImage}
        onClose={() => setPreviewImage(null)}
      />
    </div>
  )
}

export default IssueDetail
