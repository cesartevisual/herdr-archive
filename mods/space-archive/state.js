import { shared, setShared, spaces, panes, machines, run, openOverlay } from "herdr";
import { ARCHIVE_VERSION, normalizeArchive, archiveEntries, restoreEntries } from "./model.js";

export const ARCHIVE_KEY = "space-archive.v1";

const idsOf = (ids) => [...new Set((Array.isArray(ids) ? ids : [ids]).filter((id) => typeof id === "string" && id))];

export function availableSpaceIds() {
  const ready = new Set(machines().filter((machine) => machine.layout === "ready").map((machine) => machine.name));
  return new Set(spaces().filter((space) => ready.has(space.machine)).map((space) => space.id));
}

function writableState() {
  const raw = shared(ARCHIVE_KEY);
  if (raw && typeof raw === "object" && raw.version !== undefined && raw.version !== ARCHIVE_VERSION) {
    throw new Error(`Archive data version ${raw.version} is not supported by this mod`);
  }
  return raw;
}

export function archiveRecords() {
  return Object.values(normalizeArchive(shared(ARCHIVE_KEY)).records)
    .sort((a, b) => b.archivedAt - a.archivedAt || a.name.localeCompare(b.name));
}

export function isArchived(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(normalizeArchive(shared(ARCHIVE_KEY)).records, id);
}

export function archiveSpaces(ids, options = {}) {
  const wanted = new Set(idsOf(ids));
  const live = spaces();
  const paneList = panes();
  const parents = shared("archive-sidebar.space-parents") ?? shared("better-sidebar.space-parents") ?? {};
  const snapshots = live.filter((space) => wanted.has(space.id)).map((space) => {
    const tabs = new Set(space.tabs.map((tab) => tab.id));
    const first = paneList.find((pane) => tabs.has(pane.tab) && pane.cwd);
    const parent = parents[space.id];
    return {
      ...space,
      folder: first?.cwd || space.folder,
      branch: first?.branch || space.branch,
      repo: parent?.label,
      repoKey: parent?.key,
    };
  });
  const { next, changedIds } = archiveEntries(writableState(), snapshots, Date.now());
  if (!changedIds.length) return [];
  setShared(ARCHIVE_KEY, next);
  const active = live.find((space) => space.active);
  if (active && changedIds.includes(active.id)) {
    const ready = availableSpaceIds();
    const available = live.find((space) => ready.has(space.id) && !next.records[space.id]);
    if (available) run("space.select", { id: available.id });
    else if (options.openIfEmpty !== false) openArchive();
  }
  return changedIds;
}

export function restoreSpaces(ids) {
  const { next, changedIds } = restoreEntries(writableState(), idsOf(ids), availableSpaceIds());
  if (changedIds.length) setShared(ARCHIVE_KEY, next);
  return changedIds;
}

export function openArchive(options = {}) {
  return openOverlay({ mod: "space-archive", kind: "dialog", width: 760, height: 0.82, props: options });
}
