# Third-party sources

The original local files were compared with public sources before publication.

| Distributed files | Source | Revision | License |
| --- | --- | --- | --- |
| `layouts/archive.json`, baseline `mods/archive-sidebar/`, `mods/archive-menu/` | [VladTemp27/herdr-orca](https://github.com/VladTemp27/herdr-orca) | `b26451fe200faec3478da7a5c7ebf7c8cc753a8f` | Apache-2.0 |
| Better Sidebar ancestry inside `mods/archive-sidebar/` | [munza/herdr-mods](https://github.com/munza/herdr-mods) | Better Sidebar 3.0.0 as included by Orca; NOTICE verified at `2bd4870634b8b0b86984651c98c30cf5be170e60` | Apache-2.0 |
| `mods/archive-picker/` | [Herdr Desktop](https://github.com/herdrdev/herdr-app/tree/v0.1.14/defaults/mods/picker) | `v0.1.14` | Apache-2.0 |
| `mods/archive-chrome/` | [Herdr Desktop](https://github.com/herdrdev/herdr-app/tree/master/defaults/mods/workspace-chrome) | `b1a2a67efb9d68cc8fa066c323f9b789b91595f3` | Apache-2.0 |
| Bundled SVG icons | Herdr/Orca icon assets, including Lucide and Feather | inherited with the sources above | ISC / MIT; see `licenses/Lucide-Feather-LICENSE.txt` |

The pre-Archive Orca layout, menu and all 49 relevant Better Sidebar files matched the public Orca source byte for byte. The pre-Archive picker matched Herdr v0.1.14, and workspace-chrome matched the Herdr revision above. Archive modifications are identified in NOTICE and `mods/archive-sidebar/CHANGES.md`.

Original upstream notices are preserved under `licenses/`. The Orca notice mentions additional components of that project; those external dependency mods are not bundled here. Install them from their authors as described in README.
