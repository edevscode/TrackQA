// No npm dependencies: test the exact generated deployment entry point.
// Register only this test; the source-entry test module is not imported.
import { checkEntryPoint } from './entrypoint-fixture.ts'

Deno.test('Frozen pilot bundle preserves authentication and scoped MCP reads without 0034',
  () => checkEntryPoint(() => import('../dist/index.js')))
