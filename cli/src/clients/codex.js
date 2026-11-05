import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { makeSecureDir, writeSecureFile } from './fs-secure.js'

export const name = 'Codex CLI'

export function isInstalled() {
  if (fs.existsSync(path.join(os.homedir(), '.codex'))) {
    return true
  }
  try {
    const checkCmd = process.platform === 'win32' ? 'where codex' : 'which codex'
    execSync(checkCmd, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function getConfigPath() {
  return path.join(os.homedir(), '.codex', 'config.toml')
}

export function updateTomlSection(content, sectionHeader, newSection) {
  const headerIdx = content.indexOf(sectionHeader)
  if (headerIdx === -1) {
    const trailing = content.endsWith('\n') || content === '' ? '' : '\n'
    return `${content}${trailing}\n${newSection.trim()}\n`
  }

  // Find next section header starting with '\n[' after headerIdx
  const afterHeader = content.slice(headerIdx + sectionHeader.length)
  const nextSectionMatch = afterHeader.match(/\n\[/m)

  if (!nextSectionMatch) {
    // sectionHeader was the last section
    const before = content.slice(0, headerIdx).trimEnd()
    const prefix = before ? `${before}\n\n` : ''
    return `${prefix}${newSection.trim()}\n`
  }

  const nextHeaderIdx = headerIdx + sectionHeader.length + nextSectionMatch.index
  const before = content.slice(0, headerIdx).trimEnd()
  const after = content.slice(nextHeaderIdx + 1) // slice from '['
  const prefix = before ? `${before}\n\n` : ''
  return `${prefix}${newSection.trim()}\n\n${after}`
}

export async function configure({ endpoint, token, configPath }) {
  const configFile = configPath || getConfigPath()
  const configDir = path.dirname(configFile)

  makeSecureDir(configDir)

  let content = ''
  if (fs.existsSync(configFile)) {
    content = fs.readFileSync(configFile, 'utf8')
  }

  const sectionHeader = '[mcp_servers.trackqa]'
  const newSection = `[mcp_servers.trackqa]\nurl = "${endpoint}"\nhttp_headers = { "Authorization" = "Bearer ${token}" }`

  content = updateTomlSection(content, sectionHeader, newSection)
  writeSecureFile(configFile, content)
  return { ok: true, targetPath: configFile }
}
