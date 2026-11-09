// Next/previous space in the spaces list's order, which the list shares as it draws.
import { spaces, focused, run, shared } from "herdr";
import { readAgents, subTree } from "./space-agents.js";
import { activeSpaces } from "./archive-state.js";

export const ORDER_KEY = "archive-sidebar.space-order";

function spaceOrder() {
  const live = activeSpaces().map((w) => w.id);
  const known = (shared(ORDER_KEY) ?? []).filter((id) => live.includes(id));
  return [...known, ...live.filter((id) => !known.includes(id))];
}

export function stepSpace(dir) {
  const order = spaceOrder();
  const at = order.indexOf(focused()?.space);
  if (!order.length) return;
  if (at < 0) return run("space.select", { id: order[dir > 0 ? 0 : order.length - 1] });
  run("space.select", { id: order[(at + dir + order.length) % order.length] });
}

// Next/previous agent as the list draws them, sub-agents under their parent. Herdr's agent.next
// steps from a focused sub-agent as if it were its parent, so it can't get past one listed after it.
export function stepAgent(dir) {
  const view = readAgents();
  const order = spaceOrder().flatMap((id) =>
    (view.bySpace.get(id) ?? []).flatMap((a) => [a.address, ...subTree(view.all, a.address).map((s) => s.t.address).filter((x) => view.status.has(x))]));
  const at = order.indexOf(focused()?.agent);
  if (!order.length) return;
  if (at < 0) return run("agent.focus", { terminal: order[dir > 0 ? 0 : order.length - 1] });
  run("agent.focus", { terminal: order[(at + dir + order.length) % order.length] });
}

export function selectVisibleSpace(number) {
  const id = spaceOrder()[number - 1];
  if (id) run("space.select", { id });
}
