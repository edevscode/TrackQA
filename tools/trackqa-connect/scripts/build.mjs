// Build tooling only. The published runtime has no compiler dependency.
import { execFileSync } from 'node:child_process'
import { chmodSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const packageRoot = realpathSync(fileURLToPath(new URL('../', import.meta.url)))
const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value
const inside = (file, root) => normalized(file).startsWith(normalized(root) + path.sep)
const slash = file => file.split(path.sep).join('/')

export function runtimeClosure(output, entry, dependencies) {
  const visited = new Set()
  function visit(file) {
    if (!inside(file, output) || !/\.(?:mjs|js)$/.test(file)) throw new Error('Runtime import escapes the compiled output')
    if (visited.has(file)) return
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || normalized(realpathSync(file)) !== normalized(file)) throw new Error('Unexpected runtime file identity')
    visited.add(file)
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    function dependency(specifier) {
      if (specifier.startsWith('.')) visit(path.resolve(path.dirname(file), specifier))
      else if (!specifier.startsWith('node:') && !Object.hasOwn(dependencies, specifier)) throw new Error('Undeclared runtime dependency')
    }
    function inspect(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error('Nonliteral runtime import')
        dependency(node.moduleSpecifier.text)
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) throw new Error('Nonliteral runtime import')
        dependency(node.arguments[0].text)
      }
      ts.forEachChild(node, inspect)
    }
    inspect(source)
  }
  visit(entry)
  return [...visited].sort()
}

function ownedFiles(directory) {
  const files = []
  function walk(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name)
      if (item.isSymbolicLink()) throw new Error('Build output contains a link; cleanup refused')
      if (item.isDirectory()) walk(file)
      else if (item.isFile() && /\.(?:js|mjs)$/.test(file)) files.push(file)
      else throw new Error('Unexpected build artifact; cleanup refused')
    }
  }
  walk(directory)
  return files
}

export function build() {
  const output = path.resolve(packageRoot, 'dist')
  // Verify the exact absolute target before the only recursive removal. Never
  // clean profiles, artifacts/, the repository root or a linked directory.
  if (path.dirname(output) !== packageRoot || path.basename(output) !== 'dist') throw new Error('Unowned build directory')
  let stat
  try { stat = lstatSync(output) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (stat) {
    if (!stat.isDirectory() || stat.isSymbolicLink() || normalized(realpathSync(output)) !== normalized(output)) throw new Error('Unowned build directory')
    ownedFiles(output)
    rmSync(output, { recursive: true })
  }
  const compiler = fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url))
  execFileSync(process.execPath, [compiler, '-p', path.join(packageRoot, 'tsconfig.build.json')], { cwd: packageRoot, stdio: 'inherit' })
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
  const entry = path.join(packageRoot, manifest.bin.trackqa)
  const runtime = runtimeClosure(output, entry, manifest.dependencies)
  const expected = manifest.files.filter(file => file.startsWith('dist/')).sort()
  const actual = runtime.map(file => slash(path.relative(packageRoot, file))).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Package files do not match the runtime dependency closure')
  const keep = new Set(runtime)
  for (const file of ownedFiles(output)) if (!keep.has(file)) unlinkSync(file)
  function emptyDirectories(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) if (item.isDirectory()) emptyDirectories(path.join(dir, item.name))
    if (dir !== output && readdirSync(dir).length === 0) rmdirSync(dir)
  }
  emptyDirectories(output)
  if (!/^#!\/usr\/bin\/env node\r?\n/.test(readFileSync(entry, 'utf8'))) throw new Error('Executable Node entry is missing')
  chmodSync(entry, 0o755)
  console.log(`Clean package build: ${runtime.length} runtime files; exact allowlist verified.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build()
