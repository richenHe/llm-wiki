import type { LearningNode } from "./learning-data"

export type SphereNavigationKind = "enter" | "back" | "jump"

function isAncestor(ancestorId: string, nodeId: string, nodeIndex: ReadonlyMap<string, LearningNode>): boolean {
  const seen = new Set<string>()
  let cursor = nodeIndex.get(nodeId)
  while (cursor?.parentId && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    if (cursor.parentId === ancestorId) return true
    cursor = nodeIndex.get(cursor.parentId)
  }
  return false
}

export function getSphereNavigationKind(
  previousNodeId: string | null,
  nextNodeId: string | null,
  nodes: readonly LearningNode[],
): SphereNavigationKind {
  if (previousNodeId === null && nextNodeId !== null) return "enter"
  if (previousNodeId !== null && nextNodeId === null) return "back"
  if (previousNodeId === null || nextNodeId === null) return "jump"

  const nodeIndex = new Map(nodes.map((node) => [node.id, node]))
  if (isAncestor(previousNodeId, nextNodeId, nodeIndex)) return "enter"
  if (isAncestor(nextNodeId, previousNodeId, nodeIndex)) return "back"
  return "jump"
}

export function getKnowledgeScopeIds(nodes: readonly LearningNode[], selectedNodeId: string | null): Set<string> {
  if (selectedNodeId === null) return new Set(nodes.map((node) => node.id))

  const childrenByParent = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.parentId === null) continue
    const siblings = childrenByParent.get(node.parentId) ?? []
    siblings.push(node.id)
    childrenByParent.set(node.parentId, siblings)
  }

  const pending = [selectedNodeId]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const nodeId = pending.pop()
    if (!nodeId || visited.has(nodeId)) continue
    visited.add(nodeId)
    pending.push(...(childrenByParent.get(nodeId) ?? []))
  }
  return visited
}

export function getKnowledgeScopeCount(nodes: readonly LearningNode[], selectedNodeId: string | null): number {
  return Math.max(getKnowledgeScopeIds(nodes, selectedNodeId).size, 1)
}

export function getSphereParticleCount(knowledgeCount: number, visibleCount: number): number {
  return Math.max(visibleCount, Math.min(720, Math.max(64, Math.round(knowledgeCount))))
}

export function getSphereRadius(knowledgeCount: number): number {
  const growth = Math.log2(Math.max(knowledgeCount, 1) + 1) / 10
  return 2.18 + Math.min(1.18, growth * 1.42)
}
