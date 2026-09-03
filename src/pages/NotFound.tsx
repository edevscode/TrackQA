import { HelpCircle, LayoutGrid, Plug, Puzzle } from 'lucide-react'
import { Link } from 'react-router-dom'

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-inverse-surface px-md py-xl">
      <div className="flex w-full max-w-[480px] flex-col items-center rounded-lg bg-surface-container-lowest px-xl py-xl shadow-raised">
        <div className="relative mb-md flex h-20 w-20 items-center justify-center">
          <Puzzle className="text-primary" size={64} strokeWidth={1.5} />
          <Plug
            className="absolute -bottom-1 -right-1 rotate-45 text-primary"
            size={28}
            strokeWidth={2}
          />
        </div>
        <h2 className="text-headline-lg font-bold text-on-surface">
          404 Not Found
        </h2>
        <p className="mt-xs text-body-md font-semibold text-on-surface-variant">
          TrackQA
        </p>
        <p className="mt-sm text-center text-body-md text-on-surface-variant">
          Oops! The page you are looking for cannot be found. It seems like
          we're missing a piece or the connection is broken.
        </p>
      </div>

      <h1 className="mt-xl text-center text-headline-xl font-bold text-inverse-primary">
        404 - Page Not Found
      </h1>
      <p className="mt-sm max-w-[520px] text-center text-body-lg text-inverse-on-surface/70">
        We couldn't find the page you're looking for. It might have been
        moved, deleted, or perhaps the URL was mistyped.
      </p>

      <div className="mt-lg flex gap-md">
        <Link
          to="/dashboard"
          className="flex items-center gap-xs rounded-md bg-primary px-md py-sm text-body-md font-semibold text-on-primary shadow-raised hover:bg-primary-container"
        >
          <LayoutGrid size={18} />
          Back to Dashboard
        </Link>
        <a
          href="#"
          className="flex items-center gap-xs rounded-md bg-surface-container-lowest px-md py-sm text-body-md font-semibold text-on-surface hover:bg-surface-container-low"
        >
          <HelpCircle size={18} />
          Visit Support
        </a>
      </div>
    </div>
  )
}

export default NotFound
