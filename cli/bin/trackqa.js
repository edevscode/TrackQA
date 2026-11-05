#!/usr/bin/env node

import { runSetup } from '../src/setup.js'

function printHelp() {
  console.log(`
TrackQA CLI

Usage:
  npx trackqa setup [options]

Commands:
  setup                Connect installed AI assistants to TrackQA automatically

Options:
  --project <id>       Pre-select a specific TrackQA project ID
  --app-url <url>      Override TrackQA web application URL
  --help, -h           Show this help message
  --version, -v        Show CLI version
`)
}

async function main() {
  const args = process.argv.slice(2)
  const options = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      printHelp()
      process.exit(0)
    }
    if (arg === '--version' || arg === '-v') {
      console.log('trackqa v0.2.2')
      process.exit(0)
    }
    if (arg === '--project' && i + 1 < args.length) {
      options.project = args[++i]
    }
    if (arg === '--app-url' && i + 1 < args.length) {
      options.appUrl = args[++i]
    }
  }

  // Default command is setup
  await runSetup(options)
  process.exit(0)
}

main().catch(err => {
  console.error('\nFatal error:', err.message)
  process.exit(1)
})

