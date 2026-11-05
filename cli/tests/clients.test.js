import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import * as antigravity from '../src/clients/antigravity.js'
import * as vscode from '../src/clients/vscode.js'
import * as claude from '../src/clients/claude.js'
import * as windsurf from '../src/clients/windsurf.js'
import * as codex from '../src/clients/codex.js'
import { protectGitIgnore } from '../src/git-protect.js'

test('clients test suite', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trackqa-cli-test-'))

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  await t.test('Antigravity preserves existing servers and updates trackqa idempotently', async () => {
    const testConfigPath = path.join(tempDir, 'gemini-config', 'mcp_config.json')
    fs.mkdirSync(path.dirname(testConfigPath), { recursive: true })

    const initial = {
      mcpServers: {
        existingServer: {
          command: 'npx',
          args: ['my-tool'],
        },
      },
      unrelatedField: 'preserved',
    }
    fs.writeFileSync(testConfigPath, JSON.stringify(initial, null, 2), 'utf8')

    // First configure
    const res1 = await antigravity.configure({
      endpoint: 'https://test.supabase.co/functions/v1/trackqa-mcp',
      token: 'tqm_testtoken1',
      configPath: testConfigPath,
    })
    assert.equal(res1.ok, true)

    const afterFirst = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'))
    assert.equal(afterFirst.unrelatedField, 'preserved')
    assert.deepEqual(afterFirst.mcpServers.existingServer, { command: 'npx', args: ['my-tool'] })
    assert.equal(afterFirst.mcpServers.trackqa.url, 'https://test.supabase.co/functions/v1/trackqa-mcp')
    assert.equal(afterFirst.mcpServers.trackqa.headers.Authorization, 'Bearer tqm_testtoken1')

    // Second configure (repeated / idempotent)
    const res2 = await antigravity.configure({
      endpoint: 'https://test.supabase.co/functions/v1/trackqa-mcp',
      token: 'tqm_updatedtoken2',
      configPath: testConfigPath,
    })
    assert.equal(res2.ok, true)

    const afterSecond = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'))
    assert.equal(Object.keys(afterSecond.mcpServers).length, 2)
    assert.equal(afterSecond.mcpServers.trackqa.headers.Authorization, 'Bearer tqm_updatedtoken2')
  })

  await t.test('VS Code preserves existing servers and writes workspace config', async () => {
    const testConfigPath = path.join(tempDir, 'vscode', '.vscode', 'mcp.json')
    fs.mkdirSync(path.dirname(testConfigPath), { recursive: true })

    const initial = {
      mcpServers: {
        github: { type: 'http', url: 'https://github.com/mcp' },
      },
    }
    fs.writeFileSync(testConfigPath, JSON.stringify(initial, null, 2), 'utf8')

    const res = await vscode.configure({
      endpoint: 'https://test.supabase.co/functions/v1/trackqa-mcp',
      token: 'tqm_testvscode',
      configPath: testConfigPath,
    })
    assert.equal(res.ok, true)

    const updated = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'))
    assert.equal(updated.mcpServers.github.url, 'https://github.com/mcp')
    assert.equal(updated.mcpServers.trackqa.type, 'http')
    assert.equal(updated.mcpServers.trackqa.headers.Authorization, 'Bearer tqm_testvscode')
  })

  await t.test('Claude Code configures .mcp.json directly when configPath specified', async () => {
    const testConfigPath = path.join(tempDir, 'claude', '.mcp.json')
    fs.mkdirSync(path.dirname(testConfigPath), { recursive: true })

    const res = await claude.configure({
      endpoint: 'https://test.supabase.co/functions/v1/trackqa-mcp',
      token: 'tqm_testclaude',
      configPath: testConfigPath,
    })
    assert.equal(res.ok, true)

    const updated = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'))
    assert.equal(updated.mcpServers.trackqa.type, 'http')
    assert.equal(updated.mcpServers.trackqa.headers.Authorization, 'Bearer tqm_testclaude')
  })

  await t.test('Windsurf preserves existing servers', async () => {
    const testConfigPath = path.join(tempDir, 'windsurf', 'mcp_config.json')
    fs.mkdirSync(path.dirname(testConfigPath), { recursive: true })

    const res = await windsurf.configure({
      endpoint: 'https://test.supabase.co/functions/v1/trackqa-mcp',
      token: 'tqm_testwindsurf',
      configPath: testConfigPath,
    })
    assert.equal(res.ok, true)

    const updated = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'))
    assert.equal(updated.mcpServers.trackqa.type, 'http')
    assert.equal(updated.mcpServers.trackqa.headers.Authorization, 'Bearer tqm_testwindsurf')
  })

  await t.test('Codex TOML preserves other tables and updates trackqa cleanly', async () => {
    const testConfigPath = path.join(tempDir, 'codex', 'config.toml')
    fs.mkdirSync(path.dirname(testConfigPath), { recursive: true })

    const initial = `
model = "gpt-6.1-sol"
service_tier = "default"

[windows]
sandbox = "unelevated"

[mcp_servers.other_tool]
url = "https://other.com/mcp"
`
    fs.writeFileSync(testConfigPath, initial, 'utf8')

    // First configure
    const res1 = await codex.configure({
      endpoint: 'https://test.supabase.co/functions/v1/trackqa-mcp',
      token: 'tqm_testcodex1',
      configPath: testConfigPath,
    })
    assert.equal(res1.ok, true)

    let updated = fs.readFileSync(testConfigPath, 'utf8')
    assert.match(updated, /model = "gpt-6\.1-sol"/)
    assert.match(updated, /\[windows\]/)
    assert.match(updated, /\[mcp_servers\.other_tool\]/)
    assert.match(updated, /\[mcp_servers\.trackqa\]/)
    assert.match(updated, /Authorization" = "Bearer tqm_testcodex1/)

    // Second configure (replaces existing trackqa table)
    const res2 = await codex.configure({
      endpoint: 'https://test.supabase.co/functions/v1/trackqa-mcp',
      token: 'tqm_testcodex2',
      configPath: testConfigPath,
    })
    assert.equal(res2.ok, true)

    updated = fs.readFileSync(testConfigPath, 'utf8')
    assert.equal((updated.match(/\[mcp_servers\.trackqa\]/g) || []).length, 1)
    assert.match(updated, /Authorization" = "Bearer tqm_testcodex2/)
    assert.doesNotMatch(updated, /tqm_testcodex1/)
  })

  await t.test('protectGitIgnore protects local credentials from accidental git commits', async () => {
    const gitRepoDir = path.join(tempDir, 'mock-repo')
    fs.mkdirSync(path.join(gitRepoDir, '.git'), { recursive: true })
    fs.writeFileSync(path.join(gitRepoDir, '.gitignore'), 'node_modules\ndist\n', 'utf8')

    const targetFile = path.join(gitRepoDir, '.mcp.json')
    const updated = protectGitIgnore(targetFile, gitRepoDir)
    assert.equal(updated, true)

    const gitignoreContent = fs.readFileSync(path.join(gitRepoDir, '.gitignore'), 'utf8')
    assert.match(gitignoreContent, /\.mcp\.json/)

    // Idempotent: repeated call does not duplicate
    const updatedAgain = protectGitIgnore(targetFile, gitRepoDir)
    assert.equal(updatedAgain, false)

    // Not inside git repo
    const nonGitDir = path.join(tempDir, 'non-git')
    fs.mkdirSync(nonGitDir, { recursive: true })
    assert.equal(protectGitIgnore(path.join(nonGitDir, '.mcp.json'), nonGitDir), false)
  })
})
