import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "archive.py"
spec = importlib.util.spec_from_file_location("archive_installer", SCRIPT)
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.package = base / "package"
        self.home = base / "profile"
        self.home.mkdir()
        (self.package / "layouts").mkdir(parents=True)
        (self.package / "layouts" / "archive.json").write_text('{"id":"root"}\n')
        for name in archive.MODS:
            folder = self.package / "mods" / name
            folder.mkdir(parents=True)
            (folder / "main.js").write_text("export default {}\n")
            (folder / "gpui-kit.d.ts").write_text("generated types")
            (folder / "jsconfig.json").write_text("{}")
            (folder / ".DS_Store").write_bytes(b"metadata")
        for name in archive.REQUIRED_MODS:
            folder = self.home / "mods" / name
            folder.mkdir(parents=True)
            (folder / "main.js").write_bytes(b"existing Orca mod")
        self.shared = b'{"layout":"main","other":{"keep":1}}\n'
        (self.home / "shared.json").write_bytes(self.shared)
        self.keys = b'{"global":{"cmd-p":"mod.open:picker"}}\n'
        (self.home / "keys.json").write_bytes(self.keys)
        self.root_patch = patch.object(archive, "ROOT", self.package)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def test_dry_run_install_idempotent_and_uninstall_preserve_shared(self):
        archive.install(self.home, True)
        self.assertFalse((self.home / archive.MANIFEST).exists())
        archive.install(self.home, False)
        self.assertFalse((self.home / "mods" / "archive-sidebar" / "gpui-kit.d.ts").exists())
        self.assertFalse((self.home / "mods" / "archive-sidebar" / ".DS_Store").exists())
        first_manifest = (self.home / archive.MANIFEST).read_bytes()
        archive.install(self.home, False)
        self.assertEqual((self.home / archive.MANIFEST).read_bytes(), first_manifest)
        archive.uninstall(self.home, False)
        self.assertEqual((self.home / "shared.json").read_bytes(), self.shared)
        self.assertEqual((self.home / "keys.json").read_bytes(), self.keys)
        self.assertFalse((self.home / "layouts" / "archive.json").exists())

    def test_collision_refuses_any_existing_mod_even_identical(self):
        folder = self.home / "mods" / "archive-sidebar"
        folder.mkdir(parents=True)
        marker = folder / "main.js"
        marker.write_bytes(b"user owned")
        with self.assertRaisesRegex(archive.InstallError, "occupied"):
            archive.install(self.home, False)
        self.assertEqual(marker.read_bytes(), b"user owned")
        self.assertFalse((self.home / archive.MANIFEST).exists())

    def test_missing_dependency_fails_before_copy(self):
        (self.home / "mods" / "my-tabs" / "main.js").unlink()
        with self.assertRaisesRegex(archive.InstallError, "my-tabs"):
            archive.install(self.home, False)
        self.assertFalse((self.home / "layouts" / "archive.json").exists())

    def test_changed_owned_file_blocks_uninstall(self):
        archive.install(self.home, False)
        target = self.home / "mods" / "archive-sidebar" / "main.js"
        target.write_bytes(b"personal edit")
        with self.assertRaisesRegex(archive.InstallError, "changed"):
            archive.uninstall(self.home, False)
        self.assertEqual(target.read_bytes(), b"personal edit")
        self.assertTrue((self.home / archive.MANIFEST).exists())

    def test_key_patch_adds_only_free_binding_then_removes_its_own(self):
        (self.package / "keys.patch.json").write_text(json.dumps({"global": {"cmd-shift-a": "mod.open:space-archive"}}))
        archive.install(self.home, False)
        keys = json.loads((self.home / "keys.json").read_text())
        self.assertEqual(keys["global"]["cmd-p"], "mod.open:picker")
        self.assertEqual(keys["global"]["cmd-shift-a"], "mod.open:space-archive")
        archive.uninstall(self.home, False)
        self.assertEqual((self.home / "keys.json").read_bytes(), self.keys)

    def test_key_collision_fails_before_copy(self):
        (self.package / "keys.patch.json").write_text(json.dumps({"global": {"cmd-p": "mod.open:space-archive"}}))
        with self.assertRaisesRegex(archive.InstallError, "collision"):
            archive.install(self.home, False)
        self.assertFalse((self.home / "layouts" / "archive.json").exists())

    def test_uninstall_keeps_unrelated_key_edits_after_install(self):
        (self.package / "keys.patch.json").write_text(json.dumps({"layout:archive": {"cmd-p": "mod.open:archive-picker"}}))
        archive.install(self.home, False)
        keys = json.loads((self.home / "keys.json").read_text())
        keys["global"]["cmd-x"] = "personal.command"
        (self.home / "keys.json").write_text(json.dumps(keys))
        archive.uninstall(self.home, False)
        remaining = json.loads((self.home / "keys.json").read_text())
        self.assertEqual(remaining["global"]["cmd-x"], "personal.command")
        self.assertNotIn("layout:archive", remaining)

    def test_manifest_write_failure_rolls_back_files_and_keys(self):
        (self.package / "keys.patch.json").write_text(json.dumps({"layout:archive": {"cmd-p": "mod.open:archive-picker"}}))
        real_write = archive.atomic_write

        def fail_manifest(path, content):
            if path.name == archive.MANIFEST:
                raise OSError("simulated disk error")
            return real_write(path, content)

        with patch.object(archive, "atomic_write", side_effect=fail_manifest):
            with self.assertRaisesRegex(OSError, "simulated disk error"):
                archive.install(self.home, False)
        self.assertFalse((self.home / "layouts" / "archive.json").exists())
        self.assertFalse((self.home / "mods" / "space-archive" / "main.js").exists())
        self.assertEqual((self.home / "keys.json").read_bytes(), self.keys)
        self.assertFalse((self.home / archive.MANIFEST).exists())

    def test_activate_records_previous_and_uninstall_switches_before_removing(self):
        archive.install(self.home, False)
        with patch.object(archive, "switch") as switch:
            archive.activate(self.home, False)
            switch.assert_called_once_with(self.home, "archive")
        manifest = json.loads((self.home / archive.MANIFEST).read_text())
        self.assertEqual(manifest["previous_layout"], "main")
        (self.home / "layouts" / "main.json").write_text("{}")
        (self.home / "shared.json").write_text('{"layout":"archive"}')
        with patch.object(archive, "switch") as switch:
            archive.uninstall(self.home, False)
            switch.assert_called_once_with(self.home, "main")

    def test_uninstall_preserves_generated_and_user_files_then_reinstalls(self):
        archive.install(self.home, False)
        generated = self.home / "mods" / "archive-sidebar" / "gpui-kit.d.ts"
        generated.write_bytes(b"app generated types")
        (self.home / "mods" / "archive-picker" / "jsconfig.json").write_bytes(b"app generated config")
        extra = self.home / "mods" / "space-archive" / "notes" / "user.txt"
        extra.parent.mkdir()
        extra.write_bytes(b"keep this")
        outside = self.home / "user-target.txt"
        outside.write_bytes(b"outside")
        (extra.parent / "shortcut").symlink_to(outside)
        archive.uninstall(self.home, False)
        backups = list((self.home / ".herdr-archive-backups").glob("uninstall-*"))
        self.assertEqual(len(backups), 1)
        backup = backups[0]
        self.assertEqual((backup / "archive-sidebar" / "gpui-kit.d.ts").read_bytes(), b"app generated types")
        self.assertEqual((backup / "archive-picker" / "jsconfig.json").read_bytes(), b"app generated config")
        self.assertEqual((backup / "space-archive" / "notes" / "user.txt").read_bytes(), b"keep this")
        self.assertTrue((backup / "space-archive" / "notes" / "shortcut").is_symlink())
        self.assertEqual(outside.read_bytes(), b"outside")
        for name in archive.MODS:
            self.assertFalse((self.home / "mods" / name).exists())
        archive.install(self.home, False)
        self.assertTrue((self.home / "mods" / "space-archive" / "main.js").exists())
        self.assertEqual((backup / "space-archive" / "notes" / "user.txt").read_bytes(), b"keep this")

    def test_symlinked_backup_root_blocks_uninstall_before_changes(self):
        archive.install(self.home, False)
        elsewhere = self.home.parent / "elsewhere"
        elsewhere.mkdir()
        (self.home / ".herdr-archive-backups").symlink_to(elsewhere, target_is_directory=True)
        with self.assertRaisesRegex(archive.InstallError, "Unsafe backup directory"):
            archive.uninstall(self.home, False)
        self.assertTrue((self.home / "mods" / "space-archive" / "main.js").exists())
        self.assertTrue((self.home / archive.MANIFEST).exists())
        self.assertEqual(list(elsewhere.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
