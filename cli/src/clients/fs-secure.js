import fs from 'node:fs'
import path from 'node:path'

/**
 * Write configuration file containing credentials with restricted permissions (0o600).
 * - Avoids rewriting if content is already identical (preserves mtime and file watchers).
 * - Writes atomically via a temporary file to avoid corruption if interrupted.
 *
 * @param {string} filePath - Target file path
 * @param {string} data - File contents
 * @returns {boolean} - true if file was written/updated, false if unchanged
 */
export function writeSecureFile(filePath, data) {
  if (fs.existsSync(filePath)) {
    try {
      const existing = fs.readFileSync(filePath, 'utf8')
      if (existing === data) {
        return false
      }
    } catch {
      // If reading fails, proceed with write
    }
  }

  const dir = path.dirname(filePath)
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}`)

  try {
    fs.writeFileSync(tempPath, data, { encoding: 'utf8', mode: 0o600 })
    try {
      fs.chmodSync(tempPath, 0o600)
    } catch {
      // Non-fatal on platforms without POSIX mode support
    }
    fs.renameSync(tempPath, filePath)
    return true
  } catch {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath)
      }
    } catch {
      // Ignore cleanup error
    }
    // Fallback: direct write if atomic rename is not supported across filesystem boundaries
    fs.writeFileSync(filePath, data, { encoding: 'utf8', mode: 0o600 })
    try { fs.chmodSync(filePath, 0o600) } catch {}
    return true
  }
}

/**
 * Creates a bounded backup of a corrupted configuration file.
 * Keeps at most 2 backup files (primary and .old), pruning older ones.
 *
 * @param {string} filePath - Path to the corrupt configuration file
 */
export function createBoundedBackup(filePath) {
  if (!fs.existsSync(filePath)) return

  const dir = path.dirname(filePath)
  const base = path.basename(filePath)
  const primaryBackup = path.join(dir, `${base}.bak`)
  const secondaryBackup = path.join(dir, `${base}.bak.old`)

  try {
    if (fs.existsSync(primaryBackup)) {
      try {
        if (fs.existsSync(secondaryBackup)) {
          fs.unlinkSync(secondaryBackup)
        }
        fs.renameSync(primaryBackup, secondaryBackup)
      } catch {
        // Non-fatal rotation
      }
    }

    fs.copyFileSync(filePath, primaryBackup)
    try {
      fs.chmodSync(primaryBackup, 0o600)
    } catch {}

    // Clean up any legacy unbounded .bak.<timestamp> files if present
    try {
      const files = fs.readdirSync(dir)
      const legacyPattern = new RegExp(`^${base.replace(/\./g, '\\.')}\\.bak\\.\\d+$`)
      for (const file of files) {
        if (legacyPattern.test(file)) {
          try { fs.unlinkSync(path.join(dir, file)) } catch {}
        }
      }
    } catch {}
  } catch {
    // Non-fatal backup failure
  }
}

/**
 * Create directory with restricted permissions (0o700) if it does not already exist.
 * Preserves existing directory permissions if it already exists.
 */
export function makeSecureDir(dirPath) {
  if (!dirPath || dirPath === '.' || dirPath === '/') return
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 })
    try {
      fs.chmodSync(dirPath, 0o700)
    } catch {
      // Non-fatal
    }
  }
}
