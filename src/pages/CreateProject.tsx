import { Bug } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return

    setSubmitting(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('create_project', {
      p_name: name,
      p_key: key,
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
    <div className="flex min-h-screen flex-col items-center bg-surface px-md py-xl">
      <div className="mb-lg flex flex-col items-center">
        <div className="mb-md flex h-16 w-16 items-center justify-center rounded-xl bg-primary">
          <Bug className="text-on-primary" size={32} />
        </div>
        <h1 className="text-headline-xl font-bold text-on-surface">
          Create your project
        </h1>
        <p className="mt-xs text-body-lg text-on-surface-variant">
          Set up a workspace to start tracking issues.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[560px] rounded-lg border border-outline-variant bg-surface-container-lowest p-xl shadow-raised"
      >
        {error && (
          <p className="mb-md rounded-md bg-error-container px-md py-sm text-body-md text-on-error-container">
            {error}
          </p>
        )}

        <div className="mb-md">
          <label
            htmlFor="name"
            className="mb-sm block text-body-md font-semibold text-on-surface"
          >
            Project Name
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Phoenix App Redesign"
            className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-lg text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="mb-md">
          <label
            htmlFor="key"
            className="mb-sm block text-body-md font-semibold text-on-surface"
          >
            Project Key (Prefix)
          </label>
          <input
            id="key"
            type="text"
            required
            minLength={2}
            maxLength={10}
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            placeholder="PHX"
            className="w-[160px] rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-lg text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
          <p className="mt-xs text-body-md text-on-surface-variant">
            Used as a prefix for all issues (e.g., {key || 'PHX'}-123). Cannot
            be changed later.
          </p>
        </div>

        <div className="mb-lg">
          <label
            htmlFor="description"
            className="mb-sm block text-body-md font-semibold text-on-surface"
          >
            Description
          </label>
          <textarea
            id="description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this project about?"
            className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-lg text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-primary py-sm text-body-lg font-semibold text-on-primary shadow-raised transition-colors hover:bg-primary-container disabled:opacity-60"
        >
          {submitting ? 'Creating…' : 'Create Project'}
        </button>
      </form>
    </div>
  )
}

export default CreateProject
