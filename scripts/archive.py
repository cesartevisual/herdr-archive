#!/usr/bin/env python3
"""Install or remove the Herdr Archive personal layout, using only stdlib."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
MODS = ("archive-sidebar", "archive-menu", "archive-picker", "archive-chrome", "space-archive")
REQUIRED_MODS = ("better-changes", "desktop-notifications", "files-open-with", "hibernate", "live-ports", "my-pane", "my-status", "my-tabs", "resources", "sidebar-nav", "t3-actions", "usage-limits", "project-settings", "my-worktree", "new-worktree")
MANIFEST = ".herdr-archive-install.json"
SCHEMA = 1


class InstallError(Exception):
    pass


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise InstallError(f"Cannot read {path}: {exc}") from exc


def encoded(value) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def safe_file(path: Path) -> None:
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise InstallError(f"Unsafe file: {path}")


def safe_parent(path: Path, home: Path) -> None:
    if not home.is_dir() or home.is_symlink():
        raise InstallError(f"Profile must be an existing real directory: {home}")
    parent = path.parent
    while parent != home:
        if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
            raise InstallError(f"Unsafe parent: {parent}")
        parent = parent.parent


def package_files() -> dict[str, bytes]:
    paths = [ROOT / "layouts" / "archive.json"]
    preview = ROOT / "layouts" / "archive.svg"
    if preview.is_file():
        paths.append(preview)
    for name in MODS:
        folder = ROOT / "mods" / name
        if not folder.is_dir() or folder.is_symlink():
            raise InstallError(f"Missing or unsafe mod folder: {folder}")
        paths.extend(sorted(p for p in folder.rglob("*") if p.is_file() and not p.name.startswith(".") and p.name not in {"gpui-kit.d.ts", "herdr.d.ts", "jsconfig.json"} and "__pycache__" not in p.parts))
        if any(p.is_symlink() for p in folder.rglob("*")):
            raise InstallError(f"Symlink in package: {folder}")
        if folder / "main.js" not in paths:
            raise InstallError(f"Missing main.js: {folder}")
    result = {}
    for path in paths:
        if not path.is_file() or path.is_symlink():
            raise InstallError(f"Missing or unsafe source file: {path}")
        result[str(path.relative_to(ROOT))] = path.read_bytes()
    return result


def load_manifest(home: Path):
    path = home / MANIFEST
    safe_file(path)
    if not path.exists():
        return None
    data = read_json(path)
    if not isinstance(data, dict) or data.get("schema") != SCHEMA or data.get("package") != "herdr-archive" or not isinstance(data.get("files"), dict):
        raise InstallError(f"Unrecognized manifest: {path}")
    return data


def verify_owned(home: Path, manifest: dict) -> None:
    for rel, expected in manifest["files"].items():
        if not isinstance(rel, str) or rel.startswith("/") or ".." in Path(rel).parts or not isinstance(expected, str):
            raise InstallError("Malformed manifest path or hash")
        target = home / rel
        safe_parent(target, home)
        safe_file(target)
        if not target.exists() or digest(target.read_bytes()) != expected:
            raise InstallError(f"Installed file was changed; preserving it: {target}")


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as tmp:
        temp = Path(tmp.name)
        tmp.write(content)
        tmp.flush()
        os.fsync(tmp.fileno())
    try:
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def key_changes(home: Path, manifest: dict | None):
    patch_path = ROOT / "keys.patch.json"
    if not patch_path.exists():
        return None, None
    patch = read_json(patch_path)
    if not isinstance(patch, dict) or any(not isinstance(v, dict) for v in patch.values()):
        raise InstallError("keys.patch.json must contain sections of bindings")
    path = home / "keys.json"
    safe_parent(path, home)
    safe_file(path)
    if not path.exists():
        raise InstallError("Cannot apply key patch without keys.json")
    current = read_json(path)
    if not isinstance(current, dict):
        raise InstallError("keys.json must be an object")
    prior = (manifest or {}).get("keys", {})
    changes = {}
    for section, binds in patch.items():
        existing = current.get(section, {})
        if not isinstance(existing, dict):
            raise InstallError(f"Non-object key section: {section}")
        for key, command in binds.items():
            if key in existing and existing[key] != command:
                raise InstallError(f"Key binding collision: {section}.{key}")
            if key not in existing:
                changes.setdefault(section, {})[key] = command
    if changes:
        updated = json.loads(json.dumps(current))
        for section, binds in changes.items():
            updated.setdefault(section, {}).update(binds)
        return updated, changes
    return None, prior


def install(home: Path, dry_run: bool) -> None:
    sources = package_files()
    missing = []
    for name in REQUIRED_MODS:
        entry = home / "mods" / name / "main.js"
        safe_parent(entry, home)
        safe_file(entry)
        if not entry.exists():
            missing.append(name)
    if missing:
        raise InstallError("Missing required Orca mods: " + ", ".join(missing))
    manifest = load_manifest(home)
    if manifest:
        verify_owned(home, manifest)
        if set(manifest["files"]) != set(sources):
            raise InstallError("Package file list changed; uninstall then reinstall")
    else:
        for name in MODS:
            folder = home / "mods" / name
            safe_parent(folder / "main.js", home)
            if folder.exists() or folder.is_symlink():
                raise InstallError(f"Mod name already occupied: {folder}")
    for rel in sources:
        target = home / rel
        safe_parent(target, home)
        safe_file(target)
        if manifest is None and target.exists():
            raise InstallError(f"Name already occupied: {target}")
    keys_updated, new_keys = key_changes(home, manifest)
    owned_keys = json.loads(json.dumps((manifest or {}).get("keys", {})))
    for section, binds in (new_keys or {}).items():
        owned_keys.setdefault(section, {}).update(binds)
    next_manifest = {"schema": SCHEMA, "package": "herdr-archive", "files": {rel: digest(data) for rel, data in sources.items()}, "keys": owned_keys, "previous_layout": (manifest or {}).get("previous_layout")}
    next_manifest["created_key_sections"] = (manifest or {}).get("created_key_sections", [])
    if keys_updated is not None:
        if manifest is None:
            original_keys = (home / "keys.json").read_bytes()
            next_manifest["keys_original"] = base64.b64encode(original_keys).decode("ascii")
            next_manifest["created_key_sections"] = [section for section in (new_keys or {}) if section not in json.loads(original_keys)]
        next_manifest["keys_written_hash"] = digest(encoded(keys_updated))
    elif manifest:
        for field in ("keys_original", "keys_written_hash"):
            if field in manifest:
                next_manifest[field] = manifest[field]
    changes = [rel for rel, content in sources.items() if not (home / rel).exists() or (home / rel).read_bytes() != content]
    if dry_run:
        print(f"Would install {len(changes)} files in {home}; {sum(len(v) for v in (new_keys or {}).values())} new key bindings")
        return
    backups = {rel: (home / rel).read_bytes() for rel in changes if (home / rel).exists()}
    keys_backup = (home / "keys.json").read_bytes() if keys_updated is not None else None
    try:
        for rel in changes:
            atomic_write(home / rel, sources[rel])
        if keys_updated is not None:
            atomic_write(home / "keys.json", encoded(keys_updated))
        atomic_write(home / MANIFEST, encoded(next_manifest))
    except Exception:
        if keys_backup is not None:
            atomic_write(home / "keys.json", keys_backup)
        for rel in changes:
            if rel in backups:
                atomic_write(home / rel, backups[rel])
            else:
                (home / rel).unlink(missing_ok=True)
        raise
    print(f"Installed Herdr Archive in {home} ({len(changes)} file changes)")


def active_layout(home: Path) -> str | None:
    path = home / "shared.json"
    if not path.exists():
        return None
    data = read_json(path)
    return data.get("layout") if isinstance(data, dict) and isinstance(data.get("layout"), str) else None


def switch(home: Path, name: str) -> None:
    env = os.environ.copy()
    env["HERDR_APP_HOME"] = str(home)
    try:
        subprocess.run(["herdr-app", "do", "layout.switch", json.dumps({"name": name})], env=env, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise InstallError(f"Could not switch layout: {exc}") from exc


def activate(home: Path, dry_run: bool) -> None:
    manifest = load_manifest(home)
    if not manifest:
        raise InstallError("Install first")
    verify_owned(home, manifest)
    current = active_layout(home)
    if dry_run:
        print(f"Would switch {current or '(unknown)'} to archive")
        return
    if current == "archive":
        print("Archive is already active")
        return
    if not current:
        raise InstallError("Cannot record previous layout from shared.json")
    manifest["previous_layout"] = current
    atomic_write(home / MANIFEST, encoded(manifest))
    switch(home, "archive")
    print("Activated Archive")


def preserve_remaining_mod_dirs(home: Path) -> Path | None:
    """Move whole directories with non-owned files aside, without following links."""
    backup_base = home / ".herdr-archive-backups"
    if backup_base.is_symlink() or (backup_base.exists() and not backup_base.is_dir()):
        raise InstallError(f"Unsafe backup directory: {backup_base}")
    backup_run = None
    for name in MODS:
        folder = home / "mods" / name
        if not folder.exists() and not folder.is_symlink():
            continue
        if folder.is_symlink() or not folder.is_dir():
            raise InstallError(f"Unsafe mod directory: {folder}")
        # Owned files may leave empty package subdirectories. Remove only
        # directories that are actually empty; a symlink is never traversed.
        subdirs = sorted((p for p in folder.rglob("*") if p.is_dir() and not p.is_symlink()), key=lambda p: len(p.parts), reverse=True)
        for subdir in subdirs:
            try:
                subdir.rmdir()
            except OSError:
                pass
        if not any(folder.iterdir()):
            folder.rmdir()
            continue
        if backup_run is None:
            backup_base.mkdir(mode=0o700, exist_ok=True)
            if backup_base.is_symlink() or not backup_base.is_dir():
                raise InstallError(f"Unsafe backup directory: {backup_base}")
            backup_run = Path(tempfile.mkdtemp(prefix="uninstall-", dir=backup_base))
        # Renaming the directory preserves generated files, user additions,
        # and symlinks as they are. It also frees the mod name for reinstall.
        os.rename(folder, backup_run / name)
    return backup_run


def uninstall(home: Path, dry_run: bool) -> None:
    manifest = load_manifest(home)
    if not manifest:
        print("Herdr Archive is not installed")
        return
    verify_owned(home, manifest)
    current = active_layout(home)
    previous = manifest.get("previous_layout")
    if current == "archive" and (not isinstance(previous, str) or not (home / "layouts" / f"{previous}.json").is_file()):
        raise InstallError("Archive is active and no previous layout is available; switch layouts first")
    backup_base = home / ".herdr-archive-backups"
    if backup_base.is_symlink() or (backup_base.exists() and not backup_base.is_dir()):
        raise InstallError(f"Unsafe backup directory: {backup_base}")
    keys = manifest.get("keys", {})
    key_data = None
    key_bytes = None
    if keys:
        path = home / "keys.json"
        safe_file(path)
        key_data = read_json(path)
        if not isinstance(key_data, dict):
            raise InstallError("keys.json must be an object")
        for section, binds in keys.items():
            for key, expected in binds.items():
                if key_data.get(section, {}).get(key) != expected:
                    raise InstallError(f"Installed key changed; preserving it: {section}.{key}")
                del key_data[section][key]
        for section in manifest.get("created_key_sections", []):
            if section in key_data and not key_data[section]:
                del key_data[section]
        if manifest.get("keys_original") and digest(path.read_bytes()) == manifest.get("keys_written_hash"):
            try:
                key_bytes = base64.b64decode(manifest["keys_original"], validate=True)
            except (ValueError, TypeError) as exc:
                raise InstallError("Invalid keys backup in manifest") from exc
        else:
            key_bytes = encoded(key_data)
    if dry_run:
        print(f"Would remove {len(manifest['files'])} owned files; active={current == 'archive'}")
        return
    if current == "archive":
        switch(home, previous)
    if key_bytes is not None:
        atomic_write(home / "keys.json", key_bytes)
    for rel in manifest["files"]:
        target = home / rel
        safe_parent(target, home)
        safe_file(target)
        if digest(target.read_bytes()) != manifest["files"][rel]:
            raise InstallError(f"Installed file changed during uninstall: {target}")
        target.unlink()
    backup_run = preserve_remaining_mod_dirs(home)
    (home / MANIFEST).unlink()
    print("Uninstalled Herdr Archive; shared state was preserved" + (f"; remaining mod files saved in {backup_run}" if backup_run else ""))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("install", "activate", "uninstall", "status"))
    parser.add_argument("--home", type=Path, default=Path.home() / ".config" / "herdr-app", help="Herdr profile directory")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    home = args.home.expanduser().resolve()
    try:
        if args.command == "install":
            install(home, args.dry_run)
        elif args.command == "activate":
            activate(home, args.dry_run)
        elif args.command == "uninstall":
            uninstall(home, args.dry_run)
        else:
            manifest = load_manifest(home)
            if manifest:
                verify_owned(home, manifest)
            print(json.dumps({"installed": bool(manifest), "active_layout": active_layout(home), "files": len(manifest["files"]) if manifest else 0}))
    except InstallError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
