import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_DROP_DIR = "/data/agent-drop";
const SAFE_NAME_RE = /^[A-Za-z0-9._-]+$/;
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".log",
  ".ini",
  ".cfg",
  ".conf",
  ".xml",
  ".html",
  ".js",
  ".ts",
  ".py",
  ".sh",
  ".sql",
  ".env",
  ".burn"
]);

export function getDropDir() {
  return process.env.AGENT_DROP_DIR || DEFAULT_DROP_DIR;
}

export function getUserDropDir() {
  return path.join(getDropDir(), "user_drops");
}

export function getAgentDropDir() {
  return path.join(getDropDir(), "agent_drops");
}

function sanitizeFileName(name) {
  return (name || "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 120);
}

export function isSafeFileName(name) {
  return !!(name && SAFE_NAME_RE.test(name));
}

export function generateSafeName(rawName, fallbackPrefix) {
  return sanitizeFileName(rawName) || `${fallbackPrefix}_${Date.now()}`;
}

export function withDropPath(filename, folder = "user_drops") {
  const dir = folder === "agent_drops" ? getAgentDropDir() : getUserDropDir();
  const safe = filename;
  if (!isSafeFileName(safe)) {
    throw new Error("Unsafe filename");
  }
  return path.join(dir, safe);
}

export async function resolveFilePath(filename, folder = null) {
  if (!isSafeFileName(filename)) throw new Error("Unsafe filename");

  if (folder === "user_drops" || folder === "agent_drops") {
    const filePath = path.join(folder === "agent_drops" ? getAgentDropDir() : getUserDropDir(), filename);
    if (await fileExists(filePath)) return filePath;
    const err = new Error("File not found");
    err.code = "ENOENT";
    throw err;
  }

  const userPath = path.join(getUserDropDir(), filename);
  if (await fileExists(userPath)) return userPath;

  const agentPath = path.join(getAgentDropDir(), filename);
  if (await fileExists(agentPath)) return agentPath;

  // Fallback to legacy root dir for old files
  const rootPath = path.join(getDropDir(), filename);
  if (await fileExists(rootPath)) return rootPath;

  const err = new Error("File not found");
  err.code = "ENOENT";
  throw err;
}

export async function ensureDropDir() {
  await fs.mkdir(getDropDir(), { recursive: true });
  await fs.mkdir(getUserDropDir(), { recursive: true });
  await fs.mkdir(getAgentDropDir(), { recursive: true });

  // Set explicit permissions so agent can read/write where needed
  try {
     const rootStat = await fs.stat(getDropDir());
     await fs.chown(getUserDropDir(), rootStat.uid, rootStat.gid);
     await fs.chmod(getUserDropDir(), 0o775);

     await fs.chown(getAgentDropDir(), rootStat.uid, rootStat.gid);
     await fs.chmod(getAgentDropDir(), 0o775);
  } catch (e) {}
}

export async function listDropFiles() {
  await ensureDropDir();

  const files = [];

  async function scanFolder(dirPath, folderName) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || entry.name.startsWith(".") || !isSafeFileName(entry.name)) {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        const stat = await fs.stat(fullPath);

        files.push({
          name: entry.name,
          folder: folderName,
          size: stat.size,
          mtime: Math.floor(stat.mtimeMs / 1000),
          previewableText: isPreviewableTextName(entry.name),
        });
      }
    } catch (e) {
      console.error(`Failed to scan ${folderName}:`, e.message);
    }
  }

  await scanFolder(getUserDropDir(), "user_drops");
  await scanFolder(getAgentDropDir(), "agent_drops");

  files.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
  return files;
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

export function isPreviewableTextName(name) {
  const ext = path.extname(name || "").toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}
