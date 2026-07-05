import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";

const DROP_DIR = path.resolve(process.env.AGENT_DROP_DIR || path.join(process.cwd(), "data"));
const USER_DROPS_DIR = path.join(DROP_DIR, "user_drops");
const AGENT_DROPS_DIR = path.join(DROP_DIR, "agent_drops");
const META_FILE = path.join(DROP_DIR, ".agent-drop-meta.json");
const SAFE_NAME_RE = /^[A-Za-z0-9._-]+$/;

const server = new Server(
  { name: "agent-drop", version: "1.0.0" },
  { capabilities: { tools: { listChanged: true } } }
);

async function readMeta() {
  await ensureDropDirs();
  try {
    const data = await fs.readFile(META_FILE, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

async function writeMeta(meta) {
  await ensureDropDirs();
  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2), { mode: 0o660 });
}

async function ensureDropDirs() {
  await fs.mkdir(USER_DROPS_DIR, { recursive: true });
  await fs.mkdir(AGENT_DROPS_DIR, { recursive: true });
}

function sanitizeFileName(name, fallbackPrefix = "drop") {
  const base = path.basename(String(name || ""))
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);

  if (!base || !SAFE_NAME_RE.test(base) || base === "." || base === "..") {
    return `${fallbackPrefix}_${Date.now()}.txt`;
  }

  return base;
}

async function uniquePath(dir, requestedName, fallbackPrefix = "drop") {
  const safe = sanitizeFileName(requestedName, fallbackPrefix);
  const ext = path.extname(safe);
  const stem = path.basename(safe, ext) || fallbackPrefix;
  let candidate = safe;
  let index = 1;

  while (true) {
    const fullPath = path.join(dir, candidate);
    try {
      await fs.access(fullPath);
      candidate = `${stem}_${index}${ext}`;
      index += 1;
    } catch (_error) {
      return { fullPath, name: candidate };
    }
  }
}

function buildAgentMeta(existing = {}, overrideAgentName = null) {
  const now = Date.now();
  return {
    ...existing,
    status: "new",
    source: "agent",
    agentName: overrideAgentName,
    droppedAt: now,
    updatedAt: now,
  };
}

