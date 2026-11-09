// Data transformations for the archive. This file has no Herdr host calls.
export const ARCHIVE_VERSION = 1;

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value) => typeof value === "string" ? value : "";

function assertWritableVersion(raw) {
  if (object(raw) && Object.prototype.hasOwnProperty.call(raw, "version") && raw.version !== ARCHIVE_VERSION) {
    throw new Error(`Archive data version ${raw.version} is not supported by this mod`);
  }
}

export function normalizeArchive(raw) {
  if (!object(raw) || !object(raw.records)) {
    return { version: ARCHIVE_VERSION, records: Object.create(null) };
  }
  // Read compatible records from a newer version for visibility, but mutation
  // is refused by the host adapter until its schema is understood.
  const records = Object.create(null);
  for (const [id, value] of Object.entries(raw.records)) {
    if (!id || !object(value)) continue;
    const archivedAt = Number(value.archivedAt);
    records[id] = {
      id,
      name: string(value.name) || id,
      folder: string(value.folder),
      branch: string(value.branch),
      machine: value.machine === null || typeof value.machine === "string" ? value.machine : null,
      repo: string(value.repo),
      repoKey: string(value.repoKey),
      archivedAt: Number.isFinite(archivedAt) && archivedAt > 0 ? archivedAt : 0,
    };
  }
  return { version: ARCHIVE_VERSION, records };
}

const basename = (path) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";

// A space reports its current folder rather than a Git root. Keep a useful
// label without probing the filesystem (including remote machines).
export function repoLabel(folder, name) {
  const path = string(folder);
  const worktree = path.replace(/\\/g, "/").match(/(?:^|\/)\.herdr\/worktrees\/([^/]+)\//);
  return worktree ? worktree[1] : basename(path) || string(name) || "Other spaces";
}

export function archiveEntries(raw, snapshots, archivedAt) {
  assertWritableVersion(raw);
  const next = normalizeArchive(raw);
  const changedIds = [];
  for (const space of snapshots) {
    const id = space?.id;
    if (typeof id !== "string" || !id || next.records[id]) continue;
    const folder = string(space.folder);
    next.records[id] = {
      id,
      name: string(space.name) || id,
      folder,
      branch: string(space.branch),
      machine: space.machine === null || typeof space.machine === "string" ? space.machine : null,
      repo: string(space.repo) || repoLabel(folder, space.name),
      repoKey: string(space.repoKey),
      archivedAt,
    };
    changedIds.push(id);
  }
  return { next, changedIds };
}

export function restoreEntries(raw, ids, liveIds) {
  assertWritableVersion(raw);
  const next = normalizeArchive(raw);
  const live = new Set(liveIds);
  const changedIds = [];
  for (const id of ids) {
    // A missing space may be on an unavailable machine. Keep its record until
    // it returns, so a transient disconnect cannot silently unarchive it.
    if (typeof id !== "string" || !live.has(id) || !next.records[id]) continue;
    delete next.records[id];
    changedIds.push(id);
  }
  return { next, changedIds };
}

export function filterRecords(records, query) {
  const terms = string(query).toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return records;
  return records.filter((record) => {
    const haystack = [record.repo, record.name, record.branch, record.folder, record.machine]
      .filter(Boolean).join(" ").toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function groupRecords(records) {
  const groups = new Map();
  for (const record of records) {
    const repo = record.repo || repoLabel(record.folder, record.name);
    const key = record.repoKey || JSON.stringify([record.machine ?? null, repo]);
    if (!groups.has(key)) groups.set(key, { key, repo, machine: record.machine, records: [] });
    groups.get(key).records.push(record);
  }
  return [...groups.values()].sort((a, b) => a.repo.localeCompare(b.repo) ||
    string(a.machine).localeCompare(string(b.machine)));
}
