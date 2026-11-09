# Herdr Archive

Archive spaces in a personal Herdr layout and bring them back later. Archived
spaces stay in Herdr and keep their terminals and agents; Archive hides them
from the sidebar and picker. The archive browser groups them by repository and
machine, supports search, and restores one or several spaces. A compact Archive
control remains in the layout.

![Herdr Archive](preview.png)

This release targets **Herdr app 0.1.14 with the Orca layout**. It
is not a standalone layout for a fresh Herdr installation. The installer
checks for these existing Orca mods before copying anything:

`better-changes`, `desktop-notifications`, `files-open-with`, `hibernate`,
`live-ports`, `my-pane`, `my-status`, `my-tabs`, `resources`, `sidebar-nav`,
`t3-actions`, `usage-limits`, `project-settings`, `my-worktree`, and
`new-worktree`.

## Install

Install [Orca for Herdr](https://github.com/VladTemp27/herdr-orca) and its
[Better Changes dependency](https://github.com/munza/herdr-mods/tree/main/better-changes)
first, following their installation instructions. Better Config is recommended
by Orca for settings. This repository adds Archive to that setup; it does not
bundle those dependency mods or patch Herdr itself.

Use Python 3.10 or newer and Node.js 20 or newer for tests. Clone this repository:

```sh
git clone https://github.com/cesartevisual/herdr-archive.git
cd herdr-archive
```

Then:

```sh
python3 scripts/archive.py install --dry-run
python3 scripts/archive.py install
herdr-app check ~/.config/herdr-app/mods/space-archive
python3 scripts/archive.py activate
```

Pass `--home /path/to/profile` to target another Herdr profile. `activate`
uses `herdr-app do layout.switch` and records the previous layout for removal.
Check the new layout and mods in the running app before activating. The
installer does not edit `shared.json` or the signed app. It only installs
`layouts/archive.json`, its preview SVG, the five `mods/archive-*` / `mods/space-archive`
folders, and the entries in `keys.patch.json` that are free in `keys.json`.
If a destination or shortcut is occupied, it stops without overwriting it.

```sh
python3 scripts/archive.py status
python3 scripts/archive.py uninstall --dry-run
python3 scripts/archive.py uninstall
```

Uninstall removes only files whose hashes still match its ownership manifest
and its own shortcut entries. A personal edit stops removal so it cannot be
lost. When Archive is active, uninstall switches to the recorded previous
layout first. It leaves all shared metadata and archived records intact, so
reinstalling retains the archive. To remove archived metadata, use Herdr's
own state controls deliberately; this package does not clear it.

## Use

- Open **Space archive** from the sidebar Archive control, the space menu, or
  the picker (`cmd-p` in the Archive layout).
- Archive a space from its menu.
- Search archived spaces by name, folder, branch, repository, or machine, and
  restore a row, a group, or all shown results. A temporarily unavailable remote space remains in
  the archive until it returns.
- `ctrl-1` through `ctrl-9` select visible spaces in the Archive sidebar.

The archive stores only space identifiers and display metadata in Herdr shared
state under `space-archive.v1`. Archiving does not close, delete, or stop a
space, terminal, agent, checkout, or worktree. No network access is added by
the archive feature. The inherited Orca mods may run commands or access
services; see their own sources and settings. The menu's existing worktree
actions run `git`.

## Development

```sh
npm test
```

The Node tests cover state normalization, archive and restore, search, and
grouping. Python tests exercise the installer against temporary profiles,
including collisions, repeat installs, shortcut ownership, and removal after
local edits. The files in `mods/` are Herdr GPUI JavaScript, not browser code.

See [RECIPE.md](RECIPE.md) for the visual and behavioral build brief,
[THIRD_PARTY.md](THIRD_PARTY.md) for verified source revisions, and
[NOTICE](NOTICE) for attribution. The code is Apache-2.0; bundled icons retain
their ISC/MIT notices.

## Contributing to the Herdr ecosystem

Herdr recommends publishing new UI features as custom mods and layouts. This
repository is tagged `herdr-layout` and `herdr-mod` for gallery discovery.
It is an Orca-compatible extension, with no changes to Herdr core. Report
Archive bugs here; use [Herdr's contribution guide](https://github.com/herdrdev/herdr-app/blob/master/CONTRIBUTING.md)
for missing core APIs or Herdr bugs. Pull requests should include the relevant
tests and native mod checks.

Uninstall preserves generated editor files and any extra user files under `.herdr-archive-backups/uninstall-*` in the profile, keeping the mod names free for reinstall. Archive metadata remains in `shared.json`.
