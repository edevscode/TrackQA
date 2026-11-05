import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { isSafeConfigurationRoot } from '../src/cli.ts'
import { trustedLocation } from '../src/clients/codex.ts'
import { trustedClaudeLocation } from '../src/clients/claude.ts'
import { trustedGeminiLocation } from '../src/clients/gemini.ts'
import { trustedVSCodeLocation } from '../src/clients/vscode.ts'

const home = path.resolve(os.tmpdir(), 'trackqa-location-home')
const repo = path.resolve(os.tmpdir(), 'trackqa-location-package')
const profile = path.join(home, '.codex')
const data = path.join(home, 'AppData', 'Local')
const workspace = path.join(home, 'projects', 'example')

for (const [client, check, suffix] of [
  ['codex', trustedLocation, '.antigravity-ide/extensions/openai.chatgpt-1.0/bin/windows-x86_64/codex.exe'],
  ['claude', trustedClaudeLocation, '.local/bin/claude.exe'],
  ['gemini', trustedGeminiLocation, 'AppData/Roaming/npm/node_modules/@google/gemini-cli/dist/index.js'],
  ['vscode', trustedVSCodeLocation, 'AppData/Local/Programs/Microsoft VS Code/Code.exe'],
]) test(`${client} detects trusted user installations from home while preserving workspace and executable boundaries`, () => {
  const user = 'C:\\Users\\owner', executable = path.win32.join(user, suffix)
  assert.equal(check(executable, user, 'win32', user), true)
  assert.equal(check(executable, user, 'win32', user.toUpperCase() + '\\'), true)
  assert.equal(check(executable, user, 'win32', user + '\\project'), true)
  assert.equal(check(executable, user, 'win32', path.win32.dirname(executable)), false)
  assert.equal(check(executable, user, 'win32', 'C:\\'), false)
  for (const file of [path.win32.join(user, 'Downloads', path.win32.basename(executable)),
    path.win32.join(user, 'project', path.win32.basename(executable)), '.\\' + path.win32.basename(executable)]) {
    assert.equal(check(file, user, 'win32', user), false)
  }
})

test('default Gemini home is allowed from the home shell without exempting workspace overrides', () => {
  assert.equal(isSafeConfigurationRoot(home, home, repo, home, home), true)
  assert.equal(isSafeConfigurationRoot(path.join(home, 'custom'), home, repo, home, home), false)
  assert.equal(isSafeConfigurationRoot(workspace, workspace, repo, home, home), false)
  assert.equal(isSafeConfigurationRoot(home, home, home, home, home), false)
})

test('launching from home permits only the exact default Codex and recovery roots', () => {
  assert.equal(isSafeConfigurationRoot(profile, home, repo, home, profile), true)
  assert.equal(isSafeConfigurationRoot(data, home, repo, home, data), true)
  for (const target of [home, path.join(workspace, '.codex'), path.join(home, 'custom-profile')]) {
    assert.equal(isSafeConfigurationRoot(target, home, repo, home, profile), false)
  }
  for (const target of [home, path.join(workspace, 'data'), path.join(home, 'custom-data')]) {
    assert.equal(isSafeConfigurationRoot(target, home, repo, home, data), false)
  }
})

test('normal project launches still use existing external profile and recovery roots', () => {
  assert.equal(isSafeConfigurationRoot(profile, workspace, repo, home, profile), true)
  assert.equal(isSafeConfigurationRoot(data, workspace, repo, home, data), true)
  const isolated = path.resolve(os.tmpdir(), 'trackqa-isolated-profile')
  assert.equal(isSafeConfigurationRoot(isolated, workspace, repo, home, profile), true)
})

test('workspace-local paths, the workspace itself, and package paths remain rejected', () => {
  for (const target of [workspace, path.join(workspace, '.codex'), path.join(workspace, 'data'), repo, path.join(repo, '.codex')]) {
    assert.equal(isSafeConfigurationRoot(target, workspace, repo, home, profile), false)
  }
  assert.equal(isSafeConfigurationRoot(profile, profile, repo, home, profile), false)
  assert.equal(isSafeConfigurationRoot(data, data, repo, home, data), false)
  assert.equal(isSafeConfigurationRoot(profile, path.parse(home).root, repo, home, profile), false)
})

test('home exception never overrides the repository boundary', () => {
  assert.equal(isSafeConfigurationRoot(profile, home, home, home, profile), false)
  assert.equal(isSafeConfigurationRoot(data, home, home, home, data), false)
})

test('path normalization retains boundary checks without accepting relatives', () => {
  assert.equal(isSafeConfigurationRoot(profile + path.sep, home + path.sep, repo, home, profile), true)
  assert.equal(isSafeConfigurationRoot(path.join(home, 'project', '..', '.codex'), home, repo, home, profile), true)
  assert.equal(isSafeConfigurationRoot(path.join(home, '.codex-untrusted'), home, repo, home, profile), false)
  assert.equal(isSafeConfigurationRoot('.codex', home, repo, home, profile), false)
  if (process.platform === 'win32') assert.equal(isSafeConfigurationRoot(profile.toUpperCase(), home.toUpperCase(), repo, home, profile), true)
})

test('resolved profile and recovery redirects into a workspace remain blocked', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'trackqa-location-test-'))
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.match(path.basename(root), /^trackqa-location-test-/)
    await rm(root, { recursive: true, force: true })
  })
  const fixtureHome = path.join(root, 'home'), fixtureWorkspace = path.join(fixtureHome, 'project'), fixtureRepo = path.join(root, 'package')
  await mkdir(fixtureRepo, { recursive: true })
  for (const name of ['profile', 'data']) {
    const target = path.join(fixtureWorkspace, name), link = path.join(root, name + '-link')
    await mkdir(target, { recursive: true })
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    const canonical = await realpath(link)
    assert.equal(isSafeConfigurationRoot(canonical, fixtureWorkspace, fixtureRepo, fixtureHome, path.join(fixtureHome, '.codex')), false)
  }
})
