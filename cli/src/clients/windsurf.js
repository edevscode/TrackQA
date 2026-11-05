import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { makeSecureDir, writeSecureFile, createBoundedBackup } from './fs-secure.js'

export const name = 'Windsurf'

export function isInstalled() {
  const dir = path.join(os.homedir(), '.codeium', 'windsurf')
  return fs.existsSync(dir)
}

export function getConfigPath() {
  return path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json')
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
  return { ok: true, targetPath: configFile }
}
