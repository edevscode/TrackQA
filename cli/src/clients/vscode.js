import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { makeSecureDir, writeSecureFile, createBoundedBackup } from './fs-secure.js'
import { protectGitIgnore } from '../git-protect.js'

export const name = 'VS Code'

export function isInstalled() {
  if (fs.existsSync(path.join(process.cwd(), '.vscode'))) {
    return true
  }

  const platform = process.platform
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return fs.existsSync(path.join(appData, 'Code'))
  }
  if (platform === 'darwin') {
    return fs.existsSync(path.join(os.homedir(), 'Library', 'Application Support', 'Code'))
  }
  return fs.existsSync(path.join(os.homedir(), '.config', 'Code'))
}

export function getConfigPath() {
  return path.join(process.cwd(), '.vscode', 'mcp.json')
}

export async function configure({ endpoint, token, configPath }) {
  const configFile = configPath || getConfigPath()
  const configDir = path.dirname(configFile)

  makeSecureDir(configDir)

  let config = {}
  if (fs.existsSync(configFile)) {
    try {
      const raw = fs.readFileSync(configFile, 'utf8').trim()
      if (raw) {
        config = JSON.parse(raw)
      }
    } catch {
      createBoundedBackup(configFile)
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
