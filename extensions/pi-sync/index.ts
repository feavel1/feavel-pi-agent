import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { readFile, writeFile, mkdir, readdir, stat, copyFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { existsSync } from "node:fs";

// ── paths ──────────────────────────────────────────────────────────
const PI_DIR = join(process.env.HOME!, ".pi", "agent");
const SYNC_DIRS = [
  { name: "extensions", path: join(PI_DIR, "extensions") },
  { name: "skills",     path: join(PI_DIR, "skills") },
  { name: "prompts",    path: join(PI_DIR, "prompts") },
] as const;
const SETTINGS_FILE = join(PI_DIR, "settings.json");
const MCP_FILE       = join(PI_DIR, "mcp.json");
const CONFIG_FILE    = join(PI_DIR, "extensions", "pi-sync", "config.json");

// ── types ──────────────────────────────────────────────────────────
interface SyncConfig {
  /** git remote URL (e.g. git@github.com:user/pi-dotfiles.git) */
  remote: string;
  /** branch to sync with */
  branch: string;
  /** directory where the sync repo is cloned locally */
  repoDir: string;
}

const DEFAULT_CONFIG: SyncConfig = {
  remote: "",
  branch: "main",
  repoDir: join(process.env.HOME!, ".pi-sync"),
};

// ── helpers ────────────────────────────────────────────────────────
async function loadConfig(): Promise<SyncConfig> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function saveConfig(cfg: SyncConfig): Promise<void> {
  await mkdir(join(PI_DIR, "extensions", "pi-sync"), { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
}

/** Copy a file into the repo, preserving relative path under base. */
async function stageFile(repoDir: string, absPath: string, base: string): Promise<string | null> {
  const rel = relative(base, absPath);
  if (rel.startsWith("..") || rel.startsWith("/")) return null;
  const dest = join(repoDir, rel);
  const destDir = join(dest, "..");
  await mkdir(destDir, { recursive: true });
  await copyFile(absPath, dest);
  return rel;
}

/** Walk a directory non-recursively (1 level) to find files/dirs to copy. */
async function collectDirEntries(absDir: string): Promise<string[]> {
  try {
    return await readdir(absDir);
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function dirSize(absDir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(absDir, e.name);
      if (e.isFile()) {
        try { total += (await stat(p)).size; } catch { /* skip */ }
      } else if (e.isDirectory()) {
        total += await dirSize(p);
      }
    }
  } catch { /* skip */ }
  return total;
}

// ── commands ───────────────────────────────────────────────────────
async function cmdSetup(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const cfg = await loadConfig();

  if (!cfg.remote) {
    const remote = await ctx.ui.input("Enter git remote URL:", "git@github.com:user/pi-dotfiles.git");
    if (!remote) { ctx.ui.notify("Canceled", "warning"); return; }
    cfg.remote = remote;
  }

  const branch = await ctx.ui.input("Branch:", cfg.branch);
  if (!branch) { ctx.ui.notify("Canceled", "warning"); return; }
  // validate: branch must not be a URL (common user mistake)
  if (branch.startsWith("http://") || branch.startsWith("https://") || branch.startsWith("git@")) {
    ctx.ui.notify("Invalid branch name (looks like a URL). Use 'main' or your branch name.", "error");
    return;
  }
  cfg.branch = branch;

  await saveConfig(cfg);

  // clone or init
  const { execSync } = await import("node:child_process");
  try {
    if (existsSync(join(cfg.repoDir, ".git"))) {
      ctx.ui.notify("Repo already cloned — pulling latest", "info");
      execSync(`git -C "${cfg.repoDir}" pull origin ${cfg.branch}`, { stdio: "pipe" });
    } else {
      await mkdir(cfg.repoDir, { recursive: true });
      execSync(`git -C "${cfg.repoDir}" init -b ${cfg.branch}`, { stdio: "pipe" });
      if (cfg.remote) {
        execSync(`git -C "${cfg.repoDir}" remote add origin "${cfg.remote}"`, { stdio: "pipe" });
      }
      ctx.ui.notify("Git repo initialized", "success");
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.ui.notify(`Setup failed: ${msg}`, "error");
  }
}

async function cmdPush(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.remote) {
    ctx.ui.notify("No remote configured. Run /sync-setup first", "error");
    return;
  }

  const { execSync } = await import("node:child_process");
  const repoDir = cfg.repoDir;
  const stats: string[] = [];
  let totalFiles = 0;

  try {
    // ensure repo exists
    if (!existsSync(join(repoDir, ".git"))) {
      execSync(`git -C "${repoDir}" init -b ${cfg.branch}`, { stdio: "pipe" });
      if (cfg.remote) {
        execSync(`git -C "${repoDir}" remote add origin "${cfg.remote}"`, { stdio: "pipe" });
      }
    }

    // --- copy extensions (skip pi-sync's config.json — machine-specific) ---
    const extDir = join(PI_DIR, "extensions");
    const extEntries = await collectDirEntries(extDir);
    for (const name of extEntries) {
      const src = join(extDir, name);
      const st = await stat(src);
      if (st.isFile() && name.endsWith(".ts")) {
        const rel = await stageFile(repoDir, src, PI_DIR);
        if (rel) { totalFiles++; }
      } else if (st.isDirectory()) {
        // skip pi-sync's config.json, sync rest
        await copyDirRecursive(src, join(repoDir, "extensions", name), (fname) => fname === "config.json" && name === "pi-sync");
        totalFiles++;
      }
    }
    stats.push(`extensions: synced`);

    // --- copy skills (follow symlinks → copy targets) ---
    const skillDir = join(PI_DIR, "skills");
    const skillEntries = await collectDirEntries(skillDir);
    for (const name of skillEntries) {
      const src = join(skillDir, name);
      const st = await stat(src);
      if (st.isDirectory()) {
        await copyDirRecursive(src, join(repoDir, "skills", name));
        totalFiles++;
      } else if (st.isFile()) {
        const rel = await stageFile(repoDir, src, PI_DIR);
        if (rel) totalFiles++;
      }
    }
    stats.push(`skills: synced`);

    // --- copy prompts ---
    const promptDir = join(PI_DIR, "prompts");
    const promptEntries = await collectDirEntries(promptDir);
    for (const name of promptEntries) {
      const src = join(promptDir, name);
      const st = await stat(src);
      if (st.isFile() && name.endsWith(".md")) {
        const rel = await stageFile(repoDir, src, PI_DIR);
        if (rel) totalFiles++;
      }
    }
    stats.push(`prompts: synced`);

    // --- copy settings.json ---
    if (existsSync(SETTINGS_FILE)) {
      await copyFile(SETTINGS_FILE, join(repoDir, "settings.json"));
      totalFiles++;
      stats.push("settings.json: synced");
    }

    // --- copy mcp.json ---
    if (existsSync(MCP_FILE)) {
      await copyFile(MCP_FILE, join(repoDir, "mcp.json"));
      totalFiles++;
      stats.push("mcp.json: synced");
    }

    // --- .gitignore ---
    const gitignorePath = join(repoDir, ".gitignore");
    if (!existsSync(gitignorePath)) {
      await writeFile(gitignorePath, ".DS_Store\n*.log\n", "utf-8");
    }

    // --- git commit & push ---
    execSync(`git -C "${repoDir}" add -A`, { stdio: "pipe" });
    const changed = execSync(`git -C "${repoDir}" status --porcelain`, { encoding: "utf-8" }).trim();
    if (!changed) {
      ctx.ui.notify("Nothing to sync — already up to date", "info");
      return;
    }

    const fileCount = changed.split("\n").length;
    execSync(`git -C "${repoDir}" commit -m "pi-sync: push ${new Date().toISOString()}"`, { stdio: "pipe" });
    execSync(`git -C "${repoDir}" push origin ${cfg.branch}`, { stdio: "pipe" });

    ctx.ui.notify(`Pushed ${fileCount} file(s) to ${cfg.remote}`, "success");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.ui.notify(`Push failed: ${msg}`, "error");
  }
}

async function cmdPull(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.remote) {
    ctx.ui.notify("No remote configured. Run /sync-setup first", "error");
    return;
  }

  const { execSync } = await import("node:child_process");
  const repoDir = cfg.repoDir;

  try {
    // clone if needed
    if (!existsSync(join(repoDir, ".git"))) {
      execSync(`git clone --branch ${cfg.branch} "${cfg.remote}" "${repoDir}"`, { stdio: "pipe" });
      ctx.ui.notify("Cloned remote repo", "info");
    } else {
      execSync(`git -C "${repoDir}" pull origin ${cfg.branch}`, { stdio: "pipe" });
    }

    // --- restore extensions (skip pi-sync/config.json — machine-specific) ---
    const extRepo = join(repoDir, "extensions");
    if (existsSync(extRepo)) {
      const extEntries = await readdir(extRepo);
      for (const name of extEntries) {
        if (name === "pi-sync") {
          // restore index.ts only, not config.json
          const piSyncDest = join(PI_DIR, "extensions", "pi-sync");
          await mkdir(piSyncDest, { recursive: true });
          const piSyncSrc = join(extRepo, "pi-sync", "index.ts");
          if (existsSync(piSyncSrc)) await copyFile(piSyncSrc, join(piSyncDest, "index.ts"));
        } else {
          await copyDirRecursive(join(extRepo, name), join(PI_DIR, "extensions", name));
        }
      }
    }

    // --- restore skills ---
    const skillRepo = join(repoDir, "skills");
    if (existsSync(skillRepo)) {
      await mkdir(join(PI_DIR, "skills"), { recursive: true });
      const entries = await readdir(skillRepo);
      for (const name of entries) {
        if (name.startsWith(".")) continue;
        await copyDirRecursive(join(skillRepo, name), join(PI_DIR, "skills", name));
      }
    }

    // --- restore prompts ---
    const promptRepo = join(repoDir, "prompts");
    if (existsSync(promptRepo)) {
      await mkdir(join(PI_DIR, "prompts"), { recursive: true });
      const entries = await readdir(promptRepo);
      for (const name of entries) {
        await copyFile(join(promptRepo, name), join(PI_DIR, "prompts", name));
      }
    }

    // --- restore settings.json ---
    const settingsRepo = join(repoDir, "settings.json");
    if (existsSync(settingsRepo)) {
      await copyFile(settingsRepo, SETTINGS_FILE);
    }

    // --- re-install packages from restored settings ---
    try {
      const raw = await readFile(SETTINGS_FILE, "utf-8");
      const settings = JSON.parse(raw);
      const pkgs = settings.packages;
      if (Array.isArray(pkgs) && pkgs.length > 0) {
        ctx.ui.notify(`Re-installing ${pkgs.length} package(s)...`, "info");
        for (const pkg of pkgs) {
          try {
            execSync(`pi install "${pkg}"`, { stdio: "pipe" });
          } catch (e2) {
            const m2 = e2 instanceof Error ? e2.message : String(e2);
            ctx.ui.notify(`  Failed to install ${pkg}: ${m2}`, "warning");
          }
        }
        ctx.ui.notify("Packages re-installed", "success");
      }
    } catch { ctx.ui.notify("Could not re-install packages", "warning"); }

    // --- restore mcp.json ---
    const mcpRepo = join(repoDir, "mcp.json");
    if (existsSync(mcpRepo)) {
      await copyFile(mcpRepo, MCP_FILE);
    }

    ctx.ui.notify("Pull complete. Run /reload to apply changes", "success");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.ui.notify(`Pull failed: ${msg}`, "error");
  }
}

async function cmdStatus(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.remote) {
    ctx.ui.notify("No remote configured. Run /sync-setup first", "info");
    return;
  }

  const sizes: string[] = [];
  for (const d of SYNC_DIRS) {
    const s = await dirSize(d.path);
    sizes.push(`${d.name}: ${formatBytes(s)}`);
  }
  const ss = existsSync(SETTINGS_FILE) ? `settings.json: ${formatBytes((await stat(SETTINGS_FILE)).size)}` : "settings.json: missing";
  const ms = existsSync(MCP_FILE) ? `mcp.json: ${formatBytes((await stat(MCP_FILE)).size)}` : "mcp.json: missing";

  const lines = [
    `Remote: ${cfg.remote}`,
    `Branch: ${cfg.branch}`,
    `Repo:   ${cfg.repoDir}`,
    "",
    ...sizes,
    ss,
    ms,
  ];

  ctx.ui.notify(lines.join("\n"), "info");
}

// ── file utils ─────────────────────────────────────────────────────
async function copyDirRecursive(src: string, dest: string, skip?: (name: string) => boolean): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (skip?.(entry.name)) continue;
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(s, d, skip);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      await copyFile(s, d);
    }
  }
}

