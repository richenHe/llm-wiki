import type { LearningNode } from "./learning-data"

export type LearningBoardKind = "category" | "process" | "prerequisite"

export interface LearningMnemonicPart {
  nodeId: string
  phrase: string
}

export interface LearningBoardEvidence {
  nodeId: string
  detail: string
}

export interface LearningBoard {
  id: string
  title: string
  centralQuestion: string
  kind: LearningBoardKind
  nodeIds: string[]
  orderedNodeIds: string[]
  reason: string
  evidence: LearningBoardEvidence[]
  confidence: number
  mnemonic: string
  mnemonicParts: LearningMnemonicPart[]
}

export interface LearningRouteNodeDecision {
  nodeId: string
  status: "linked" | "unlinked"
  boardIds: string[]
  reason: string
}

export interface LearningRouteCommunitySnapshot {
  key: string
  fingerprint: string
  nodeIds: string[]
  status: "ready" | "stale"
  boards: LearningBoard[]
  decisions: LearningRouteNodeDecision[]
  lastError?: string
}

export interface LearningRouteSnapshot {
  schemaVersion: 2
  generatedAt: string
  model: string
  status: "processing" | "ready" | "stale"
  progress: { processed: number; total: number }
  communities: LearningRouteCommunitySnapshot[]
  lastError?: string
}

export function learningBoards(snapshot: LearningRouteSnapshot | null): LearningBoard[] {
  return snapshot?.communities.flatMap((community) => community.boards) ?? []
}

export function learningRouteProgress(snapshot: LearningRouteSnapshot | null): { processed: number; total: number } {
  return snapshot?.progress ?? { processed: 0, total: 0 }
}

export function findBestLearningBoard(
  snapshot: LearningRouteSnapshot | null,
  nodeId: string,
): LearningBoard | null {
  const candidates = learningBoards(snapshot).filter((board) => board.nodeIds.includes(nodeId))
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => {
    const aOrdered = a.orderedNodeIds.includes(nodeId) ? 1 : 0
    const bOrdered = b.orderedNodeIds.includes(nodeId) ? 1 : 0
    return bOrdered - aOrdered || b.confidence - a.confidence || a.nodeIds.length - b.nodeIds.length
  })[0]
}

export function learningBoardNodes(board: LearningBoard, nodes: readonly LearningNode[]): LearningNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ids = board.orderedNodeIds.length >= 2 ? board.orderedNodeIds : board.nodeIds
  return ids.map((id) => byId.get(id)).filter((node): node is LearningNode => Boolean(node))
}
