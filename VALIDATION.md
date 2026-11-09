# Validation

Verified locally on Herdr 0.1.14, 2026-11-09.

- `npm test`: 5 JavaScript model tests and 11 Python installer tests passed.
- Native `herdr-app check` passed for all five mods.
- Isolated app profile and private herdr-core session verified archive and restore preserve space IDs, tab IDs, split-pane IDs, terminal addresses, dirty tracked files and untracked files.
- Restore left focus unchanged. Archive metadata survived isolated window restart. Archiving the final active space opened the archive browser without removing any spaces.
- Live installation archived exactly the 17 selected imported worktrees; the 9 root/folder spaces and 6 active worktrees remained active. All 32 spaces, tabs, panes and terminals retained their identities.
- Archive browser and active sidebar inspected through native app snapshots.

This package targets the existing Orca profile and its documented dependencies. Public source revisions and retained notices are documented in THIRD_PARTY.md.
