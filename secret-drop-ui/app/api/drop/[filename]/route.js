import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getDropDir, isSafeFileName, resolveFilePath } from "../../../../lib/drop.js";
import { emitDropEvent } from "../../../../lib/events.js";

const MAX_PREVIEW_BYTES = 64 * 1024;
const MAX_PREVIEW_FILE_BYTES = 2 * 1024 * 1024;
const WRITE_MODE = 0o660;
const META_FILE = ".agent-drop-meta.json";

function metaKey(folder, filename) {
  return `${folder}/${filename}`;
}

function requestedFolder(request) {
  const folder = new URL(request.url).searchParams.get("folder");
  return folder === "user_drops" || folder === "agent_drops" ? folder : null;
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
  const dirStat = await fs.stat(getDropDir());
  const p = metaPath();
  await fs.writeFile(p, JSON.stringify(meta, null, 2), { mode: WRITE_MODE });
  await fs.chmod(p, WRITE_MODE);
  await fs.chown(p, dirStat.uid, dirStat.gid);
}

function sanitizeHeaderFilename(name) {
  return name.replace(/[\r\n]/g, "");
}

function guessContentType(name) {
  const ext = path.extname(name || "").toLowerCase();
  switch (ext) {
    case ".txt":
    case ".log":
    case ".md":
    case ".csv":
    case ".ini":
    case ".cfg":
    case ".conf":
    case ".env":
      return "text/plain; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".yaml":
    case ".yml":
      return "application/x-yaml; charset=utf-8";
    case ".xml":
      return "application/xml; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".ts":
      return "text/plain; charset=utf-8";
    case ".py":
    case ".sh":
    case ".sql":
      return "text/plain; charset=utf-8";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".bmp":
      return "image/bmp";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".m4v":
      return "video/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    case ".m4a":
      return "audio/mp4";
    default:
      return "application/octet-stream";
  }
}

async function guessInlineContentType(filePath, name) {
  const guessed = guessContentType(name);
  if (guessed !== "application/octet-stream") {
    return guessed;
  }

  try {
    const preview = await readPreview(filePath);
    if (!preview.binary) {
      return "text/plain; charset=utf-8";
    }
  } catch (_error) {
    // Fall back to octet-stream when type sniffing fails.
  }
  return "application/octet-stream";
}

async function readPreview(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (stat.size > MAX_PREVIEW_FILE_BYTES) {
      return { tooLarge: true, size: stat.size };
    }

    const readLength = Math.min(stat.size, MAX_PREVIEW_BYTES);
    const buffer = Buffer.alloc(readLength);
    await handle.read(buffer, 0, readLength, 0);

    if (buffer.includes(0)) {
      return { binary: true, size: stat.size };
    }

    const text = buffer.toString("utf8");
    return {
      text,
      size: stat.size,
      truncated: stat.size > readLength,
    };
  } finally {
    await handle.close();
  }
}

export async function GET(request, { params }) {
  try {
    const filename = params?.filename || "";
    if (!isSafeFileName(filename)) {
      return NextResponse.json({ error: "Invalid filename." }, { status: 400 });
    }

    const folder = requestedFolder(request);
    const filePath = await resolveFilePath(filename, folder);

    const url = new URL(request.url);
    if (url.searchParams.get("view") === "1") {
      const preview = await readPreview(filePath);
      if (preview.tooLarge) {
        return NextResponse.json(
          { error: "File is too large to preview.", size: preview.size },
          { status: 413 },
        );
      }
      if (preview.binary) {
        return NextResponse.json({ error: "File looks binary and is not previewable." }, { status: 400 });
      }

      return NextResponse.json({
        name: filename,
        size: preview.size,
        truncated: preview.truncated,
        text: preview.text,
      });
    }

    const data = await fs.readFile(filePath);
    const wantsInline = url.searchParams.get("inline") === "1";
    const contentType = wantsInline
      ? await guessInlineContentType(filePath, filename)
      : "application/octet-stream";
    const dispositionType = wantsInline ? "inline" : "attachment";

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${dispositionType}; filename="${sanitizeHeaderFilename(filename)}"`,
      },
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const filename = params?.filename || "";
    if (!isSafeFileName(filename)) {
      return NextResponse.json({ error: "Invalid filename." }, { status: 400 });
    }

    const body = await request.json();
    const newStatus = body.status;

    if (!newStatus) {
      return NextResponse.json({ error: "Status is required." }, { status: 400 });
    }

    const folder = requestedFolder(request) || "user_drops";
    const key = metaKey(folder, filename);
    const meta = await readMeta();
    if (!meta[key]) {
      meta[key] = meta[filename] || {};
    }
    meta[key].status = newStatus;
    meta[key].updatedAt = Date.now();
    await writeMeta(meta);

    return NextResponse.json({ ok: true, filename, folder, status: newStatus });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const filename = params?.filename || "";
    if (!isSafeFileName(filename)) {
      return NextResponse.json({ error: "Invalid filename." }, { status: 400 });
    }

    const folder = requestedFolder(request);
    const filePath = await resolveFilePath(filename, folder);
    await fs.unlink(filePath);

    const meta = await readMeta();
    const key = folder ? metaKey(folder, filename) : null;
    if (key && meta[key]) {
      delete meta[key];
      await writeMeta(meta);
    } else if (meta[filename]) {
      delete meta[filename];
      await writeMeta(meta);
    }
    const actor = request.headers.get("x-agent-drop-actor") || "unknown";
    const eventResult = await emitDropEvent(
      "delete",
      {
        deleted: filename,
      },
      { actor },
    );
    return NextResponse.json({ ok: true, deleted: filename, event: eventResult });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
