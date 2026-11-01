import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from '../../../node_modules/typescript/lib/typescript.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(root, 'dist')
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const inputs = () => Object.fromEntries(['build.mjs', 'deno.json', 'deno.lock', 'deploy.imports.json',
  ...fs.readdirSync(root).filter((name) => name.endsWith('.ts'))].sort()
  .map((name) => [name, hash(fs.readFileSync(path.join(root, name)))]))

export function inspectBundle(bytes) {
  const source = ts.createSourceFile('index.js', bytes.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const imports = new Set()
  if (source.parseDiagnostics.length) throw new Error('Bundle contains invalid JavaScript')
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== 'node:process') {
        throw new Error('Bundle has an unexpected external import')
      }
      imports.add(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      throw new Error('Bundle has a dynamic dependency')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...imports].sort()
}

export function verifyBundle() {
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'))
  const bytes = fs.readFileSync(path.join(dist, 'index.js'))
  if (JSON.stringify(manifest.inputs) !== JSON.stringify(inputs()) || manifest.sha256 !== hash(bytes)
    || JSON.stringify(manifest.runtimeImports) !== JSON.stringify(inspectBundle(bytes))) {
    throw new Error('Bundle is stale or has changed; rebuild before deployment')
  }
  return manifest
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--verify')) console.log(JSON.stringify(verifyBundle()))
  else {
    const deno = process.env.DENO_BIN ?? (process.platform === 'win32'
      ? path.join(os.homedir(), '.deno', 'bin', 'deno.exe') : 'deno')
    const env = { ...process.env, DENO_NO_UPDATE_CHECK: '1', DENO_NO_PROMPT: '1' }
    const version = spawnSync(deno, ['--version'], { env, encoding: 'utf8', windowsHide: true })
    if (version.status !== 0 || !version.stdout.startsWith('deno 2.9.8 ')) throw new Error('Use the tested Deno 2.9.8 installation')
    const before = inputs()
    fs.mkdirSync(dist, { recursive: true })
    const output = path.join(dist, 'index.next.js')
    const built = spawnSync(deno, ['bundle', '--frozen-lockfile', '--config=deno.json', '--platform=deno',
      '--format=esm', '--packages=bundle', '--minify', `--output=${output}`, 'index.ts'],
    { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 90_000 })
    if (built.status !== 0 || built.error) throw new Error('Frozen Deno bundle failed')
    if (JSON.stringify(before) !== JSON.stringify(inputs())) throw new Error('Build inputs changed during bundling')
    const bytes = fs.readFileSync(output)
    const manifest = { deno: '2.9.8', inputs: before, bytes: bytes.length,
      sha256: hash(bytes), runtimeImports: inspectBundle(bytes) }
    fs.renameSync(output, path.join(dist, 'index.js'))
    fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(JSON.stringify(verifyBundle()))
  }
}
