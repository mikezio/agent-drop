#!/usr/bin/env python3
"""
Smart retention cleanup for an Agent Drop directory.

Behavior:
- normalizes directory/file ownership and modes so the web app can read files
- removes stale metadata entries
- prunes files by source-aware retention windows
- enforces max file count / max bytes as a safety backstop
"""

from __future__ import annotations

import argparse
import grp
import json
import os
import pwd
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional


GENERATED_RE = re.compile(
    r"^(agent-drop-|preview-|render-|ui-pass-).*\.(png|jpe?g|webp|gif)$",
    re.IGNORECASE,
)
LEGACY_HIDDEN_FILES = (".notify-log.ndjson", ".notify-state.json")


@dataclass
class DropFile:
    name: str
    path: Path
    size: int
    mtime: float
    source: str
    generated: bool
    protected: bool = False
    delete_reason: Optional[str] = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Clean up Agent Drop files.")
    parser.add_argument("--drop-dir", default=os.environ.get("AGENT_DROP_DIR", "./data/agent-drop"))
    parser.add_argument("--meta-file", default=".agent-drop-meta.json")
    parser.add_argument("--log-file", default=".cleanup-log.ndjson")
    parser.add_argument("--owner-user", default="")
    parser.add_argument("--owner-group", default="")
    parser.add_argument("--dir-mode", default="2770", help="Octal directory mode")
    parser.add_argument("--file-mode", default="660", help="Octal file mode")
    parser.add_argument("--human-retention-days", type=int, default=14)
    parser.add_argument("--agent-retention-days", type=int, default=7)
    parser.add_argument("--unknown-retention-days", type=int, default=10)
    parser.add_argument("--generated-retention-hours", type=int, default=36)
    parser.add_argument("--keep-recent-human", type=int, default=10)
    parser.add_argument("--keep-recent-other", type=int, default=10)
    parser.add_argument("--min-age-minutes", type=int, default=30)
    parser.add_argument("--max-files", type=int, default=120)
    parser.add_argument("--max-bytes", type=int, default=512 * 1024 * 1024)
    parser.add_argument(
        "--delete-all-visible",
        action="store_true",
        help="Delete every non-hidden file (one-time reset mode).",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def resolve_identity(user_name: str, group_name: str) -> tuple[int, int]:
    if not user_name and not group_name:
        return os.getuid(), os.getgid()
    if not user_name:
        user_name = pwd.getpwuid(os.getuid()).pw_name
    if not group_name:
        group_name = grp.getgrgid(os.getgid()).gr_name
    try:
        uid = pwd.getpwnam(user_name).pw_uid
    except KeyError:
        raise RuntimeError(f"Unknown user: {user_name}") from None
    try:
        gid = grp.getgrnam(group_name).gr_gid
    except KeyError:
        raise RuntimeError(f"Unknown group: {group_name}") from None
    return uid, gid


def read_meta(meta_path: Path) -> Dict[str, Dict[str, object]]:
    try:
        raw = meta_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    except OSError:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def write_meta(
    meta_path: Path,
    meta: Dict[str, Dict[str, object]],
    uid: int,
    gid: int,
    file_mode: int,
    dry_run: bool,
) -> None:
    if dry_run:
        return
    meta_path.write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(meta_path, file_mode)
    os.chown(meta_path, uid, gid)


def append_log(log_path: Path, payload: Dict[str, object], dry_run: bool) -> None:
    if dry_run:
        return
    line = json.dumps(payload, separators=(",", ":"))
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def classify_source(name: str, meta_entry: Dict[str, object]) -> tuple[str, bool]:
    source = str(meta_entry.get("source", "")).strip().lower()
    actor = str(meta_entry.get("actor", "")).strip().lower()

    if source == "human" or actor.startswith("human"):
        kind = "human"
    elif source in {"agent", "assistant"} or actor.startswith(("agent", "assistant")):
        kind = "agent"
    elif name.startswith("secret_"):
        kind = "human"
    elif name.startswith(("agent-drop-", "render-", "preview-")):
        kind = "agent"
    else:
        kind = "unknown"

    generated = bool(GENERATED_RE.match(name))
    return kind, generated


def retention_seconds(entry: DropFile, args: argparse.Namespace) -> int:
    if entry.source == "human":
        seconds = args.human_retention_days * 86400
    elif entry.source == "agent":
        seconds = args.agent_retention_days * 86400
    else:
        seconds = args.unknown_retention_days * 86400

    if entry.generated:
        generated_seconds = args.generated_retention_hours * 3600
        seconds = min(seconds, generated_seconds)
    return seconds


def normalize_path(path: Path, uid: int, gid: int, mode: int, dry_run: bool) -> Optional[str]:
    try:
        if not dry_run:
            os.chmod(path, mode)
            os.chown(path, uid, gid)
    except PermissionError:
        return f"permission-denied:{path.name}"
    except FileNotFoundError:
        return f"missing:{path.name}"
    except OSError as exc:
        return f"oserror:{path.name}:{exc}"
    return None


def collect_files(
    drop_dir: Path,
    meta: Dict[str, Dict[str, object]],
) -> List[DropFile]:
    out: List[DropFile] = []
    for entry in drop_dir.iterdir():
        if entry.name.startswith("."):
            continue
        if not entry.is_file():
            continue
        try:
            stat = entry.stat()
        except FileNotFoundError:
            continue
        kind, generated = classify_source(entry.name, meta.get(entry.name, {}))
        out.append(
            DropFile(
                name=entry.name,
                path=entry,
                size=stat.st_size,
                mtime=stat.st_mtime,
                source=kind,
                generated=generated,
            )
        )
    return out


def protect_recent(files: List[DropFile], args: argparse.Namespace, now_ts: float) -> None:
    grouped: Dict[str, List[DropFile]] = {"human": [], "agent": [], "unknown": []}
    for item in files:
        grouped.setdefault(item.source, []).append(item)

    for source, members in grouped.items():
        members.sort(key=lambda f: (f.mtime, f.name), reverse=True)
        keep_n = args.keep_recent_human if source == "human" else args.keep_recent_other
        for item in members[: max(0, keep_n)]:
            item.protected = True

    min_age_seconds = max(0, args.min_age_minutes) * 60
    for item in files:
        age = now_ts - item.mtime
        if age < min_age_seconds:
            item.protected = True


def mark_age_deletions(files: List[DropFile], args: argparse.Namespace, now_ts: float) -> None:
    for item in files:
        if item.protected:
            continue
        age = now_ts - item.mtime
        if age > retention_seconds(item, args):
            item.delete_reason = "retention"


def enforce_backstops(files: List[DropFile], args: argparse.Namespace) -> None:
    def remaining() -> List[DropFile]:
        return [x for x in files if x.delete_reason is None]

    def remaining_bytes() -> int:
        return sum(x.size for x in remaining())

    def choose_next_candidate(pool: List[DropFile]) -> Optional[DropFile]:
        if not pool:
            return None
        pool.sort(key=lambda x: (x.mtime, x.name))
        return pool[0]

    while len(remaining()) > args.max_files:
        pool = [x for x in remaining() if not x.protected]
        victim = choose_next_candidate(pool) or choose_next_candidate(remaining())
        if victim is None:
            break
        victim.delete_reason = "max-files"

    while remaining_bytes() > args.max_bytes:
        pool = [x for x in remaining() if not x.protected]
        victim = choose_next_candidate(pool) or choose_next_candidate(remaining())
        if victim is None:
            break
        victim.delete_reason = "max-bytes"


def execute_deletes(files: List[DropFile], dry_run: bool) -> tuple[int, int, List[str]]:
    deleted_count = 0
    deleted_bytes = 0
    deleted_names: List[str] = []
    for item in files:
        if item.delete_reason is None:
            continue
        if not dry_run:
            try:
                item.path.unlink()
            except FileNotFoundError:
                continue
        deleted_count += 1
        deleted_bytes += item.size
        deleted_names.append(item.name)
    return deleted_count, deleted_bytes, deleted_names


def prune_meta(meta: Dict[str, Dict[str, object]], existing_names: set[str]) -> int:
    stale = [name for name in meta.keys() if name not in existing_names]
    for name in stale:
        del meta[name]
    return len(stale)


def main() -> int:
    args = parse_args()
    now_ts = time.time()

    drop_dir = Path(args.drop_dir)
    meta_path = drop_dir / args.meta_file
    log_path = drop_dir / args.log_file

    uid, gid = resolve_identity(args.owner_user, args.owner_group)
    dir_mode = int(args.dir_mode, 8)
    file_mode = int(args.file_mode, 8)

    drop_dir.mkdir(parents=True, exist_ok=True)
    normalize_errors: List[str] = []

    err = normalize_path(drop_dir, uid, gid, dir_mode, args.dry_run)
    if err:
        normalize_errors.append(err)

    # Normalize file perms first so unreadable uploads become accessible.
    for path in drop_dir.iterdir():
        if not path.is_file():
            continue
        err = normalize_path(path, uid, gid, file_mode, args.dry_run)
        if err:
            normalize_errors.append(err)

    legacy_hidden_deleted = 0
    for name in LEGACY_HIDDEN_FILES:
        legacy_path = drop_dir / name
        if not legacy_path.exists() or not legacy_path.is_file():
            continue
        if not args.dry_run:
            try:
                legacy_path.unlink()
            except OSError as exc:
                normalize_errors.append(f"legacy-delete-failed:{name}:{exc}")
                continue
        legacy_hidden_deleted += 1

    meta = read_meta(meta_path)
    files = collect_files(drop_dir, meta)
    scanned_count = len(files)
    scanned_bytes = sum(x.size for x in files)

    if args.delete_all_visible:
        for item in files:
            item.delete_reason = "delete-all-visible"
    else:
        protect_recent(files, args, now_ts)
        mark_age_deletions(files, args, now_ts)
        enforce_backstops(files, args)

    deleted_count, deleted_bytes, _deleted_names = execute_deletes(files, args.dry_run)

    remaining_files = collect_files(drop_dir, meta)
    remaining_names = {x.name for x in remaining_files}

    stale_meta_count = prune_meta(meta, remaining_names)

    if stale_meta_count > 0 or (not meta_path.exists() and meta):
        write_meta(meta_path, meta, uid, gid, file_mode, args.dry_run)
    elif meta_path.exists():
        # Keep metadata file ownership/mode healthy even if content did not change.
        err = normalize_path(meta_path, uid, gid, file_mode, args.dry_run)
        if err:
            normalize_errors.append(err)

    payload = {
        "ts": int(now_ts),
        "scanned_files": scanned_count,
        "scanned_bytes": scanned_bytes,
        "deleted_files": deleted_count,
        "deleted_bytes": deleted_bytes,
        "legacy_hidden_deleted": legacy_hidden_deleted,
        "stale_meta_removed": stale_meta_count,
        "dry_run": args.dry_run,
        "normalize_errors": normalize_errors,
    }
    append_log(log_path, payload, args.dry_run)

    print(
        "agent-drop-cleanup",
        f"scanned={scanned_count}",
        f"deleted={deleted_count}",
        f"deleted_bytes={deleted_bytes}",
        f"legacy_hidden_deleted={legacy_hidden_deleted}",
        f"stale_meta_removed={stale_meta_count}",
        f"errors={len(normalize_errors)}",
    )

    if normalize_errors:
        for msg in normalize_errors[:10]:
            print(f"warn: {msg}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
