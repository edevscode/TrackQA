import fs from 'node:fs'

/**
 * Write configuration file containing credentials with restricted permissions (0o600).
 */
export function writeSecureFile(filePath, data) {
  fs.writeFileSync(filePath, data, { encoding: 'utf8', mode: 0o600 })
  try {
    fs.chmodSync(filePath, 0o600)
  } catch {
    // Non-fatal on platforms or environments that do not support POSIX permission bits
  }
}

/**
 * Create directory with restricted permissions (0o700).
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

