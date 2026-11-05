import { exec } from 'node:child_process'

/**
 * Open a URL in the system's default browser.
 * Fails safely without throwing unhandled exceptions.
 */
export function openBrowser(url) {
  const platform = process.platform
  let command = ''

  if (platform === 'win32') {
    // Windows: Use start with empty title to prevent URL path splitting
    command = `start "" "${url}"`
  } else if (platform === 'darwin') {
    command = `open "${url}"`
  } else {
    command = `xdg-open "${url}"`
  }

  exec(command, () => {
    // Best-effort launch
  })
}

