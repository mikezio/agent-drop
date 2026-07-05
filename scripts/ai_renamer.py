import os
import json
import time
import subprocess
import re

DROP_DIR = os.environ.get("AGENT_DROP_DIR", "./data/agent-drop")
EVENT_LOG = os.path.join(DROP_DIR, ".events.ndjson")
META_FILE = os.path.join(DROP_DIR, ".agent-drop-meta.json")
SCHEMA_FILE = "/tmp/agent_schema.json"

# Write the strict JSON schema that Agent will adhere to
with open(SCHEMA_FILE, "w") as f:
    json.dump({
        "type": "object",
        "properties": {"suggested_filename": {"type": "string"}},
        "required": ["suggested_filename"],
        "additionalProperties": False
    }, f)

def update_meta_status(filename, status_text):
    if os.path.exists(META_FILE):
        try:
            with open(META_FILE, 'r') as f:
                meta = json.load(f)
            if filename not in meta:
                meta[filename] = {}
            meta[filename]["status"] = status_text
            with open(META_FILE, 'w') as f:
                json.dump(meta, f, indent=2)
        except Exception as e:
            print(f"Error updating meta for {filename}: {e}")

def process_upload(file_name):
    # Wait to ensure the web server has fully closed and written the file
    time.sleep(2)
    file_path = os.path.join(DROP_DIR, file_name)
    if not os.path.exists(file_path):
        print(f"Skipping {file_name}: File no longer exists on disk.")
        return

    print(f"Analyzing {file_name} with Agent...")
    update_meta_status(file_name, "analyzing")
    prompt = f"Review the full contents of the file {file_path} to understand its true nature. Generate a highly accurate, concise, and descriptive filename that reflects its TRUE nature, contents, or title. Do NOT guess or assume generic names like 'payslip' unless the document explicitly supports it. The filename must be snake_case or kebab-case, strictly include the correct file extension, and contain no spaces, quotes, or markdown."

    try:
        # Use agent exec to directly inspect the file, passing -c 'mcp_servers={}' to disable MCP overhead
        # and --disable plugins to prevent any other agent tools from slowing down the execution.
        cmd = [
            os.environ.get("AGENT_DROP_AGENT_BIN", "agent"), "exec",
            "-m", os.environ.get("AGENT_DROP_RENAMER_MODEL", "gpt-5.4-mini"),
            "--skip-git-repo-check",
            "--disable", "plugins",
            "-c", "mcp_servers={}",
            "--output-schema", SCHEMA_FILE,
            prompt
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        # Agent outputs the JSON structure at the very end of its execution logs
        output = result.stdout.strip()

        # Find the JSON block in the output
        json_match = re.search(r'\{.*"suggested_filename".*\}', output, re.DOTALL)
        if not json_match:
            print(f"Invalid AI response. Output was:\n{output}\nStderr:\n{result.stderr}")
            update_meta_status(file_name, "failed")
            return

        data = json.loads(json_match.group(0))
        suggested = data.get("suggested_filename", "")
        suggested = re.sub(r'^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$', '', suggested)

        if suggested and "." in suggested and re.match(r'^[A-Za-z0-9._-]+$', suggested):
            new_path = os.path.join(DROP_DIR, suggested)
            if not os.path.exists(new_path) and file_name != suggested:
                try:
                    os.rename(file_path, new_path)
                    print(f"Renamed: {file_name} -> {suggested}")

                    if os.path.exists(META_FILE):
                        with open(META_FILE, 'r') as f:
                            meta = json.load(f)
                        if file_name in meta:
                            meta[suggested] = meta.pop(file_name)
                        else:
                            meta[suggested] = {}
                        meta[suggested]["status"] = "renamed"
                        with open(META_FILE, 'w') as f:
                            json.dump(meta, f, indent=2)
                except FileNotFoundError:
                    print(f"Error: {file_name} was deleted before we could rename it.")
            else:
                print(f"Skipped rename: {suggested} already exists or is same name.")
                update_meta_status(file_name, "processed")
        else:
            print(f"Invalid AI name suggestion: '{suggested}'")
            update_meta_status(file_name, "failed")
    except subprocess.TimeoutExpired:
        print(f"Timeout while analyzing {file_name}")
        update_meta_status(file_name, "timeout")
    except Exception as e:
        print(f"Failed to process {file_name}: {e}")
        update_meta_status(file_name, "error")

def watch():
    print(f"Watching {EVENT_LOG} for new uploads...")
    if not os.path.exists(EVENT_LOG):
        open(EVENT_LOG, 'a').close()

    with open(EVENT_LOG, 'r') as f:
        f.seek(0, os.SEEK_END)
        while True:
            line = f.readline()
            if not line:
                time.sleep(1)
                continue

            try:
                event = json.loads(line)
                if event.get("eventType") == "upload" and event.get("actor", "").startswith("human"):
                    for f_info in event.get("details", {}).get("written", []):
                        if f_info.get("name"):
                            process_upload(f_info["name"])
            except json.JSONDecodeError:
                pass

if __name__ == "__main__":
    watch()
