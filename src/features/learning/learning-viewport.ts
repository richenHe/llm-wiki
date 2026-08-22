import type { LearningNode } from "./learning-data"

export function selectVisibleLearningNodes(
  nodes: readonly LearningNode[],
  selectedNodeId: string | null,
  childWindowOffset: number,
  childWindowSize: number,
): LearningNode[] {
  if (!selectedNodeId) {
    return nodes.filter((node) => node.parentId === null).slice(0, 48)
  }

  const selected = nodes.find((node) => node.id === selectedNodeId)
  if (!selected) return nodes.filter((node) => node.parentId === null).slice(0, 48)
  const children = nodes.filter((node) => node.parentId === selected.id)
  const safeOffset = children.length === 0 ? 0 : childWindowOffset % children.length
  const rotatedChildren = [...children.slice(safeOffset), ...children.slice(0, safeOffset)].slice(0, childWindowSize)
  return [selected, ...rotatedChildren]
}
