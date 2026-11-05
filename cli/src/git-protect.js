import fs from 'node:fs'
import path from 'node:path'

/**
 * Ensures a relative file path containing sensitive credentials is added
 * to the workspace's .gitignore if it is in a Git repository and not already ignored.
 *
 * @param {string} targetFilePath - Absolute or relative path to the configuration file
 * @param {string} [workspaceDir] - Root of the workspace (defaults to process.cwd())
 * @returns {boolean} - true if .gitignore was updated, false otherwise
 */
export function protectGitIgnore(targetFilePath, workspaceDir = process.cwd()) {
  try {
    const gitDir = path.join(workspaceDir, '.git')
    if (!fs.existsSync(gitDir)) return false

    const gitignorePath = path.join(workspaceDir, '.gitignore')
    const rel = path.relative(workspaceDir, targetFilePath).replace(/\\/g, '/')

    // Target must be inside the workspace repository
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false

    let content = ''
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf8')
      const lines = content.split(/\r?\n/).map(l => l.trim())
      if (
        lines.includes(rel) ||
        lines.includes(`/${rel}`) ||
        (rel.startsWith('.vscode/') && lines.some(l => l === '.vscode' || l === '.vscode/' || l === '.vscode/*')) ||
        (rel === '.mcp.json' && lines.some(l => l === '.mcp.json' || l === '*.json'))
      ) {
        return false
      }
    }

    const entry = `\n# TrackQA MCP client credentials\n${rel}\n`
    fs.appendFileSync(gitignorePath, entry, 'utf8')
    return true
  } catch {
    return false
  }
}

