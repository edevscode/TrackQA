import { useEffect, useRef } from 'react'

const focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** Keep keyboard focus in a modal and restore it to the opener on close. */
export function useDialogFocus(open: boolean, onEscape?: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const onEscapeRef = useRef(onEscape)
  useEffect(() => { onEscapeRef.current = onEscape }, [onEscape])
  useEffect(() => {
    if (!open || !ref.current) return
    const dialog = ref.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const elements = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusable))
      .filter((element) => element.getClientRects().length > 0)
    const focusFirst = () => (elements()[0] ?? dialog).focus()
    focusFirst()
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onEscapeRef.current) {
        event.stopPropagation()
        onEscapeRef.current()
      }
      if (event.key !== 'Tab') return
      const items = elements()
      const first = items[0] ?? dialog
      const last = items[items.length - 1] ?? dialog
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault()
        first.focus()
      }
    }
    const containFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) focusFirst()
    }
    dialog.addEventListener('keydown', trap)
    document.addEventListener('focusin', containFocus)
    return () => {
      dialog.removeEventListener('keydown', trap)
      document.removeEventListener('focusin', containFocus)
      document.body.style.overflow = previousOverflow
      if (opener?.isConnected) opener.focus()
    }
  }, [open])
  return ref
}
