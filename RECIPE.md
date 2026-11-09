# Herdr Archive

A personal Orca layout with a compact Archive control. Spaces selected for
archive disappear from everyday navigation while their terminals and agents
continue running. The archive browser lets people search, group, and restore
them.

![Herdr Archive preview](preview.png)

## What you see

The window keeps Orca's left sidebar, central terminal panes, and 28 px
bottom status row. The sidebar carries the existing space and agent views;
its archive entry opens a centered dialog. In that dialog, a title and count
sit above a search field and grouped space rows. Each row shows its space
name, repository or folder, branch, machine when present, and archive date.
Unreachable remote spaces show **Unavailable**. Restore controls operate on
individual rows, groups, or all shown results. The current Orca colors and type come from the personal profile
and the active Herdr theme; the layout does not hard-code a new palette.

## How it behaves

Archiving records a space's ID and metadata under `space-archive.v1`, then
removes that ID from Archive's sidebar and picker views. It does not stop
running agents; working, blocked, done, and idle statuses continue to render
through the inherited Orca agent UI. Archiving the focused space selects
another visible space if one exists. An Undo action reverses the latest
archive or restore in the open dialog. Search matches name, branch, folder,
repository, and machine. Records group by repository and machine; a missing
remote space remains archived and cannot be restored until it is live again.
The Archive layout's `cmd-p` opens its picker and `ctrl-1` through `ctrl-9`
select visible sidebar spaces. The inherited Orca shortcuts remain in its
layout-specific key section.

## Built from

`layouts/archive.json` is a row body containing the sidebar, terminal area,
and a 28 px status row, plus hidden service blocks. It starts from the local
Orca layout. `archive-chrome` draws the window chrome; `archive-sidebar`
draws and controls spaces and agents; `archive-menu` provides space actions;
`archive-picker` provides keyboard navigation; `space-archive` owns the
dialog and state model. `keys.patch.json` adds only Archive layout bindings.
The layout also references the existing Orca mods listed in README. The
archive state functions use Herdr `shared`, `setShared`, `spaces`, `panes`,
`run`, and `openOverlay`. The menu uses Herdr `exec` for existing Git
worktree actions. Icons are local SVG assets in the copied mods.

## Watch out

Herdr app 0.1.14 and the Orca layout dependencies linked in README are required. Do not assume
these mods exist in a default Herdr profile. The installer checks them and
refuses name or key collisions. Herdr writes shared state itself; never
replace all of `shared.json` to implement this feature. Do not modify shipped
mods, layouts, or the signed application. Archive metadata is independent of
space lifetime: an unavailable remote space must remain in the archive until
it reconnects. Verified source revisions and retained notices are listed in THIRD_PARTY.md and NOTICE.

## Done when

- `npm test` passes all state and installer tests.
- `herdr-app check` passes for each of the five installed mods.
- Archive layout activates without a `.error` file and retains Orca panes,
  sidebar, picker, status, and menu behavior.
- Archiving a live space hides it from sidebar and picker, keeps its running
  terminal and agents, and shows a searchable record in the browser.
- Restoring the space reveals it again. An unavailable remote record remains
  preserved until the remote space returns.
- Uninstall switches to the previous layout if needed, removes only owned
  files and keys, and preserves archived shared state.
