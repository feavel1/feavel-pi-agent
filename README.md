# Pi Sync Dotfiles

Pi configuration backup & sync across devices via git.

## What's Here

| Path | Description |
|------|-------------|
| `extensions/` | Pi agent extensions (`.ts` files) |
| `skills/` | Agent skills (one folder per skill) |
| `prompts/` | Custom prompt templates (`.md`) |
| `settings.json` | Agent settings, theme, packages list |
| `mcp.json` | MCP server configuration |

**Note:** `extensions/pi-sync/config.json` is **not** synced — it stores machine-specific remote/branch config.

## Setup

In pi, run:

```
/sync-setup
```

Enter this repo URL when prompted, then `main` for branch.

## Usage

| Command | Action |
|---------|--------|
| `/sync-push` | Push local config to remote |
| `/sync-pull` | Pull config from remote |
| `/sync-status` | Show config & file sizes |
| `/reload` | Reload pi after pull |

### Via agent

LLM tools `pi_sync({action:'push'|'pull'|'status'})` also available.

## Setup on a New Machine

1. Install pi
2. Run `/sync-setup` → paste this repo URL → branch `main`
3. Run `/sync-pull` → run `/reload`
