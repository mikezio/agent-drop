import fs from "node:fs/promises";
import path from "node:path";

import { getDropDir } from "./drop.js";

const EVENT_FILE_NAME = ".last-event.json";
const EVENT_LOG_FILE_NAME = ".events.ndjson";

async function writeLastEventFile(eventPayload) {
  const dropDir = getDropDir();
  const fullPath = path.join(dropDir, EVENT_FILE_NAME);
  const text = `${JSON.stringify(eventPayload, null, 2)}\n`;
  await fs.writeFile(fullPath, text, { mode: 0o600 });
}

async function appendEventLog(eventPayload) {
  const dropDir = getDropDir();
  const fullPath = path.join(dropDir, EVENT_LOG_FILE_NAME);
  await fs.appendFile(fullPath, `${JSON.stringify(eventPayload)}\n`, { mode: 0o600 });
}

export async function emitDropEvent(eventType, details, context = {}) {
  const payload = {
    source: "agent-drop",
    eventType,
    occurredAt: new Date().toISOString(),
    actor: context.actor || "unknown",
    details: details || {},
  };

  try {
    await writeLastEventFile(payload);
  } catch (_error) {
    // Event file is best-effort only.
  }

  try {
    await appendEventLog(payload);
  } catch (_error) {
    // Event log is best-effort only.
  }

  return { delivered: 0, attempted: 0 };
}
