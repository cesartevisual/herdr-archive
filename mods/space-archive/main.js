import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { shared, setShared, spaces, run, props, closeOverlay, theme, layout, nextCommand, notify } from "herdr";
import { archiveSpaces, restoreSpaces, archiveRecords, isArchived, availableSpaceIds, openArchive } from "./state.js";
import { ARCHIVE_VERSION, filterRecords, groupRecords } from "./model.js";

export { openArchive } from "./state.js";

const REQUEST_KEY = "space-archive.request";
const ACK_KEY = "space-archive.ack";

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function button(id, label, action, colors, primary = false) {
  return h_flex().id(id).h(29).px(10).flex_none().items_center().rounded(7)
    .border(1).border_color(primary ? colors.solid : colors.border)
    .bg(primary ? colors.solid : colors.raised)
    .text_size(11.5).font_medium().text_color(primary ? colors.solid_foreground : colors.foreground)
    .cursor_pointer().hover((s) => s.opacity(0.8))
    .role("button").accessibility_label(label).on_click(action).child(label);
}

export default class SpaceArchive extends View {
  init(given, cx) {
    const supplied = props() ?? given ?? {};
    this.mode = supplied.controller ? "controller" : "browser";
    this.handle = cx.focus_handle();
    this.filter = "";
    this.undo = null;
    if (this.mode === "controller") {
      cx.spawn(async (cx) => {
        for (;;) {
          const command = await nextCommand();
          try {
            this.command(command);
          } catch (error) {
            notify({ title: "Archive action failed", body: String(error), level: "error" });
          }
          cx.notify();
        }
      });
    }
    if (this.mode === "browser") {
      this.input = InputState.new({ placeholder: "Search repository, space, branch or path…" });
      this.input.on("change", (_event, cx) => {
        this.filter = this.input.value();
        cx.notify();
      });
      this.input.focus();
      if (supplied.action === "archive" && Array.isArray(supplied.ids)) {
        try {
          const ids = archiveSpaces(supplied.ids, { openIfEmpty: false });
          if (ids.length) this.undo = { action: "restore", ids, label: `${ids.length} archived` };
        } catch (error) {
          this.error = String(error);
        }
      }
    }
  }

  command(command) {
    if (command === "open") return openArchive();
    const match = /^(archive|restore):(.+)$/.exec(command);
    if (!match) return;
    const ids = match[2].split(",");
    if (!ids.length || ids.some((id) => !id || id.trim() !== id)) {
      throw new Error("Archive command needs full space IDs separated by commas");
    }
    if (match[1] === "archive") return archiveSpaces(ids);
    return restoreSpaces(ids);
  }

  processRequest() {
    const request = shared(REQUEST_KEY);
    if (!request || typeof request !== "object" || request.nonce === undefined || request.nonce === null) return;
    if (shared(ACK_KEY)?.nonce === request.nonce) return;
    if (this.processingNonce === request.nonce) return;
    this.processingNonce = request.nonce;
    const ids = Array.isArray(request.ids) ? request.ids : [];
    let changedIds = [];
    try {
      if (request.action === "archive") changedIds = archiveSpaces(ids);
      else if (request.action === "restore") changedIds = restoreSpaces(ids);
      setShared(ACK_KEY, { nonce: request.nonce, action: request.action, changedIds });
    } catch (error) {
      setShared(ACK_KEY, { nonce: request.nonce, action: request.action, changedIds, error: String(error) });
      notify({ title: "Archive action failed", body: String(error), level: "error" });
    } finally {
      this.processingNonce = null;
    }
  }

  restore(ids) {
    try {
      const changed = restoreSpaces(ids);
      if (changed.length) this.undo = { action: "archive", ids: changed, label: `${changed.length} restored` };
      return changed;
    } catch (error) {
      this.error = String(error);
      notify({ title: "Restore failed", body: this.error, level: "error" });
      return [];
    }
  }

  undoLast() {
    if (!this.undo) return;
    const { action, ids } = this.undo;
    try {
      if (action === "archive") archiveSpaces(ids, { openIfEmpty: false });
      else restoreSpaces(ids);
      this.undo = null;
    } catch (error) {
      this.error = String(error);
      notify({ title: "Undo failed", body: this.error, level: "error" });
    }
  }

  open(id) {
    const live = availableSpaceIds().has(id);
    if (!live) return;
    try {
      restoreSpaces([id]);
      closeOverlay(props().overlay);
      run("space.select", { id });
    } catch (error) {
      this.error = String(error);
      notify({ title: "Open failed", body: this.error, level: "error" });
    }
  }

