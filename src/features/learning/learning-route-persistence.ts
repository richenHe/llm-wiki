import { fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import type {
  LearningBoard,
  LearningBoardKind,
  LearningBoardRelation,
  LearningBoardRelationKind,
  LearningRouteCommunitySnapshot,
  LearningRouteNodeDecision,
  LearningRouteSnapshot,
} from "./learning-routes"

const ROUTES_RELATIVE_PATH = ".llm-wiki/learning/routes.json"
const BOARD_KINDS = new Set<LearningBoardKind>(["category", "process", "prerequisite"])
const RELATION_KINDS = new Set<LearningBoardRelationKind>(["connection", "prerequisite", "process", "application"])
const VAGUE_RELATION_LABELS = new Set(["相关", "有关", "联系", "关系"])

function routesPath(projectPath: string): string {
  return `${projectPath.replace(/[\\/]+$/, "")}/${ROUTES_RELATIVE_PATH}`
}

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

function previewStorageKey(projectPath: string): string {
  return `llm-wiki:learning-routes:${projectPath}`
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim())
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(nonEmptyString).map((item) => item.trim()))]
}

function parseRelations(value: unknown, nodeIds: readonly string[]): LearningBoardRelation[] {
  if (!Array.isArray(value)) return []
  const allowedIds = new Set(nodeIds)
  const seenPairs = new Set<string>()
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const relation = item as Record<string, unknown>
    const sourceId = nonEmptyString(relation.sourceId) ? relation.sourceId.trim() : ""
    const targetId = nonEmptyString(relation.targetId) ? relation.targetId.trim() : ""
    const kind = RELATION_KINDS.has(relation.kind as LearningBoardRelationKind) ? relation.kind as LearningBoardRelationKind : null
    const label = nonEmptyString(relation.label) ? relation.label.trim() : ""
    const evidence = nonEmptyString(relation.evidence) ? relation.evidence.trim() : ""
    const pairKey = [sourceId, targetId].sort().join(":::")
    if (!kind || !allowedIds.has(sourceId) || !allowedIds.has(targetId) || sourceId === targetId || !label || Array.from(label).length > 10 || VAGUE_RELATION_LABELS.has(label) || !evidence || seenPairs.has(pairKey)) return []
    seenPairs.add(pairKey)
    return [{ sourceId, targetId, kind, label, evidence }]
  })
}

function relationsConnectAll(relations: readonly LearningBoardRelation[], nodeIds: readonly string[]): boolean {
  if (relations.length < nodeIds.length - 1) return false
  const connected = new Set<string>([nodeIds[0]])
  let changed = true
  while (changed) {
    changed = false
    for (const relation of relations) {
      if (connected.has(relation.sourceId) && !connected.has(relation.targetId)) {
        connected.add(relation.targetId)
        changed = true
      } else if (connected.has(relation.targetId) && !connected.has(relation.sourceId)) {
        connected.add(relation.sourceId)
        changed = true
      }
    }
  }
  return connected.size === nodeIds.length
}

function relationsMatchOrderedBoard(relations: readonly LearningBoardRelation[], kind: LearningBoardKind, orderedNodeIds: readonly string[]): boolean {
  if (kind === "category") return true
  return orderedNodeIds.slice(0, -1).every((sourceId, index) => relations.some((relation) => (
    relation.sourceId === sourceId
    && relation.targetId === orderedNodeIds[index + 1]
    && relation.kind === kind
  )))
}

function parseBoard(value: unknown): LearningBoard | null {
  if (!value || typeof value !== "object") return null
  const board = value as Record<string, unknown>
  const kind = BOARD_KINDS.has(board.kind as LearningBoardKind) ? board.kind as LearningBoardKind : null
  const nodeIds = stringArray(board.nodeIds)
  const orderedNodeIds = stringArray(board.orderedNodeIds)
  const evidence = Array.isArray(board.evidence)
    ? board.evidence.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const entry = item as Record<string, unknown>
      return nonEmptyString(entry.nodeId) && nonEmptyString(entry.detail)
        ? [{ nodeId: entry.nodeId.trim(), detail: entry.detail.trim() }]
        : []
    })
    : []
  const mnemonicParts = Array.isArray(board.mnemonicParts)
    ? board.mnemonicParts.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const entry = item as Record<string, unknown>
      return nonEmptyString(entry.nodeId) && nonEmptyString(entry.phrase)
        ? [{ nodeId: entry.nodeId.trim(), phrase: entry.phrase.trim() }]
        : []
    })
    : []
  if (
    !kind || !nonEmptyString(board.id) || !nonEmptyString(board.title)
    || !nonEmptyString(board.centralQuestion) || !nonEmptyString(board.reason)
    || !nonEmptyString(board.mnemonic) || nodeIds.length < 2 || nodeIds.length > 8
  ) return null
  const reason = board.reason.trim()
  const nodeIdSet = new Set(nodeIds)
  const effectiveOrder = kind === "category" ? nodeIds : orderedNodeIds
  if (effectiveOrder.length !== nodeIds.length || !effectiveOrder.every((id) => nodeIdSet.has(id))) return null
  if (!nodeIds.every((id) => evidence.some((entry) => entry.nodeId === id))) return null
  if (!nodeIds.every((id) => mnemonicParts.some((entry) => entry.nodeId === id))) return null
  const confidence = Number(board.confidence)
  if (!Number.isFinite(confidence) || confidence < 0.78) return null
  let relations = parseRelations(board.relations, nodeIds)
  if (!relationsConnectAll(relations, nodeIds) || !relationsMatchOrderedBoard(relations, kind, effectiveOrder)) relations = []
  if (relations.length === 0 && kind !== "category") {
    relations = effectiveOrder.slice(0, -1).map((sourceId, index) => ({
      sourceId,
      targetId: effectiveOrder[index + 1],
      kind,
      label: kind === "process" ? "接着发生" : "理解前置",
      evidence: reason,
    }))
  }
  return {
    id: board.id.trim(),
    title: board.title.trim(),
    centralQuestion: board.centralQuestion.trim(),
    kind,
    nodeIds,
    orderedNodeIds: effectiveOrder,
    reason,
    evidence,
    confidence: Math.min(1, confidence),
    mnemonic: board.mnemonic.trim(),
    mnemonicParts,
    relations,
  }
}

