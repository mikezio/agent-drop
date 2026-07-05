#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const defaultDropDir = path.join(repoRoot, "data", "agent-drop");

function normalizeBasePath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

async function ask(rl, question, fallback) {
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || fallback || "";
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  return result.status === 0;
}

function codexSnippet(mcpCommand, dropDir) {
  return `[mcp_servers.agent-drop]
command = "${mcpCommand}"
env = { AGENT_DROP_DIR = "${dropDir}" }`;
}

function jsonSnippet(mcpCommand, dropDir) {
  return JSON.stringify(
    {
      mcpServers: {
        "agent-drop": {
          command: mcpCommand,
          env: {
            AGENT_DROP_DIR: dropDir,
          },
        },
      },
    },
    null,
    2,
  );
}

async function main() {
  const rl = readline.createInterface({ input, output });

  try {
    console.log("Agent Drop guided setup\n");
    const dropDir = path.resolve(await ask(rl, "Shared drop directory", defaultDropDir));
    const host = await ask(rl, "Web bind host", "127.0.0.1");
    const port = await ask(rl, "Web port", "8400");
    const basePath = normalizeBasePath(await ask(rl, "Base path for reverse proxy, blank for none", ""));

    await fs.mkdir(path.join(dropDir, "user_drops"), { recursive: true });
    await fs.mkdir(path.join(dropDir, "agent_drops"), { recursive: true });

    const envText = [
      `AGENT_DROP_DIR=${dropDir}`,
      `AGENT_DROP_HOST=${host}`,
      `AGENT_DROP_PORT=${port}`,
      `NEXT_PUBLIC_BASE_PATH=${basePath}`,
      "NEXT_TELEMETRY_DISABLED=1",
      "",
    ].join("\n");
    await fs.writeFile(path.join(repoRoot, ".env"), envText, { mode: 0o600 });

    const mcpCommand = path.join(repoRoot, "mcp", "run.sh");
    console.log("\nInstalling MCP dependencies...");
    const installed = run("npm", ["install"], path.join(repoRoot, "mcp"));
    if (!installed) {
      console.error("\nMCP dependency install failed. Run `npm install` in the `mcp` directory after fixing npm.");
    }

    console.log("\nDone. Start the web UI with:");
    console.log("  docker compose up -d --build");
    console.log(`  open http://${host === "0.0.0.0" ? "localhost" : host}:${port}${basePath || "/"}`);

    console.log("\nCodex config snippet:");
    console.log(codexSnippet(mcpCommand, dropDir));

    console.log("\nGeneric MCP JSON snippet for Gemini CLI, Claude Code, and similar CLI clients:");
    console.log(jsonSnippet(mcpCommand, dropDir));

    console.log("\nThe important rule is that every agent client points to the same MCP command and AGENT_DROP_DIR.");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
