import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

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
    type: 'http',
    url: endpoint,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }

  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return { ok: true, targetPath: configFile }
}
