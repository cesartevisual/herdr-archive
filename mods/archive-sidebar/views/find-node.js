// The node with this id in the shown layout's tree.
export function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// Whether the layout has a spaces list (a better-sidebar block without a `view`).
export function hasSpacesView(node) {
  if (node?.mod === "archive-sidebar" && !node.props?.view) return true;
  return (node?.children ?? []).some(hasSpacesView);
}
