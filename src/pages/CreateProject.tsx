import { ArrowLeft, Bug } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { supabase } from '../lib/supabase'

function CreateProject() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { refreshProjects, setCurrentProjectId } = useProject()

  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const previewKey = key.trim().toUpperCase() || 'PHX'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return

    setSubmitting(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('create_project', {
      p_name: name,
      p_key: previewKey,
      p_description: description || null,
    })

    if (rpcError) {
      setError(rpcError.message)
      setSubmitting(false)
      return
    }

    await refreshProjects()
    if (data) setCurrentProjectId(data.id)
    navigate('/dashboard')
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-surface px-md py-lg sm:py-xl">
      <div className="w-full max-w-[560px]">
        {/* Back Link */}
        <Link
          to="/welcome"
          className="mb-lg inline-flex items-center gap-xs text-body-md font-semibold text-on-surface-variant hover:text-primary transition-colors"
        >
          <ArrowLeft size={16} />
          <span>Back to Projects</span>
        </Link>

        {/* Header */}
        <div className="mb-lg flex items-center gap-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-on-primary">
            <Bug size={22} />
          </div>
          <div>
            <h1 className="text-headline-xl font-bold tracking-tight text-on-surface">
              Create New Project
            </h1>
            <p className="mt-xs text-body-md text-on-surface-variant">
              Set up a testing project and define your issue identification prefix.
            </p>
          </div>
        </div>

        {/* Form Panel */}
        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-outline-variant bg-surface-container-lowest p-lg sm:p-xl"
        >
          {error && (
            <div className="mb-md rounded-md border border-error/30 bg-error-container px-md py-sm text-body-md font-medium text-on-error-container">
              {error}
            </div>
          )}

          <div className="mb-md">
            <label
              htmlFor="name"
              className="mb-xs block text-body-md font-semibold text-on-surface"
            >
              Project Name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (!key) {
                  const autoKey = e.target.value
                    .split(/\s+/)
                    .filter(Boolean)
                    .map((w) => w[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 4)
                  if (autoKey.length >= 2) {
                    setKey(autoKey)
                  }
                }
              }}
              placeholder="e.g. Apollo Engine Redesign"
              className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-lg text-on-surface outline-none placeholder:text-outline focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>

          <div className="mb-md">
            <div className="flex items-center justify-between mb-xs">
              <label
                htmlFor="key"
                className="text-body-md font-semibold text-on-surface"
              >
                Project Issue Key
              </label>
              <span className="font-mono text-code-xs text-on-surface-variant">
                Preview: <strong className="text-primary font-bold">[{previewKey}-101]</strong>
              </span>
            </div>
            <input
              id="key"
              type="text"
              required
              minLength={2}
              maxLength={10}
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="PHX"
              className="w-[180px] font-mono text-body-lg uppercase font-semibold rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-on-surface outline-none placeholder:text-outline focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
            />
            <p className="mt-xs text-label-md text-on-surface-variant">
              Identifier prefixed to all defects (e.g. <span className="font-mono">{previewKey}-1</span>, <span className="font-mono">{previewKey}-2</span>). Cannot be altered later.
            </p>
          </div>

          <div className="mb-lg">
            <label
              htmlFor="description"
              className="mb-xs block text-body-md font-semibold text-on-surface"
            >
              Description <span className="text-on-surface-variant font-normal">(Optional)</span>
            </label>
            <textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary of the scope and testing objectives..."
              className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-md text-on-surface outline-none placeholder:text-outline focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-primary py-sm text-body-md font-semibold text-on-primary hover:bg-primary-container transition-colors disabled:opacity-60"
          >
            {submitting ? 'Initializing Project…' : 'Initialize Project'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default CreateProject
