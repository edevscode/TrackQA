# TrackQA CLI

The official CLI for connecting AI coding assistants (Google Antigravity, VS Code, Windsurf, Claude Code, Codex) to TrackQA.

## Usage

```bash
npx trackqa setup
```

## How It Works

1. **Browser Authorization**: Launches a short-lived loopback server on `127.0.0.1` and opens your browser to confirm project authorization.
2. **Client Discovery**: Automatically detects installed AI coding assistants on your system.
3. **Safe Configuration**: Registers the project-scoped TrackQA MCP server without modifying unrelated settings or exposing credentials in Git.
4. **Done**: Your AI assistant can immediately inspect issues and file findings for human QA review.

## Supported Clients

- **Google Antigravity** (`~/.gemini/config/mcp_config.json`)
- **VS Code** (`.vscode/mcp.json`)
- **Windsurf** (`~/.codeium/windsurf/mcp_config.json`)
- **Claude Code** (`claude mcp add` / `.mcp.json`)
- **Codex CLI** (`~/.codex/config.toml`)

