import { RotateCw, X } from 'lucide-react'
import { useEffect } from 'react'
import type { ReactNode } from 'react'

export type ConfirmVariant = 'danger' | 'warning' | 'primary'

export type ConfirmModalProps = {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  description: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmVariant
  icon?: ReactNode
  isLoading?: boolean
}

export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, isLoading, onClose])

  if (!open) return null

  const confirmBtnStyles = {
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    warning: 'bg-amber-600 text-white hover:bg-amber-700',
    primary: 'bg-primary text-on-primary hover:bg-primary-container',
  }[variant]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-md"
    >
      {/* Subtle Backdrop */}
      <div
        onClick={isLoading ? undefined : onClose}
        className="fixed inset-0 bg-black/30 backdrop-blur-[1px] transition-opacity"
      />

      {/* Minimal Card */}
      <div className="relative z-10 w-full max-w-[400px] rounded-lg border border-outline-variant bg-surface-container-lowest p-lg shadow-lg">
        {/* Header with Title and Close */}
        <div className="flex items-start justify-between gap-sm">
          <h2
            id="confirm-modal-title"
            className="text-headline-md font-semibold text-on-surface"
          >
            {title}
          </h2>
          <button
            type="button"
            disabled={isLoading}
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded p-xs text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface disabled:opacity-50 transition-colors -mr-xs -mt-xs"
          >
            <X size={16} />
          </button>
        </div>

        {/* Description */}
        <div className="mt-sm text-body-md text-on-surface-variant leading-relaxed">
          {description}
        </div>

        {/* Minimal Action Buttons */}
        <div className="mt-lg flex items-center justify-end gap-sm">
          <button
            type="button"
            disabled={isLoading}
            onClick={onClose}
            className="rounded-md border border-outline-variant bg-surface-container-lowest px-md py-xs text-body-md font-medium text-on-surface hover:bg-surface-container-low disabled:opacity-60 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={onConfirm}
            className={`flex items-center justify-center gap-xs rounded-md px-md py-xs text-body-md font-medium disabled:opacity-60 transition-colors ${confirmBtnStyles}`}
          >
            {isLoading && <RotateCw size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