// ── export ─────────────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
  pi.registerCommand("sync-setup", {
    description: "Configure git remote for pi config sync",
    handler: cmdSetup,
  });

  pi.registerCommand("sync-push", {
    description: "Push local pi config (extensions, skills, prompts, settings, mcp) to remote git repo",
    handler: cmdPush,
  });

  pi.registerCommand("sync-pull", {
    description: "Pull pi config from remote git repo",
    handler: cmdPull,
  });

  pi.registerCommand("sync-status", {
    description: "Show sync config and local file sizes",
    handler: cmdStatus,
  });

  // LLM-callable tool
  pi.registerTool({
    name: "pi_sync",
    label: "Pi Sync",
    description:
      "Push or pull pi configuration (extensions, skills, prompts, settings, mcp.json) to/from a git remote. " +
      "Setup must be done first via /sync-setup command. Actions: push, pull, status.",
    promptSnippet: "Sync pi configuration across devices via git remote",
    promptGuidelines: [
      "Use pi_sync when the user asks to sync their pi configuration or dotfiles across devices.",
      "Use pi_sync with action='status' to show current sync config and file sizes.",
      "Use pi_sync with action='push' to upload local config to remote git repo.",
      "Use pi_sync with action='pull' to download config from remote git repo. Suggest /reload after pull.",
    ],
    parameters: Type.Object({
      action: StringEnum(["push", "pull", "status"] as const, {
        description: "Sync action to perform",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.action === "status") {
        const cfg = await loadConfig();
        if (!cfg.remote) {
          return {
            content: [{ type: "text", text: "Sync not configured. Tell user to run /sync-setup first." }],
            details: {},
          };
        }
        const sizes: string[] = [];
        for (const d of SYNC_DIRS) {
          const s = await dirSize(d.path);
          sizes.push(`${d.name}: ${formatBytes(s)}`);
        }
        const ss = existsSync(SETTINGS_FILE) ? `settings: ${formatBytes((await stat(SETTINGS_FILE)).size)}` : "settings: missing";
        const ms = existsSync(MCP_FILE) ? `mcp: ${formatBytes((await stat(MCP_FILE)).size)}` : "mcp: missing";
        return {
          content: [{
            type: "text",
            text: [
              `Remote: ${cfg.remote}`,
              `Branch: ${cfg.branch}`,
              ...sizes,
              ss,
              ms,
            ].join("\n"),
          }],
          details: {},
        };
      }

      // push / pull — delegate via command
      if (params.action === "push") {
        pi.sendUserMessage("/sync-push", { deliverAs: "followUp" });
        return {
          content: [{ type: "text", text: "Queued /sync-push. Waiting for completion..." }],
          details: {},
        };
      }

      if (params.action === "pull") {
        pi.sendUserMessage("/sync-pull", { deliverAs: "followUp" });
        return {
          content: [{ type: "text", text: "Queued /sync-pull. Waiting for completion... Run /reload after pull." }],
          details: {},
        };
      }

      return {
        content: [{ type: "text", text: `Unknown action: ${params.action}` }],
        details: {},
        isError: true,
      };
    },
  });
}
