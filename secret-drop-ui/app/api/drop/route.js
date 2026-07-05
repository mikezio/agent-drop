import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import {
  getDropDir,
  getUserDropDir,
  getAgentDropDir,
  isSafeFileName,
  ensureDropDir,
  listDropFiles,
  fileExists,
} from "../../../lib/drop.js";
import { emitDropEvent } from "../../../lib/events.js";

const WRITE_MODE = 0o660;
const META_FILE = ".agent-drop-meta.json";

function metaKey(folder, filename) {
  return `${folder}/${filename}`;
}

function makeSafeFileName(raw) {
  return (raw || "")
    .replace(/[^A-Za-z0-9._-]+/g, "")
    .slice(0, 120);
}

async function normalizeOwnershipAndMode(filePath) {
  const dirStat = await fs.stat(getDropDir());
  await fs.chmod(filePath, WRITE_MODE);
  await fs.chown(filePath, dirStat.uid, dirStat.gid);
}

function metaPath() {
  return path.join(getDropDir(), META_FILE);
}

async function readMeta() {
  try {
    const raw = await fs.readFile(metaPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

async function writeMeta(meta) {
  const p = metaPath();
  await fs.writeFile(p, JSON.stringify(meta, null, 2), { mode: WRITE_MODE });
  await normalizeOwnershipAndMode(p);
}

async function uniquePath(baseName, targetFolder = "user") {
  const dir = targetFolder === "agent" ? getAgentDropDir() : getUserDropDir();
  const safe = makeSafeFileName(baseName) || `upload_${Date.now()}`;
  const ext = path.extname(safe);
  const stem = path.basename(safe, ext) || "upload";

  let candidate = safe;
  let idx = 1;

  while (await fileExists(path.join(dir, candidate))) {
    candidate = `${stem}_${idx}${ext}`;
    idx += 1;
  }

  return path.join(dir, candidate);
}

function formatTimestamp() {
  const now = new Date();
  const p = (n) => `${n}`.padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

export async function GET(request) {
  try {
    const files = await listDropFiles();
    const meta = await readMeta();

    const withMeta = files.map((f) => ({
      ...f,
      sizeBytes: f.size,
      modifiedAt: f.mtime ? f.mtime * 1000 : null,
      status: (meta?.[metaKey(f.folder, f.name)] || meta?.[f.name])?.status || (f.folder === "user_drops" ? "unread" : "new"),
      source: (meta?.[metaKey(f.folder, f.name)] || meta?.[f.name])?.source || null,
      actor: (meta?.[metaKey(f.folder, f.name)] || meta?.[f.name])?.actor || null,
      agentName: (meta?.[metaKey(f.folder, f.name)] || meta?.[f.name])?.agentName || null,
      droppedAt: (meta?.[metaKey(f.folder, f.name)] || meta?.[f.name])?.droppedAt || null,
      updatedAt: (meta?.[metaKey(f.folder, f.name)] || meta?.[f.name])?.updatedAt || null,
    }));

    return NextResponse.json({ files: withMeta });
  } catch (error) {
    return NextResponse.json({ error: `Failed to list files: ${error.message}` }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await ensureDropDir();

    const formData = await request.formData();
    const secret = typeof formData.get("secret") === "string" ? String(formData.get("secret")).trim() : "";
    const uploads = formData.getAll("secret_file");
    const burnMode = formData.get("burn_after_reading") === "true";

    if (!secret && !uploads.length) {
      return NextResponse.json({ error: "Upload text or one file." }, { status: 400 });
    }

    const actor = request.headers.get("x-agent-drop-actor") || "unknown";

    const written = [];
    const filesToEmit = [];

    if (secret) {
      const timestamp = formatTimestamp();
      const name = `secret_${timestamp}${burnMode ? ".burn" : ".txt"}`;
      const dest = await uniquePath(name, "user");
      await fs.writeFile(dest, secret, { mode: WRITE_MODE });
      await normalizeOwnershipAndMode(dest);
      const stat = await fs.stat(dest);
      written.push({
        name: path.basename(dest),
        size: stat.size,
      });
      filesToEmit.push({
        name: path.basename(dest),
        size: stat.size,
      });
    }

    for (const item of uploads) {
      if (typeof item === "string") {
        continue;
      }

      let name = isSafeFileName(item.name || "") ? item.name : `upload_${Date.now()}`;

      const buffer = Buffer.from(await item.arrayBuffer());
      const dest = await uniquePath(name, "user");
      await fs.writeFile(dest, buffer, { mode: WRITE_MODE });
      await normalizeOwnershipAndMode(dest);
      const stat = await fs.stat(dest);
      written.push({
        name: path.basename(dest),
        size: stat.size,
      });

      filesToEmit.push({
        name: path.basename(dest),
        size: stat.size,
      });
    }

    if (written.length) {
      const meta = await readMeta();
      for (const item of written) {
        meta[metaKey("user_drops", item.name)] = {
          actor,
          status: "unread",
          updatedAt: Date.now(),
        };
      }
      await writeMeta(meta);
    }

    let eventResult = null;
    if (filesToEmit.length > 0) {
        eventResult = await emitDropEvent(
          "upload",
          {
            count: filesToEmit.length,
            written: filesToEmit,
          },
          { actor },
        );
    }

    return NextResponse.json({
      ok: true,
      message: `Saved ${written.length} file(s).`,
      written,
      files: (await listDropFiles()).filter((f) => f && f.name),
      event: eventResult,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Upload failed: ${error.message}` },
      { status: 500 },
    );
  }
}