  row(record, liveIds, t) {
    const live = liveIds.has(record.id);
    const subtitle = [record.branch ? `⎇ ${record.branch}` : "", record.folder].filter(Boolean).join("  ·  ");
    const archiveDate = record.archivedAt ? new Date(record.archivedAt).toLocaleDateString() : "";
    return h_flex().id(`archived-${record.id}`).min_h(58).px(12).py(7).gap(12).items_center()
      .rounded(8).border(1).border_color(t.border).bg(t.surface)
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(h_flex().items_center().gap(7)
          .child(div().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(record.name))
          .child(div().text_size(10.5).text_color(live ? t.dim : t.blocked).child(live ? archiveDate : "Unavailable")))
        .child(div().min_w(0).truncate().text_size(10.5).text_color(t.muted).child(subtitle || record.id)))
      .when(live, (el) => el
        .child(button(`restore-${record.id}`, "Restore", () => this.restore([record.id]), t))
        .child(button(`open-${record.id}`, "Open", () => this.open(record.id), t)));
  }

  group(group, liveIds, t) {
    const live = group.records.filter((record) => liveIds.has(record.id));
    const name = group.machine ? `${group.repo}  ·  ${group.machine}` : group.repo;
    return v_flex().id(`archive-group-${group.key}`).gap(7)
      .child(h_flex().h(30).items_center().gap(8)
        .child(div().flex_1().truncate().text_size(12).font_semibold().text_color(t.foreground).child(name))
        .child(div().text_size(11).text_color(t.dim).child(`${group.records.length}`))
        .when(live.length > 1, (el) => el.child(button(`restore-group-${group.key}`, "Restore group", () => this.restore(live.map((record) => record.id)), t))))
      .children(group.records.map((record) => this.row(record, liveIds, t)));
  }

  renderController(t) {
    const count = archiveRecords().length;
    const collapsed = (findNode(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
    const label = `Archive (${count})`;
    return h_flex().id("archive-controller").size_full().bg(t.chrome).px(8).items_center().text_size(13)
      .child(h_flex().id("archive-open").h(28).flex_1().min_w(0).px(8).gap(9).items_center().rounded(8)
        .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .cursor_pointer().tooltip(label).role("button").accessibility_label(label)
        .when(collapsed, (el) => el.w(32).flex_none().justify_center())
        .on_click(() => openArchive())
      .child(svg("mods/space-archive/archive.svg").size(14).flex_none())
        .when(!collapsed, (el) => el.child(div().truncate().child(label))));
  }

  renderBrowser(t) {
    const raw = shared("space-archive.v1");
    const incompatible = raw && typeof raw === "object" && raw.version !== undefined && raw.version !== ARCHIVE_VERSION;
    const records = archiveRecords();
    const shown = filterRecords(records, this.filter);
    const groups = groupRecords(shown);
    const liveIds = availableSpaceIds();
    const available = shown.filter((record) => liveIds.has(record.id));
    const activeCount = spaces().filter((space) => !isArchived(space.id)).length;
    return v_flex().id("space-archive").track_focus(this.handle)
      .on_key_down((event, cx) => {
        if (event.key === "escape") {
          closeOverlay(props().overlay);
          cx.stop_propagation();
        }
      })
      .size_full().min_h(0).p(20).gap(14).bg(t.popover).text_size(12)
      .child(h_flex().items_center().gap(10)
        .child(v_flex().flex_1().gap(3)
          .child(div().text_size(17).font_semibold().text_color(t.foreground).child("Space archive"))
          .child(div().text_size(11.5).text_color(t.muted).child(`${records.length} archived · ${activeCount} active`)))
        .child(button("archive-close", "Close", () => closeOverlay(props().overlay), t)))
      .child(div().text_size(11.5).text_color(t.muted)
        .child("Archiving hides a space from navigation. Its tabs and processes keep their current state."))
      .when(incompatible || this.error, (el) => el.child(div().px(10).py(8).rounded(7).bg(t.raised).text_color(t.blocked)
        .child(this.error || `Archive data version ${raw.version} requires a newer mod.`)))
      .child(Input.new(this.input).h(35).flex_none().px(10).rounded(8).border(1)
        .border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground))
      .when(this.undo, (el) => el.child(h_flex().min_h(32).px(10).gap(12).items_center().rounded(7).bg(t.selected)
        .child(div().flex_1().text_color(t.foreground).child(this.undo.label))
        .child(button("archive-undo", "Undo", () => this.undoLast(), t))))
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().text_size(11).text_color(t.dim).child(`${shown.length} shown`))
        .when(available.length > 1, (el) => el.child(button("restore-shown", "Restore shown", () => this.restore(available.map((record) => record.id)), t))))
      .child(v_flex().id("archive-list").flex_1().min_h(0).overflow_y_scrollbar().gap(15)
        .when(!groups.length, (el) => el.child(v_flex().flex_1().items_center().justify_center().gap(5)
          .child(div().text_size(13).font_semibold().text_color(t.foreground).child(records.length ? "No matches" : "Archive is empty"))
          .child(div().text_size(11.5).text_color(t.muted).child(records.length ? "Try another name, branch or path." : "Archived spaces will appear here."))))
        .children(groups.map((group) => this.group(group, liveIds, t))));
  }

  render() {
    if (this.mode === "controller") this.processRequest();
    const t = theme();
    return this.mode === "controller" ? this.renderController(t) : this.renderBrowser(t);
  }
}
