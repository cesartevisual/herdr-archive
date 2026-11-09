// Agents drawn inside the spaces list: each space's agents under its row, their
// sub-agents nested below on tree lines. Shares its look with views/agents.js.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, terminals, focused, spaces, run, shared, setShared } from "herdr";
import { TEXT, Icon } from "./ui.js";
import { RANK, kidStatus, duration, icon, agentLabel, statusMark } from "./agents.js";
import { activeSpaces, isArchived } from "./archive-state.js";

// Spaces drawing agents inline; the footer and the spaces header read and set it.
export const INLINE_KEY = "archive-sidebar.inline-agents";
export const inlineAgents = () => shared(INLINE_KEY) ?? shared("better-sidebar.inline-agents") ?? true;

const urgent = (statuses) => statuses.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);

// Everything one render needs: top-level agents per space and every live terminal.
export function readAgents() {
  const listed = agents().filter((a) => !isArchived(a.space));
  const all = terminals();
  const status = new Map(listed.map((a) => [a.address, a.status]));
  const parentOf = new Map(all.map((k) => [k.address, k.parent]));
  const bySpace = new Map();
  // A sub-agent kept as a pane shows under its parent, not as its own agent.
  for (const a of listed) {
    if (status.has(parentOf.get(a.address))) continue;
    bySpace.set(a.space, [...(bySpace.get(a.space) ?? []), a]);
  }
  return { listed, all, status, bySpace, paneOf: new Map(listed.map((a) => [a.address, a.pane])) };
}

// Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
export function subTree(all, addr, lead = []) {
  const kids = all.filter((k) => k.parent === addr && k.state === "live");
  return kids.flatMap((k, i) => {
    const last = i === kids.length - 1;
    return [{ t: k, lines: [...lead, last ? "└" : "├"] }, ...subTree(all, k.address, [...lead, last ? "" : "│"])];
  });
}

// Counts for a set of spaces: agents, sub-agents, how many need you, the most urgent state.
export function tally(view, spaceIds) {
  let count = 0, subs = 0, blocked = 0, working = 0;
  const statuses = [];
  for (const id of spaceIds)
    for (const a of view.bySpace.get(id) ?? []) {
      count++;
      statuses.push(a.status);
      if (a.status === "blocked") blocked++;
      if (a.status === "working") working++;
      for (const s of subTree(view.all, a.address)) {
        const st = kidStatus(s.t, view.status);
        subs++;
        statuses.push(st);
        if (st === "blocked") blocked++;
        if (st === "working") working++;
      }
    }
  return { count, subs, blocked, working, top: urgent(statuses) };
}

export class SpaceAgents {
  constructor() {
    this.folded = new Set(this.load("agents.folded", []));
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = this.load("agents.changed", {});
  }

