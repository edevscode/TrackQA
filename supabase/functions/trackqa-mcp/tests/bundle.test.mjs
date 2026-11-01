import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { inspectBundle, verifyBundle } from '../build.mjs'

test('bundle allows only the supported runtime builtin', () => {
  assert.deepEqual(inspectBundle(Buffer.from('import process from "node:process"; export const x = process;')), ['node:process'])
  assert.deepEqual(inspectBundle(Buffer.from('export const x = 1;')), [])
})
test('bundle refuses hosted npm/URL resolution and dynamic dependencies', () => {
  for (const source of ['import x from "npm:zod";', 'export * from "https://example.test/module.js";',
    'import("node:process");', 'require("zod");', 'import x from "./mutable.js";', 'const x = ;']) {
    assert.throws(() => inspectBundle(Buffer.from(source)))
  }
})
test('deployment manifest verifies frozen inputs and detects artifact mutation', () => {
  const manifest = verifyBundle()
  assert.equal(manifest.deno, '2.9.8')
  assert.deepEqual(manifest.runtimeImports, ['node:process'])
  const file = new URL('../dist/index.js', import.meta.url)
  const original = fs.readFileSync(file)
  try {
    fs.writeFileSync(file, Buffer.concat([original, Buffer.from('\n// synthetic tamper\n')]))
    assert.throws(verifyBundle, /stale or has changed/)
  } finally { fs.writeFileSync(file, original) }
  assert.equal(verifyBundle().sha256, manifest.sha256)
})
test('changed locked deployment inputs require a rebuild', () => {
  const file = new URL('../deploy.imports.json', import.meta.url)
  const original = fs.readFileSync(file)
  try {
    fs.writeFileSync(file, Buffer.concat([original, Buffer.from('\n')]))
    assert.throws(verifyBundle, /stale or has changed/)
  } finally { fs.writeFileSync(file, original) }
  verifyBundle()
})

test('payload has the authorized read/submission RPCs and no human review, admission or SQL payload', () => {
  const output = fs.readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8')
  for (const operation of ['resolve_mcp_connection', 'mcp_list_projects', 'mcp_list_issues', 'mcp_get_issue', 'mcp_submit_finding']) {
    assert.ok(output.includes(operation))
  }
  for (const rejected of ['review_ai_finding', 'admit_mcp_request', 'mcp_request_budget', '0034_mcp_request_admission', 'sql-drafts/']) {
    assert.equal(output.includes(rejected), false)
  }
  const config = fs.readFileSync(new URL('../../../config.toml', import.meta.url), 'utf8')
  const section = config.match(/\[functions\.trackqa-mcp\]([^]*?)(?=\n\[|$)/)?.[1]
  assert.ok(section)
  assert.match(section, /verify_jwt\s*=\s*false/)
  assert.match(section, /entrypoint\s*=\s*"\.\/functions\/trackqa-mcp\/dist\/index\.js"/)
  assert.match(section, /import_map\s*=\s*"\.\/functions\/trackqa-mcp\/deploy\.imports\.json"/)
  assert.equal(section.includes('static_files'), false)
  assert.equal(fs.existsSync(new URL('../../../migrations/0034_mcp_request_admission.sql', import.meta.url)), false)
})