function parseDecision(value: unknown, boardIds: ReadonlySet<string>): LearningRouteNodeDecision | null {
  if (!value || typeof value !== "object") return null
  const decision = value as Record<string, unknown>
  const nodeId = nonEmptyString(decision.nodeId) ? decision.nodeId.trim() : ""
  const status = decision.status === "linked" || decision.status === "unlinked" ? decision.status : null
  const ids = stringArray(decision.boardIds)
  const reason = nonEmptyString(decision.reason) ? decision.reason.trim() : ""
  if (!nodeId || !status || !reason) return null
  if (status === "linked" && (ids.length === 0 || !ids.every((id) => boardIds.has(id)))) return null
  if (status === "unlinked" && ids.length > 0) return null
  return { nodeId, status, boardIds: ids, reason }
}

function parseCommunity(value: unknown, legacy = false): LearningRouteCommunitySnapshot | null {
  if (!value || typeof value !== "object") return null
  const community = value as Record<string, unknown>
  if (!nonEmptyString(community.key) || !nonEmptyString(community.fingerprint)) return null
  const nodeIds = stringArray(community.nodeIds)
  const boards = Array.isArray(community.boards) ? community.boards.map(parseBoard).filter((board): board is LearningBoard => Boolean(board)) : []
  const boardIds = new Set(boards.map((board) => board.id))
  let decisions = Array.isArray(community.decisions)
    ? community.decisions.map((decision) => parseDecision(decision, boardIds)).filter((decision): decision is LearningRouteNodeDecision => Boolean(decision))
    : []
  if (legacy && decisions.length === 0) {
    const boardIdsByNode = new Map<string, string[]>()
    for (const board of boards) {
      for (const nodeId of board.nodeIds) {
        const ids = boardIdsByNode.get(nodeId) ?? []
        ids.push(board.id)
        boardIdsByNode.set(nodeId, ids)
      }
    }
    decisions = [...boardIdsByNode].map(([nodeId, ids]) => ({
      nodeId,
      status: "linked" as const,
      boardIds: ids,
      reason: "由旧版已审核板块迁移，等待新版逐项账本重新确认。",
    }))
  }
  const decisionIds = new Set(decisions.map((decision) => decision.nodeId))
  const status = community.status === "ready" && nodeIds.every((id) => decisionIds.has(id)) ? "ready" : "stale"
  return {
    key: community.key.trim(),
    fingerprint: community.fingerprint.trim(),
    nodeIds,
    status,
    boards,
    decisions,
    lastError: nonEmptyString(community.lastError) ? community.lastError.trim() : undefined,
  }
}

export function parseLearningRouteSnapshot(raw: string): LearningRouteSnapshot | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const sourceVersion = Number(value.schemaVersion)
    if (![1, 2].includes(sourceVersion) || !Array.isArray(value.communities)) return null
    const communities = value.communities.map((community) => parseCommunity(community, sourceVersion === 1)).filter((item): item is LearningRouteCommunitySnapshot => Boolean(item))
    const candidateCount = new Set(communities.flatMap((community) => community.nodeIds)).size
    const decidedCount = new Set(communities.flatMap((community) => community.decisions.map((decision) => decision.nodeId))).size
    const total = sourceVersion === 1 ? candidateCount : Math.max(0, Number((value.progress as Record<string, unknown> | undefined)?.total) || 0)
    const processed = sourceVersion === 1 ? decidedCount : Math.min(total, Math.max(0, Number((value.progress as Record<string, unknown> | undefined)?.processed) || 0))
    const complete = processed === total && total === candidateCount && communities.every((item) => item.status === "ready")
    const status = sourceVersion === 2 && value.status === "ready" && complete ? "ready" : sourceVersion === 2 && value.status === "processing" ? "processing" : "stale"
    return {
      schemaVersion: 2,
      generatedAt: nonEmptyString(value.generatedAt) ? value.generatedAt.trim() : new Date(0).toISOString(),
      model: nonEmptyString(value.model) ? value.model.trim() : "unknown",
      status,
      progress: { processed, total },
      communities,
      lastError: nonEmptyString(value.lastError) ? value.lastError.trim() : undefined,
    }
  } catch {
    return null
  }
}

export async function loadLearningRouteSnapshot(projectPath: string): Promise<LearningRouteSnapshot | null> {
  try {
    if (!hasTauriRuntime()) {
      const raw = localStorage.getItem(previewStorageKey(projectPath))
      return raw ? parseLearningRouteSnapshot(raw) : null
    }
    const path = routesPath(projectPath)
    if (!(await fileExists(path))) return null
    return parseLearningRouteSnapshot(await readFile(path))
  } catch (error) {
    console.warn("[learning-routes] failed to load", error)
    return null
  }
}

export async function saveLearningRouteSnapshot(projectPath: string, snapshot: LearningRouteSnapshot): Promise<void> {
  const contents = `${JSON.stringify(snapshot, null, 2)}\n`
  if (!hasTauriRuntime()) {
    localStorage.setItem(previewStorageKey(projectPath), contents)
    return
  }
  await writeFileAtomic(routesPath(projectPath), contents)
}