  load(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
    } catch {
      return fallback;
    }
  }

  // Read once per render; done and idle count as one state for the elapsed time.
  refresh() {
    this.view = readAgents();
    this.shown = focused()?.agent;
    this.label = agentLabel();
    const now = (this.now = Date.now());
    const tabs = new Map(spaces().flatMap((sp) => sp.tabs).map((tab) => [tab.id, tab]));
    let dirty = false;
    for (const a of this.view.listed) {
      const s = a.status === "done" ? "idle" : a.status;
      const seen = this.changed[a.address];
      if (seen?.s === s) continue;
      // First sight: the tab knows when it last changed, better than "now".
      this.changed[a.address] = { s, at: seen ? now : (tabs.get(a.tab)?.changed_at ?? now) };
      dirty = true;
    }
    if (!dirty) return;
    const live = new Set(this.view.listed.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!live.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("agents.changed", JSON.stringify(this.changed));
  }

  has(spaceId) {
    return (this.view?.bySpace.get(spaceId)?.length ?? 0) > 0;
  }

  // agent.next / agent.prev follow the order drawn here.
  order(spaceIds) {
    const out = [];
    for (const id of spaceIds)
      for (const a of this.view.bySpace.get(id) ?? [])
        out.push(a.address, ...subTree(this.view.all, a.address).map((s) => s.t.address).filter((x) => this.view.status.has(x)));
    return out;
  }

  // The rows under a space; `indent` lines them up with the space's name.
  rows(spaceId, t, indent) {
    return (this.view.bySpace.get(spaceId) ?? []).flatMap((a) => {
      const subs = subTree(this.view.all, a.address);
      const row = this.agentRow(a, subs, t, indent);
      if (this.folded.has(a.address)) return [row];
      return [row, ...subs.map((s) => this.subRow(s, t, indent + 6))];
    });
  }

  // A folded space's line: "2 agents · 3 sub" and the most urgent state.
  summary(spaceIds, t) {
    const { count, subs, top } = tally(this.view, spaceIds);
    if (!count) return null;
    const text = `${count} agent${count === 1 ? "" : "s"}${subs ? ` · ${subs} sub` : ""}`;
    return h_flex().flex_none().gap(5).items_center().text_size(TEXT.caption).text_color(t.muted)
      .child(text).child(statusMark(t, top));
  }

  // A folded folder's line: how many need you, then how many are working.
  folderSummary(spaceIds, t) {
    const { blocked, working } = tally(this.view, spaceIds);
    if (!blocked && !working) return null;
    return h_flex().flex_none().gap(6).items_center().text_size(TEXT.caption)
      .when(blocked > 0, (el) => el.child(div().flex_none().px(5).py(1).rounded(4).bg(t.blocked + "26").text_color(t.blocked)
        .font_semibold().child(`${blocked} need${blocked === 1 ? "s" : ""} you`)))
      .when(working > 0, (el) => el.child(h_flex().flex_none().gap(4).items_center().text_color(t.working)
        .child(Icon("spinner").size(11).flex_none().spin(900)).child(`${working} working`)));
  }

  toggle(addr, cx) {
    if (!this.folded.delete(addr)) this.folded.add(addr);
    localStorage.setItem("agents.folded", JSON.stringify([...this.folded]));
    cx.notify();
  }

  // A sub-agent kept as a pane is focused there; one without a pane is peeked.
  open(addr) {
    const pane = this.view.paneOf.get(addr);
    if (pane) run("pane.focus", { pane });
    else run("terminal.peek", { terminal: addr });
  }

  name(a) {
    const label = this.label(a);
    return /^\d+$/.test(label) ? a.program?.name || label : label;
  }

  agentRow(a, subs, t, indent) {
    const pic = icon(a.program, 14, t.foreground);
    const when = this.changed[a.address]?.at;
    const idle = a.status === "idle" && !a.focused;
    return h_flex()
      .id(`sa-${a.address}`)
      .h(26)
      .flex_none()
      .pl(indent)
      .pr(8)
      .gap(8)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .when(a.focused, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(idle ? t.muted : t.foreground).child(this.name(a)))
      .when(subs.length > 0, (el) => el.child(this.foldButton(a, subs, t)))
      .when(Boolean(when), (el) => el.child(div().flex_none().text_size(TEXT.caption).text_color(t.dim).child(duration(this.now - when))))
      .child(statusMark(t, this.shownStatus(a, subs)));
  }

  // An agent's own status, or "blocked" when one of its folded sub-agents needs you.
  shownStatus(a, subs) {
    const hidden = this.folded.has(a.address) && subs.some((s) => kidStatus(s.t, this.view.status) === "blocked");
    return hidden ? "blocked" : a.status;
  }

  // The sub-agents' chevron; folded, their count in the most urgent one's color.
  foldButton(a, subs, t) {
    const open = !this.folded.has(a.address);
    const top = urgent(subs.map((s) => kidStatus(s.t, this.view.status)));
    return h_flex()
      .id(`sa-fold-${a.address}`)
      .h(18)
      .px(3)
      .gap(3)
      .flex_none()
      .items_center()
      .rounded(4)
      .text_size(TEXT.caption)
      .text_color(open ? t.dim : (t[top] ?? t.dim))
      .tooltip(open ? "Hide sub-agents" : `Show ${subs.length} sub-agent${subs.length === 1 ? "" : "s"}`)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.toggle(a.address, cx);
      })
      .child(Icon(`chevron-${open ? "down" : "right"}`, 11))
      .when(!open, (el) => el.child(String(subs.length)));
  }

  subRow(s, t, indent) {
    const k = s.t;
    const st = kidStatus(k, this.view.status);
    const pic = icon(k.program, 13, t.foreground);
    const on = k.address === this.shown;
    return h_flex()
      .id(`sa-sub-${k.address}`)
      .h(24)
      .flex_none()
      .pl(indent)
      .pr(8)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .when(on, (el) => el.bg(t.raised))
      .hover((x) => x.bg(t.hover))
      .on_click(() => this.open(k.address))
      .children(s.lines.map((l) => this.line(l, t)))
      .when(Boolean(pic), (el) => el.child(div().flex_none().mr(7).opacity(0.85).child(pic)))
      .child(div().flex_1().min_w(0).truncate().text_size(TEXT.small)
        .text_color(on || st === "blocked" ? t.foreground : t.muted)
        .child(k.name || k.template || k.program?.name || k.address))
      .child(statusMark(t, st));
  }

  // One tree column: │ runs through, ├ runs through with an elbow, └ ends in one.
  line(l, t) {
    const col = div().relative().w(11).h(24).mr(6).flex_none();
    if (!l) return col;
    const through = div().absolute().left(0).top(0).bottom(0).border_l(1.5).border_color(t.input);
    const elbow = div().absolute().left(0).top(0).w(9).h(12).border_l(1.5).border_b(1.5).rounded_bl(6).border_color(t.input);
    if (l === "│") return col.child(through);
    if (l === "├") return col.child(through).child(elbow);
    return col.child(elbow);
  }
}

// Turns agents in spaces on or off; the Agents panel shows when they're off.
export function setInlineAgents(on, layoutNode) {
  setShared(INLINE_KEY, on);
  if (layoutNode) run(on ? "layout.hide" : "layout.show", { id: layoutNode.id });
}

// Spaces' ids, for counting everything (the footer).
export const allSpaceIds = () => activeSpaces().map((s) => s.id);
