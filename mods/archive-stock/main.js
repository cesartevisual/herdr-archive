import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { agents, spaces, panes, focused, run, theme, props, closeOverlay, openOverlay, nextCommand, setAgentOrder, layout, window, exec, shared, setShared } from "herdr";
// Herdr confines module imports to one mod. Read the core archive's shared state;
// only space-archive writes it.
const archiveRecords = () => Object.values(shared("space-archive.v1")?.records ?? {})
  .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
const isArchived = (id) => Boolean(id && shared("space-archive.v1")?.records?.[id]);

const visibleSpaces = () => spaces().filter((space) => !isArchived(space.id));
const visibleAgents = () => agents().filter((agent) => !isArchived(agent.space));
const openArchive = (options = {}) => openOverlay({ mod: "space-archive", kind: "dialog", width: 760, height: 0.82, props: options });
const shortPath = (folder) => folder?.split(/[\\/]/).filter(Boolean).at(-1) || folder || "Space";

function sidebarWidth(node = layout()) {
  if (node?.id === "sidebar") return node.size?.px ?? 268;
  for (const child of node?.children ?? []) {
    const width = sidebarWidth(child);
    if (width != null) return width;
  }
  return null;
}

function button(id, label, click, t, compact = false, display = label) {
  return h_flex().id(id).h(28).px(compact ? 5 : 9).items_center().justify_center().rounded(6)
    .text_size(12).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
    .tooltip(label).role("button").accessibility_label(label)
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation()).on_click(click).child(display);
}

export default class ArchiveStock extends View {
  init(given, cx) {
    const p = props() ?? given ?? {};
    this.view = p.view ?? "spaces";
    this.id = p.id;
    this.filter = "";
    if (this.view === "spaces") {
      this.repoByLocation = new Map();
      this.repoLoading = new Set();
      this.parentsText = "";
      this.syncParents(cx);
      cx.timer.every(5000, (cx) => this.syncParents(cx));
      cx.spawn(async (cx) => {
        for (;;) {
          const command = await nextCommand();
          this.command(command);
          cx.notify();
        }
      });
    }
    if (this.view === "picker") {
      this.input = InputState.new({ placeholder: "Find a space, agent or archive…" });
      this.input.on("change", (_event, cx) => { this.filter = this.input.value(); cx.notify(); });
      this.input.on("submit", () => this.pick(this.searchResults()[0]));
      this.input.focus();
    }
  }

