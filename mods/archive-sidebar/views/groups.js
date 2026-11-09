// Your folders: named sections in the spaces list holding the projects and spaces you file there.
// Stored in shared state; the popups here (props.view "groups") name, color, fill and delete them.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, shared, setShared, closeOverlay, openOverlay, spaces, notify } from "herdr";
import { TEXT, SIZE, RADIUS, Icon } from "./ui.js";

const KEY = "archive-sidebar.groups";

// { groups: [{ id, name, color, home }], projects: { <unit key>: <group id> }, folds: { "<machine>|<id>": bool } }
// A unit key is a repo's `[machine, git common dir]`, or `space:<id>` for a space outside any repo.
export function readGroups() {
  // Start with the user's existing folder arrangement; subsequent edits stay in this clone.
  const v = shared(KEY) ?? shared("better-sidebar.groups");
  return { groups: v?.groups ?? [], projects: v?.projects ?? {}, folds: v?.folds ?? {} };
}

export function writeGroups(change) {
  const next = change(JSON.parse(JSON.stringify(readGroups())));
  setShared(KEY, next);
}

// The machine a unit lives on: null for this computer.
export function machineOfKey(key) {
  if (key.startsWith("space:")) return spaces().find((s) => s.id === key.slice(6))?.machine ?? null;
  try {
    return JSON.parse(key)[0] ?? null;
  } catch {
    return null;
  }
}

// Folding is per machine: the same folder can be open under one and folded under another.
const foldKey = (id, m) => `${m ?? ""}|${id}`;
export const isFolded = (s, id, m) => s.folds[foldKey(id, m)] ?? s.groups.find((g) => g.id === id)?.folded ?? false;

export function setFold(id, m, folded) {
  writeGroups((s) => {
    s.folds[foldKey(id, m)] = folded;
    return s;
  });
}

export const toggleFold = (id, m) => setFold(id, m, !isFolded(readGroups(), id, m));

export function foldOthers(id, m, shown) {
  writeGroups((s) => {
    for (const g of shown) s.folds[foldKey(g, m)] = g !== id;
    return s;
  });
}

// Files a unit under a folder, or takes it out with null.
export function fileUnder(key, group) {
  writeGroups((s) => {
    if (group) s.projects[key] = group;
    else delete s.projects[key];
    return s;
  });
}

// A new folder made on machine `home`, holding `key` when given; returns its id.
export function newGroupWith(key, home, name = "New folder") {
  const id = `g${Date.now().toString(36)}`;
  writeGroups((s) => {
    const used = new Set(s.groups.map((g) => g.color));
    const color = GROUP_COLORS.find((c) => !used.has(c)) ?? null;
    s.groups.push({ id, name, color, home: home ?? null });
    if (key) s.projects[key] = id;
    s.folds[foldKey(id, home)] = false;
    return s;
  });
  return id;
}

export function deleteGroup(id) {
  const s = readGroups();
  const group = s.groups.find((g) => g.id === id);
  const keys = Object.keys(s.projects).filter((k) => s.projects[k] === id);
  writeGroups((st) => {
    st.groups = st.groups.filter((g) => g.id !== id);
    for (const k of keys) delete st.projects[k];
    for (const f of Object.keys(st.folds)) if (f.endsWith(`|${id}`)) delete st.folds[f];
    return st;
  });
  if (group && keys.length)
    notify({ title: `Deleted folder “${group.name}”`, body: `${keys.length} project${keys.length === 1 ? "" : "s"} moved to Unfiled`, timeout: 5000 });
}

const popup = (mode, extra, height = 220) =>
  openOverlay({ mod: "archive-sidebar", kind: "popup", width: 260, height, props: { view: "groups", mode, ...extra } });

// Names a new folder (made on machine `home`), or renames `group`.
export const openNameDialog = (group = null, home = null) =>
  openOverlay({ mod: "archive-sidebar", kind: "dialog", width: 380, height: 150, props: { view: "groups", mode: "name", group, home } });
// `projects`: [{ key, name }] known to the spaces list now.
export const openProjectPicker = (group, projects) =>
  popup("projects", { group, projects }, Math.min(420, 70 + projects.length * SIZE.menu));
