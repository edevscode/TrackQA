import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { writeSecureFile } from './fs-secure.js'
import { protectGitIgnore } from '../git-protect.js'

export const name = 'Claude Code'

export function isInstalled() {
  if (fs.existsSync(path.join(os.homedir(), '.claude.json'))) {
    return true
  }
  try {
    const checkCmd = process.platform === 'win32' ? 'where claude' : 'which claude'
    execSync(checkCmd, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function getConfigPath() {
  return path.join(process.cwd(), '.mcp.json')
}

export async function configure({ endpoint, token, configPath }) {
  // If configPath is explicitly provided (e.g. in tests), write to it directly
  if (configPath) {
    const configFile = configPath
    let config = {}
    if (fs.existsSync(configFile)) {
      try {
        const raw = fs.readFileSync(configFile, 'utf8').trim()
        if (raw) config = JSON.parse(raw)
      } catch {
        config = {}
      }
    }
    config.mcpServers = config.mcpServers || {}
    config.mcpServers.trackqa = {
      type: 'http',
      url: endpoint,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
    writeSecureFile(configFile, JSON.stringify(config, null, 2) + '\n')
    protectGitIgnore(configFile)
    return { ok: true, targetPath: configFile }
  }

  // First attempt: native claude CLI command
  try {
    const cmd = `claude mcp add --scope project --transport http trackqa "${endpoint}" --header "Authorization: Bearer ${token}"`
    execSync(cmd, { stdio: 'pipe' })
    protectGitIgnore(getConfigPath())
    return { ok: true, targetPath: `${getConfigPath()} (via claude CLI)` }
  } catch {
    // Fallback: direct write to .mcp.json in workspace
    const configFile = getConfigPath()
    let config = {}
    if (fs.existsSync(configFile)) {
      try {
        const raw = fs.readFileSync(configFile, 'utf8').trim()
        if (raw) config = JSON.parse(raw)
      } catch {
        const backup = `${configFile}.bak.${Date.now()}`
        fs.copyFileSync(configFile, backup)
        try { fs.chmodSync(backup, 0o600) } catch {}
        config = {}
      }
    }

    config.mcpServers = config.mcpServers || {}
    config.mcpServers.trackqa = {
      type: 'http',
      url: endpoint,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }

    writeSecureFile(configFile, JSON.stringify(config, null, 2) + '\n')
    protectGitIgnore(configFile)
    return { ok: true, targetPath: configFile }
  }
}
