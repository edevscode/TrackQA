import { checkEntryPoint } from './entrypoint-fixture.ts'

Deno.test('Edge entry point always installs custom bearer authentication', () => checkEntryPoint(() => import('../index.ts')))
