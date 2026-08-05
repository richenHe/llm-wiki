import type { LearningNode } from "./learning-data"

export function selectVisibleLearningNodes(
  nodes: readonly LearningNode[],
  selectedNodeId: string | null,
  childWindowOffset: number,
  childWindowSize: number,
): LearningNode[] {
  if (!selectedNodeId) {
    const roots = nodes.filter((node) => node.parentId === null).slice(0, 48)
    const rootIds = new Set(roots.map((node) => node.id))
    const representatives = nodes
      .filter((node) => node.parentId && rootIds.has(node.parentId))
      .sort((a, b) => (b.linkCount ?? 0) - (a.linkCount ?? 0))
      .slice(0, Math.max(0, 72 - roots.length))
    return [...roots, ...representatives]
  }

  const selected = nodes.find((node) => node.id === selectedNodeId)
  if (!selected) return nodes.slice(0, 72)
  const children = nodes.filter((node) => node.parentId === selected.id)
  const safeOffset = children.length === 0 ? 0 : childWindowOffset % children.length
  const rotatedChildren = [...children.slice(safeOffset), ...children.slice(0, safeOffset)].slice(0, childWindowSize)
  const siblings = nodes.filter((node) => node.parentId === selected.parentId && node.id !== selected.id).slice(0, 14)
  const ancestors: LearningNode[] = []
  let parentId = selected.parentId
  while (parentId) {
    const parent = nodes.find((node) => node.id === parentId)
    if (!parent) break
    ancestors.push(parent)
    parentId = parent.parentId
  }
  const relatedIds = new Set(selected.prerequisiteIds)
  const related = nodes.filter((node) => relatedIds.has(node.id)).slice(0, 8)
  return [...new Map([selected, ...rotatedChildren, ...siblings, ...ancestors, ...related].map((node) => [node.id, node])).values()]
}
