import { shared, spaces } from "herdr";

// Archive records are keyed by full space id, including any machine prefix.
export const archiveRecords = () => shared("space-archive.v1")?.records ?? {};
export const isArchived = (id) => Boolean(id && archiveRecords()[id]);
export const activeSpaces = () => {
  const hidden = archiveRecords();
  return spaces().filter((s) => !hidden[s.id]);
};