// `machine` and `shown`: the machine section it was opened in and the folders shown there.
export const openGroupMenu = (group, projects, machine = null, shown = []) =>
  popup("menu", { group, projects, machine, shown }, 255);
// "Move to folder" for one unit; my-menu opens it from a space's menu too.
export const openMoveMenu = (key, name, machine = null) =>
  popup("move", { key, name, machine }, Math.min(460, 112 + (readGroups().groups.length + 1) * SIZE.menu));

// Folder backgrounds: theme color names, so they follow light and dark themes.
export const GROUP_COLORS = ["ansi4", "ansi6", "ansi2", "ansi3", "ansi1", "ansi5"];

// The theme color as a soft tint, or null for no background.
export function groupTint(t, color) {
  const hex = color && t[color];
  return typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}24` : null;
}

export class Groups {
  init(_props, cx) {
    const p = props();
    this.handle = cx.focus_handle();
    if (p.mode !== "name") return;
    const current = readGroups().groups.find((g) => g.id === p.group)?.name ?? "";
    this.input = InputState.new({ value: current, placeholder: "Folder name" });
    if (current) this.input.set_selected_range({ start: 0, end: current.length });
    this.input.on("submit", () => this.saveName());
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
  }

  close() {
    closeOverlay(props().overlay);
  }

  saveName() {
    const name = this.input.value().trim();
    const { group, home } = props();
    if (name) {
      writeGroups((s) => {
        const g = s.groups.find((x) => x.id === group);
        if (g) g.name = name;
        else s.groups.push({ id: `g${Date.now().toString(36)}`, name, color: null, home: home ?? null });
        return s;
      });
    }
    this.close();
  }

  render() {
    const mode = props().mode;
    const body = mode === "name" ? this.nameView() : mode === "projects" ? this.projectsView() : mode === "move" ? this.moveView() : this.menuView();
    return body.id("groups-popup").track_focus(this.handle).on_key_down((e, cx) => {
      if (e.key === "escape") { cx.stop_propagation(); this.close(); }
    });
  }

  nameView() {
    const t = theme();
    const renaming = Boolean(readGroups().groups.find((g) => g.id === props().group));
    const button = (id, text, primary, action) => h_flex().id(id).h(30).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().w_full().p(18).gap(14).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(renaming ? "Rename folder" : "New folder"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(Input.new(this.input).h(34).px(10).rounded(8).border_1().border_color(t.accent).bg(t.background).text_size(12.8))
      .child(h_flex().gap(8).justify_end()
        .child(button("group-cancel", "Cancel", false, () => this.close()))
        .child(button("group-save", renaming ? "Save" : "Create", true, () => this.saveName())));
  }

  item(id, icon, label, action, { danger = false, dot = null, check = false, note = null } = {}) {
    const t = theme();
    return h_flex().id(id).h(SIZE.menu).flex_none().px(8).gap(9).items_center()
      .rounded(RADIUS.row).cursor_pointer().text_size(TEXT.menu).text_color(danger ? t.ansi1 : t.foreground)
      .hover((s) => s.bg(t.hover)).on_click(() => { this.close(); action(); })
      .child(div().w(14).flex_none().flex().items_center().justify_center()
        .when(Boolean(dot), (el) => el.child(div().size(9).rounded(5).bg(dot)))
        .when(!dot && Boolean(icon), (el) => el.child(Icon(icon, 14).text_color(danger ? t.ansi1 : t.muted))))
      .child(div().flex_1().min_w(0).truncate().child(label))
      .when(Boolean(note), (el) => el.child(div().flex_none().text_size(TEXT.caption).text_color(t.dim).child(note)))
      .when(check, (el) => el.child(Icon("check", 14).text_color(t.accent)));
  }

  // Click a project to put it in this folder, or take it back out.
  projectsView() {
    const t = theme();
    const { group, projects } = props();
    const s = readGroups();
    const name = (id) => s.groups.find((g) => g.id === id)?.name;
    return v_flex().w_full().p(5).gap(1).bg(t.popover).text_color(t.foreground)
      .child(div().px(8).pt(6).pb(4).text_size(TEXT.caption).font_medium().text_color(t.dim)
        .child(`In ${name(group) ?? "folder"}`))
      .when(!projects.length, (el) => el.child(div().px(8).py(6).text_size(TEXT.small).text_color(t.dim).child("Open a space first.")))
      .children(projects.map((pr, i) => {
        const owner = s.projects[pr.key];
        const mine = owner === group;
        const elsewhere = owner && !mine ? name(owner) : null;
        return h_flex().id(`group-project-${i}`).h(SIZE.menu).flex_none().px(8).gap(9).items_center()
          .rounded(RADIUS.row).cursor_pointer().text_size(TEXT.menu).hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => {
            fileUnder(pr.key, mine ? null : group);
            cx.notify();
          })
          .child(div().w(14).flex_none().child(mine ? Icon("check", 14) : div()))
          .child(div().flex_1().min_w(0).truncate().child(pr.name))
          .when(Boolean(elsewhere), (el) => el.child(div().text_size(TEXT.caption).text_color(t.dim).child(`in ${elsewhere}`)));
      }));
  }

  // Every folder, the unit's own checked; "new here" marks one with nothing on its machine yet.
  moveView() {
    const t = theme();
    const { key, name, machine } = props();
    const s = readGroups();
    const owner = s.projects[key];
    const here = (id) => Object.keys(s.projects).some((k) => s.projects[k] === id && k !== key && machineOfKey(k) === (machine ?? null));
    return v_flex().w_full().p(5).gap(1).bg(t.popover).text_color(t.foreground)
      .child(div().px(8).pt(6).pb(3).text_size(TEXT.caption).font_medium().text_color(t.dim).truncate().child(`Move ${name ?? "space"} to`))
      .children(s.groups.map((g) => this.item(`move-${g.id}`, null, g.name, () => fileUnder(key, g.id), {
        dot: (g.color && t[g.color]) || t.dim, check: owner === g.id, note: owner !== g.id && !here(g.id) ? "new here" : null })))
      .child(this.item("move-new", "folder-plus", "New folder with it", () => openNameDialog(newGroupWith(key, machine), machine)))
      .when(Boolean(owner), (el) => el
        .child(div().h(1).mx(4).my(2).bg(t.border))
        .child(this.item("move-out", "pin-off", "Take out of folder", () => fileUnder(key, null))));
  }

  menuView() {
    const t = theme();
    const { group, projects, machine, shown } = props();
    const s = readGroups();
    const current = s.groups.find((g) => g.id === group)?.color ?? null;
    const setColor = (color) => writeGroups((st) => {
      const g = st.groups.find((x) => x.id === group);
      if (g) g.color = color;
      return st;
    });
    const swatch = (color) => div().id(`group-color-${color ?? "none"}`).size(20).flex_none().rounded(10).cursor_pointer()
      .border_2().border_color(current === color ? t.foreground : "#00000000")
      .when(Boolean(color), (el) => el.bg(t[color]))
      .when(!color, (el) => el.border_1().border_color(current === null ? t.foreground : t.input).flex().items_center()
        .justify_center().text_size(10).text_color(t.dim).child("∅"))
      .tooltip(color ? "Background" : "No background")
      .on_click((_e, cx) => { setColor(color); cx.notify(); });
    const on = new Set(Object.keys(s.projects).filter((k) => s.projects[k] === group).map(machineOfKey)).size;
    return v_flex().w_full().p(5).gap(1).bg(t.popover)
      .child(h_flex().h(SIZE.menu + 6).flex_none().px(8).gap(7).items_center()
        .children([null, ...GROUP_COLORS].map(swatch)))
      .child(div().h(1).mx(4).my(2).bg(t.border))
      .child(this.item("group-rename", "settings", "Rename…", () => openNameDialog(group)))
      .child(this.item("group-add", "plus", "Add projects…", () => openProjectPicker(group, projects)))
      .child(this.item("group-fold-others", "chevron-right", "Fold the others", () => foldOthers(group, machine, shown ?? [])))
      .child(div().h(1).mx(4).my(2).bg(t.border))
      .child(this.item("group-delete", "folder", "Delete folder", () => deleteGroup(group), { danger: true }))
      .when(on > 1, (el) => el.child(div().px(8).pt(4).pb(3).text_size(TEXT.caption).text_color(t.dim)
        .child(`Shared by the ${on} machines it's on. Folding is per machine.`)));
  }
}
