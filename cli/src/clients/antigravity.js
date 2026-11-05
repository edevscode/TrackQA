import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const name = 'Google Antigravity'

export function isInstalled() {
  const geminiDir = path.join(os.homedir(), '.gemini')
  return fs.existsSync(geminiDir)
}

export function getConfigPath() {
  return path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json')
}

export async function configure({ endpoint, token, configPath }) {
  const configFile = configPath || getConfigPath()
  const configDir = path.dirname(configFile)

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  let config = {}
  if (fs.existsSync(configFile)) {
    try {
      const raw = fs.readFileSync(configFile, 'utf8').trim()
      if (raw) {
        config = JSON.parse(raw)
      }
    } catch {
      const backup = `${configFile}.bak.${Date.now()}`
      fs.copyFileSync(configFile, backup)
      config = {}
    }
  }

  config.mcpServers = config.mcpServers || {}
  config.mcpServers.trackqa = {
    url: endpoint,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }

  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return { ok: true, targetPath: configFile }
}