function metaKey(folder, filename) {
  return `${folder}/${filename}`;
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_unread_uploads",
      description: "Call this immediately when the user says they 'uploaded', 'sent', or 'dropped' a file/screenshot to you. It checks the drop folder and returns the absolute file paths of any files the user recently uploaded that you haven't processed yet. NOTE: Calling this tool AUTOMATICALLY marks the returned files as 'read', so they won't clutter your future queries. You can optionally filter by how recently the file was uploaded.",
      inputSchema: {
        type: "object",
        properties: {
          minutes_ago: {
            type: "number",
            description: "Optional. Only return unread files uploaded within the last X minutes. If omitted, returns all unread files."
          }
        }
      }
    },
    {
      name: "list_all_uploads",
      description: "Returns a list of ALL files the user has ever uploaded to the dropzone (both read and unread), along with their upload timestamps. Use this if you need to find an older reference file or if get_unread_uploads didn't return what you were looking for.",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "deliver_to_user_device",
      description: "PRIMARY DELIVERY TOOL: Use this for ALL documents, reports, and generated files. 1) Write your content to a temporary file in the workspace. 2) Call this tool with the absolute path. This is the most token-efficient way to deliver large artifacts. You MUST specify your agent_name (e.g., 'Gemini', 'Codex') so the user knows who delivered the file.",
      inputSchema: {
        type: "object",
        properties: {
          local_paths: {
            type: "array",
            items: { type: "string" },
            description: "Absolute paths to the files on your local file system that you want to deliver."
          },
          agent_name: {
            type: "string",
            description: "REQUIRED: The name of the agent delivering the file (e.g., 'Gemini', 'Codex')."
          }
        },
        required: ["local_paths", "agent_name"]
      }
    },
    {
      name: "generate_and_deliver_file",
      description: "TINY SNIPPET DELIVERY: Use ONLY for very short text snippets (< 500 characters). For anything longer, you MUST write to a file first and use `deliver_to_user_device` to avoid bloating the conversation history with raw text. You MUST specify your agent_name (e.g., 'Gemini', 'Codex') so the user knows who delivered the file.",
      inputSchema: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "The name of the file to create (e.g., 'overview.md', 'report.txt')."
          },
          content: {
            type: "string",
            description: "The raw text or code content of the file."
          },
          agent_name: {
            type: "string",
            description: "REQUIRED: The name of the agent delivering the file (e.g., 'Gemini', 'Codex')."
          }
        },
        required: ["filename", "content", "agent_name"]
      }
    },
    {
      name: "delete_specific_drop",
      description: "Delete a specific file from the dropzone. Use this to clean up temporary files you requested from the user but no longer need, keeping their web UI tidy.",
      inputSchema: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "The name of the file to delete (e.g., 'sketch.png' or 'upload_123.txt'). You can provide the absolute path or just the filename."
          }
        },
        required: ["filename"]
      }
    },
    {
      name: "clear_drops",
      description: "Wipes the drop folders clean. Use this when you are starting a fresh project and want to clear out all old contextual screenshots and logs.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            enum: ["user", "agent", "all"],
            description: "Which drops to clear. Usually 'all'."
          }
        },
        required: ["target"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    await ensureDropDirs();
    switch (request.params.name) {

      case "get_unread_uploads": {
        const { minutes_ago } = request.params.arguments || {};
        const meta = await readMeta();
        try {
          const files = await fs.readdir(USER_DROPS_DIR);
          const unreadItems = [];
          const burnedFiles = [];
          let metaUpdated = false;
          const now = Date.now();

          const textExtensions = new Set([".txt", ".md", ".json", ".js", ".py", ".html", ".css", ".sh", ".yaml", ".yml", ".csv"]);

          for (const file of files) {
            if (file.startsWith(".")) continue;

            const fullPath = path.join(USER_DROPS_DIR, file);

            // Handle auto-shredding of secure .burn files instantly
            if (file.endsWith(".burn")) {
                const content = await fs.readFile(fullPath, "utf-8");
                unreadItems.push({ file: fullPath, content: content, type: "secure_note", note: "This is a secure one-time-read note. It has been permanently destroyed from disk." });
                await fs.unlink(fullPath);
                burnedFiles.push(file);
                metaUpdated = true;
                continue;
            }

            const key = metaKey("user_drops", file);
            const fileMeta = meta[key] || meta[file] || {};
            const fileStatus = fileMeta.status || "unread";

            if (fileStatus === "unread") {
              // Apply optional time filtering
              if (minutes_ago && fileMeta.updatedAt) {
                 const diffMinutes = (now - fileMeta.updatedAt) / (1000 * 60);
                 if (diffMinutes > minutes_ago) {
                    continue;
                 }
              }

              // Determine if we should inject text content or just provide the path
              const ext = path.extname(file).toLowerCase();
              const stat = await fs.stat(fullPath);
              let itemData = { path: fullPath, type: "binary_or_image", size_bytes: stat.size };

              if (textExtensions.has(ext) && stat.size < 100 * 1024) { // Under 100kb
                  try {
                     const content = await fs.readFile(fullPath, "utf-8");
                     itemData = { path: fullPath, type: "text", content: content };
                  } catch (e) {
                     // Fallback to path if read fails
                  }
              } else if (ext.match(/\.(png|jpg|jpeg|gif|webp)$/)) {
                  itemData.type = "image";
                  itemData.instruction = "Pass this absolute path to your native vision/image analysis tool to view it.";
              }

              unreadItems.push(itemData);

              // Automatically mark as read
              if (!meta[key]) meta[key] = meta[file] || {};
              meta[key].status = "read";
              meta[key].updatedAt = now;
              metaUpdated = true;
            }
          }

          if (burnedFiles.length > 0) {
             for (const b of burnedFiles) {
               delete meta[metaKey("user_drops", b)];
               delete meta[b];
             }
          }

          if (metaUpdated) {
             await writeMeta(meta);
          }

          if (unreadItems.length === 0) {
             return { content: [{ type: "text", text: "No unread uploads found matching your criteria." }] };
          }

          return { content: [{ type: "text", text: `Found unread uploads. They have automatically been marked as 'read'.\n${JSON.stringify(unreadItems, null, 2)}` }] };
        } catch (e) {
          return { isError: true, content: [{ type: "text", text: `Error reading user_drops: ${e.message}` }] };
        }
      }

      case "list_all_uploads": {
        try {
          const meta = await readMeta();
          const files = await fs.readdir(USER_DROPS_DIR);
          const allFiles = [];

          for (const file of files) {
            if (file.startsWith(".") || file.endsWith(".burn")) continue;
            const fullPath = path.join(USER_DROPS_DIR, file);
            const stats = await fs.stat(fullPath);
            const fileStatus = (meta[metaKey("user_drops", file)] || meta[file])?.status || "unread";

            allFiles.push({
               file: fullPath,
               status: fileStatus,
               uploaded_at: new Date(stats.mtime).toISOString()
            });
          }

          if (allFiles.length === 0) {
             return { content: [{ type: "text", text: "The user dropzone is currently empty." }] };
          }

          return { content: [{ type: "text", text: `All uploaded files in the dropzone:\n${JSON.stringify(allFiles, null, 2)}` }] };
        } catch (e) {
          return { isError: true, content: [{ type: "text", text: `Error reading user_drops: ${e.message}` }] };
        }
      }

      case "deliver_to_user_device": {
        const { local_paths: paths, agent_name } = request.params.arguments;
        const delivered = [];

        for (const p of paths) {
           try {
             const sourcePath = path.resolve(String(p || ""));
             const filename = path.basename(sourcePath);
             const { fullPath: dest, name: deliveredName } = await uniquePath(AGENT_DROPS_DIR, filename, "agent_file");
             await fs.copyFile(sourcePath, dest);
             await fs.chmod(dest, 0o660);
             delivered.push(deliveredName);
           } catch (e) {
             console.error(`Failed to deliver ${p}: ${e.message}`);
           }
        }

        if (delivered.length > 0) {
           const meta = await readMeta();
           for (const f of delivered) {
              const key = metaKey("agent_drops", f);
              meta[key] = buildAgentMeta(meta[key] || meta[f], agent_name);
           }
           await writeMeta(meta);
        }

        return { content: [{ type: "text", text: `Successfully delivered ${delivered.length} files to the user's web dashboard: ${delivered.join(', ')}` }] };
      }

      case "generate_and_deliver_file": {
        const { filename, content, agent_name } = request.params.arguments;
        try {
          const { fullPath: dest, name: deliveredName } = await uniquePath(AGENT_DROPS_DIR, filename, "agent_note");
          await fs.writeFile(dest, content, { mode: 0o660 });

          const meta = await readMeta();
          const key = metaKey("agent_drops", deliveredName);
          meta[key] = buildAgentMeta(meta[key] || meta[deliveredName], agent_name);
          await writeMeta(meta);

          return { content: [{ type: "text", text: `Successfully created and delivered ${deliveredName} to the user's web dashboard.` }] };
        } catch (e) {
          return { isError: true, content: [{ type: "text", text: `Error generating file: ${e.message}` }] };
        }
      }

      case "delete_specific_drop": {
        const { filename } = request.params.arguments;
        const nameOnly = sanitizeFileName(filename, "drop");

        let deletedPath = null;
        for (const dir of [USER_DROPS_DIR, AGENT_DROPS_DIR]) {
            const testPath = path.join(dir, nameOnly);
            try {
                await fs.access(testPath);
                await fs.unlink(testPath);
                deletedPath = testPath;
                break;
            } catch (e) {}
        }

        if (deletedPath) {
            const meta = await readMeta();
            const folder = deletedPath.startsWith(AGENT_DROPS_DIR) ? "agent_drops" : "user_drops";
            const key = metaKey(folder, nameOnly);
            if (meta[key] || meta[nameOnly]) {
               delete meta[key];
               delete meta[nameOnly];
               await writeMeta(meta);
            }
            return { content: [{ type: "text", text: `Successfully deleted ${nameOnly} from the dropzone.` }] };
        } else {
            return { isError: true, content: [{ type: "text", text: `Error: File ${nameOnly} not found in the dropzone.` }] };
        }
      }

      case "clear_drops": {
        const target = request.params.arguments.target;
        const toClear = [];
        if (target === "user" || target === "all") toClear.push(USER_DROPS_DIR);
        if (target === "agent" || target === "all") toClear.push(AGENT_DROPS_DIR);

        let deletedCount = 0;
        for (const dir of toClear) {
           try {
             const files = await fs.readdir(dir);
             for (const f of files) {
                if (f.startsWith(".")) continue;
                await fs.unlink(path.join(dir, f));
                deletedCount++;
             }
           } catch (e) {}
        }

        const meta = await readMeta();
        for (const key in meta) delete meta[key];
        await writeMeta(meta);

        return { content: [{ type: "text", text: `Cleared ${deletedCount} files from the dropzone.` }] };
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: `Internal server error: ${error.message}` }]
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Agent-Drop MCP server running on stdio");