  syncParents(cx) {
    const paneList = panes();
    const parents = {};
    for (const space of spaces()) {
      const tabs = new Set((space.tabs ?? []).map((tab) => tab.id));
      const folder = paneList.find((pane) => tabs.has(pane.tab) && pane.cwd)?.cwd || space.folder;
      const location = JSON.stringify([space.machine ?? null, folder]);
      const repo = this.repoByLocation.get(location);
      parents[space.id] = repo ?? { key: `space:${space.id}`, label: space.name || shortPath(folder) };
      if (!folder || this.repoByLocation.has(location) || this.repoLoading.has(location)) continue;
      this.repoLoading.add(location);
      cx.spawn(async (cx) => {
        let info = null;
        try {
          const [top, common] = await Promise.all([
            exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on: space.machine }),
            exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on: space.machine }),
          ]);
          if (top.code === 0 && common.code === 0) {
            const root = top.stdout.trim();
            const git = common.stdout.trim();
            if (root && git) info = { key: JSON.stringify([space.machine ?? null, git]), label: shortPath(git.replace(/[/\\]\.git$/, "")) };
          }
        } catch {}
        this.repoByLocation.set(location, info);
        this.repoLoading.delete(location);
        this.syncParents(cx);
        cx.notify();
      });
    }
    const text = JSON.stringify(parents);
    if (text !== this.parentsText) {
      this.parentsText = text;
      setShared("archive-stock.space-parents", parents);
    }
  }

  command(command) {
    if (command === "next-space" || command === "prev-space") return this.stepSpace(command === "next-space" ? 1 : -1);
    if (command === "next-agent" || command === "prev-agent") return this.stepAgent(command === "next-agent" ? 1 : -1);
    if (command === "open-picker") return this.openPicker();
    const match = /^select-space:([1-9])$/.exec(command);
    if (match) this.selectSpace(Number(match[1]));
  }

  selectSpace(number) {
    const space = visibleSpaces()[number - 1];
    if (space) run("space.select", { id: space.id });
  }

  stepSpace(dir) {
    const list = visibleSpaces();
    if (!list.length) return;
    const at = list.findIndex((space) => space.id === focused()?.space);
    const index = at < 0 ? (dir > 0 ? 0 : list.length - 1) : (at + dir + list.length) % list.length;
    run("space.select", { id: list[index].id });
  }

  stepAgent(dir) {
    const list = visibleAgents();
    if (!list.length) return;
    const at = list.findIndex((agent) => agent.address === focused()?.agent);
    const index = at < 0 ? (dir > 0 ? 0 : list.length - 1) : (at + dir + list.length) % list.length;
    run("agent.focus", { terminal: list[index].address });
  }

  openPicker() {
    openOverlay({ mod: "archive-stock", kind: "popup", width: 560, height: 480, props: { view: "picker" } });
  }

  openMenu(id) {
    openOverlay({ mod: "archive-stock", kind: "popup", width: 238, height: 206, props: { view: "menu", id } });
  }

  close() {
    if (props()?.overlay) closeOverlay(props().overlay);
  }

  menuAction(action) {
    const id = this.id;
    this.close();
    if (action === "archive") return openArchive({ action: "archive", ids: [id] });
    if (action === "worktree") return openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 420, props: { space: id, action: "open" } });
    if (action === "rename") return run("space.rename", { id });
    if (action === "tab") return run("tab.new", { space: id });
  }

  renderMenu(t) {
    const space = spaces().find((s) => s.id === this.id);
    const entries = [["Rename", "rename"], ["New tab", "tab"], ["Open worktree…", "worktree"], ["Archive space", "archive"]];
    return v_flex().id("stock-space-menu").size_full().p(6).gap(2).bg(t.popover)
      .child(div().px(8).py(6).text_size(11).text_color(t.dim).truncate().child(space?.name ?? "Space"))
      .children(entries.map(([label, action]) => h_flex().id(`menu-${action}`).h(30).px(8).rounded(6).items_center()
        .text_size(12.5).text_color(action === "archive" ? t.accent : t.foreground)
        .cursor_pointer().hover((s) => s.bg(t.hover)).role("button").accessibility_label(label)
        .on_click(() => this.menuAction(action)).child(label)));
  }

  renderHeader(t) {
    const collapsed = sidebarWidth() < 160;
    const mac = window()?.platform === "macos" && !window()?.fullscreen;
    return h_flex().id("stock-brand").size_full().bg(t.chrome).items_center().gap(6).pl(mac && !collapsed ? 76 : 9).pr(9)
      .when(!collapsed, (el) => el.child(div().flex_1().min_w(0).font_semibold().text_size(14).text_color(t.foreground).child("Herdr")))
      .when(!collapsed, (el) => el.child(button("stock-search", "Search spaces", () => this.openPicker(), t, false, "⌕")))
      .when(!(mac && collapsed), (el) => el.child(button("stock-collapse", "Toggle sidebar", () => {
        const width = sidebarWidth();
        run("layout.resize", { id: "sidebar", px: width < 160 ? 268 : mac ? 76 : 44 });
      }, t, true, "☰")));
  }

  spaceRow(space, index, t, collapsed, bySpace) {
    const selected = space.active;
    const status = space.status;
    const title = space.name || shortPath(space.folder);
    const detail = space.branch || shortPath(space.folder);
    const agentCount = bySpace.get(space.id)?.length ?? 0;
    return h_flex().id(`stock-space-${space.id}`).h(collapsed ? 33 : 43).mx(6).px(8).gap(8).items_center().rounded(7)
      .bg(selected ? t.selected : t.chrome).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(collapsed ? `${title} · ${detail}` : title).role("button").accessibility_label(`Space ${index + 1}: ${title}`)
      .on_click(() => run("space.select", { id: space.id }))
      .child(div().w(17).flex_none().text_size(11).font_semibold().text_color(status ? (t[status] ?? t.accent) : t.dim).child(String(index + 1)))
      .when(!collapsed, (el) => el.child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
        .child(div().truncate().text_size(10.5).text_color(t.dim).child(detail))))
      .when(!collapsed && agentCount > 0, (el) => el.child(div().text_size(10).text_color(t.muted).child(String(agentCount))))
      .child(button(`stock-menu-${space.id}`, "Space actions", (_event, cx) => {
        cx.stop_propagation(); this.openMenu(space.id);
      }, t, true, "⋯"));
  }

  renderSpaces(t) {
    const list = visibleSpaces();
    const agentList = visibleAgents();
    const bySpace = new Map();
    for (const agent of agentList) bySpace.set(agent.space, [...(bySpace.get(agent.space) ?? []), agent]);
    setAgentOrder(agentList.map((agent) => agent.address));
    const collapsed = sidebarWidth() < 160;
    const machines = [...new Set(list.map((space) => space.machine ?? null))];
    const sections = machines.flatMap((machine) => {
      const mine = list.filter((space) => (space.machine ?? null) === machine);
      return [
        !collapsed ? div().id(`machine-${machine ?? "local"}`).px(14).pt(12).pb(6).text_size(10.5).font_semibold().text_color(t.dim).child(machine ?? "This computer") : null,
        ...mine.map((space) => this.spaceRow(space, list.indexOf(space), t, collapsed, bySpace)),
      ].filter(Boolean);
    });
    return v_flex().id("stock-spaces").size_full().min_h(0).bg(t.chrome)
      .child(h_flex().h(37).px(14).items_center().justify_between()
        .when(!collapsed, (el) => el.child(div().text_size(11).font_semibold().text_color(t.dim).child("SPACES")))
        .child(button("stock-new-space", "New space", () => run("space.new"), t, true, "+")))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().children(sections)
        .when(!list.length, (el) => el.child(div().px(14).py(14).text_size(12).text_color(t.muted)
          .child("All spaces archived. Open Archive below or create a space."))))
      .when(!collapsed && agentList.length > 0, (el) => el.child(v_flex().flex_none().h(Math.min(184, 34 + agentList.length * 27)).min_h(0).border_t(1).border_color(t.border).py(6)
        .child(div().px(14).py(4).text_size(10.5).font_semibold().text_color(t.dim).child("AGENTS"))
        .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().children(agentList.map((agent) => h_flex().id(`stock-agent-${agent.address}`).h(27).mx(6).px(8).gap(7).items_center().rounded(6)
          .cursor_pointer().hover((s) => s.bg(t.hover)).role("button").accessibility_label(`Go to ${agent.program?.name ?? "agent"} in ${agent.space_name ?? "space"}`)
          .on_click(() => run("agent.focus", { terminal: agent.address }))
          .child(div().size(6).rounded_full().bg(t[agent.status] ?? t.dim))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.foreground).child(agent.title || agent.program?.name || agent.address))
          .child(div().text_size(10).text_color(t.dim).child(agent.space_name ?? "")))))));
  }

  searchResults() {
    const query = this.filter.trim().toLowerCase();
    const active = visibleSpaces().filter((space) => !query || [space.name, space.folder, space.branch, space.machine].join(" ").toLowerCase().includes(query))
      .map((space) => ({ kind: "active", id: space.id, label: space.name || shortPath(space.folder), detail: space.branch || shortPath(space.folder) }));
    const archived = query ? archiveRecords().filter((record) => [record.name, record.folder, record.branch, record.machine].join(" ").toLowerCase().includes(query))
      .map((record) => ({ kind: "archived", id: record.id, label: record.name || shortPath(record.folder), detail: "Archived · restore in Archive" })) : [];
    return [...active, ...archived];
  }

  pick(result) {
    if (!result) return;
    this.close();
    if (result.kind === "archived") openArchive({ ids: [result.id] });
    else run("space.select", { id: result.id });
  }

  renderPicker(t) {
    const results = this.searchResults();
    return v_flex().id("stock-picker").size_full().min_h(0).p(16).gap(10).bg(t.popover)
      .child(h_flex().items_center().justify_between()
        .child(div().font_semibold().text_size(15).text_color(t.foreground).child("Go to space"))
        .child(button("stock-picker-close", "Close", () => this.close(), t)))
      .child(h_flex().h(37).px(10).items_center().rounded(7).border(1).border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(12.5).text_color(t.foreground)))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(3)
        .children(results.map((result) => h_flex().id(`stock-result-${result.id}`).h(37).px(9).items_center().gap(9).rounded(6)
          .cursor_pointer().hover((s) => s.bg(t.hover)).role("button").accessibility_label(`${result.kind === "archived" ? "Archived space" : "Space"}: ${result.label}`)
          .on_click(() => this.pick(result))
          .child(div().size(7).rounded_full().bg(result.kind === "archived" ? t.dim : t.accent))
          .child(div().flex_1().truncate().text_size(12.5).text_color(t.foreground).child(result.label))
          .child(div().truncate().text_size(10.5).text_color(t.dim).child(result.detail))))
        .child(button("stock-open-archive", `Open Archive (${archiveRecords().length})`, () => { this.close(); openArchive(); }, t)));
  }

  render() {
    const t = theme();
    if (this.view === "header") return this.renderHeader(t);
    if (this.view === "menu") return this.renderMenu(t);
    if (this.view === "picker") return this.renderPicker(t);
    return this.renderSpaces(t);
  }
}
