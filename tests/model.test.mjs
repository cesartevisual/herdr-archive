import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArchive, archiveEntries, restoreEntries, filterRecords, groupRecords, repoLabel } from '../mods/space-archive/model.js';

test('normalization reads newer records safely and cleans malformed records', () => {
  const future = normalizeArchive({ version: 2, records: { stale: {} } });
  assert.equal(future.records.stale.id, 'stale');
  assert.equal(Object.getPrototypeOf(future.records), null);
  const result = normalizeArchive({ version: 1, records: {
    a: { id: 'forged', name: '', folder: 42, branch: null, machine: 12, archivedAt: 'nope' },
    b: null,
  } });
  assert.deepEqual(Object.keys(result.records), ['a']);
  assert.equal(result.records.a.id, 'a');
  assert.equal(result.records.a.name, 'a');
  assert.equal(result.records.a.machine, null);
  assert.equal(result.records.a.archivedAt, 0);
});

test('special object keys remain ordinary archive IDs', () => {
  const input = JSON.parse('{"version":1,"records":{"__proto__":{"name":"Special","folder":"/repo"}}}');
  const normalized = normalizeArchive(input);
  assert.equal(Object.getPrototypeOf(normalized.records), null);
  assert.equal(normalized.records.__proto__.id, '__proto__');
  const restored = restoreEntries(normalized, ['__proto__'], ['__proto__']);
  assert.deepEqual(restored.changedIds, ['__proto__']);
  assert.equal(Object.hasOwn(restored.next.records, '__proto__'), false);
});

test('unknown version blocks mutation without changing caller state', () => {
  const future = { version: 2, records: { old: { id: 'old', name: 'Saved' } } };
  const before = JSON.stringify(future);
  assert.throws(() => archiveEntries(future, [{ id: 'new' }], 1000), /version|schema/i);
  assert.throws(() => restoreEntries(future, ['old'], ['old']), /version|schema/i);
  assert.equal(JSON.stringify(future), before);
});

test('archive is idempotent and restores only live ids', () => {
  const snapshots = [
    { id: 'sp1', name: 'Project', folder: '/work/project', branch: 'main', machine: null },
    { id: 'sp2', name: 'Remote', folder: '/srv/remote', branch: 'feature', machine: 'box' },
  ];
  const first = archiveEntries(null, snapshots, 1000);
  assert.deepEqual(first.changedIds, ['sp1', 'sp2']);
  assert.equal(first.next.records.sp1.repo, 'project');
  assert.equal(first.next.records.sp2.machine, 'box');
  const again = archiveEntries(first.next, snapshots, 2000);
  assert.deepEqual(again.changedIds, []);
  assert.equal(again.next.records.sp1.archivedAt, 1000);
  const partial = restoreEntries(again.next, ['sp1', 'sp2', 'missing'], ['sp1']);
  assert.deepEqual(partial.changedIds, ['sp1']);
  assert.deepEqual(Object.keys(partial.next.records), ['sp2']);
});

test('search covers metadata and groups by machine plus repository', () => {
  const records = [
    { id: 'a', name: 'Feature one', folder: '/x/repo', branch: 'fix', repo: 'repo', machine: null },
    { id: 'b', name: 'Feature two', folder: '/x/repo', branch: 'main', repo: 'repo', machine: null },
    { id: 'c', name: 'Feature remote', folder: '/x/repo', branch: 'fix', repo: 'repo', machine: 'server' },
  ];
  assert.deepEqual(filterRecords(records, '  REPO FIX ' ).map((r) => r.id), ['a', 'c']);
  assert.equal(groupRecords(records).length, 2);
  assert.equal(groupRecords(records).find((g) => g.machine === null).records.length, 2);
  assert.equal(repoLabel('/root/.herdr/worktrees/my-repo/branch', 'Fallback'), 'my-repo');
});
