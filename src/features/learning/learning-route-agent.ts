import { streamChat, type ChatMessage } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type { GraphOutlineNode } from "@/lib/wiki-graph"
import type { LearningBoard, LearningBoardKind, LearningBoardRelation, LearningBoardRelationKind, LearningRouteNodeDecision } from "./learning-routes"

export interface LearningRouteCandidate {
  id: string
  title: string
  semanticType: string
  summary: string
  sourcePath: string
  outline: GraphOutlineNode[]
  neighborIds: string[]
  content: string
}

interface BoardProposal {
  title: string
  centralQuestion: string
  kind: LearningBoardKind
  nodeIds: string[]
  orderedNodeIds: string[]
  reason: string
  confidence: number
}

interface ProposalNodeDecision {
  nodeId: string
  status: "proposed" | "unlinked"
  reason: string
}

export interface LearningRouteGenerationResult {
  boards: LearningBoard[]
  decisions: LearningRouteNodeDecision[]
}

const BOARD_KINDS = new Set<LearningBoardKind>(["category", "process", "prerequisite"])
const RELATION_KINDS = new Set<LearningBoardRelationKind>(["connection", "prerequisite", "process", "application"])
const VAGUE_RELATION_LABELS = new Set(["相关", "有关", "联系", "关系"])
const MIN_APPROVED_CONFIDENCE = 0.78
const MAX_BOARD_SIZE = 8
const MAX_BOARDS_PER_PROPOSAL = 18
const MAX_CANDIDATES_PER_PROPOSAL = 20
const PROPOSAL_SCOPE_OVERLAP = 6
const MAX_DETAIL_CHARS = 2_400
const MAX_AUDIT_INPUT_CHARS = 42_000

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced ?? text).trim()
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("模型没有返回可读取的板块 JSON。")
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
}

function callRouteModel(
  config: LlmConfig,
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  maxTokens: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let result = ""
    let settled = false
    void streamChat(config, messages, {
      onToken: (token) => { result += token },
      onDone: () => {
        if (settled) return
        settled = true
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"))
          return
        }
        result.trim() ? resolve(result) : reject(new Error("串联模型没有返回内容。"))
      },
      onError: (error) => {
        if (settled) return
        settled = true
        reject(error)
      },
    }, signal, { temperature: 0.1, max_tokens: maxTokens })
  })
}

async function callJsonRouteModel(
  config: LlmConfig,
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  maxTokens: number,
): Promise<Record<string, unknown>> {
  const raw = await callRouteModel(config, messages, signal, maxTokens)
  try {
    return extractJson(raw)
  } catch (error) {
    const repaired = await callRouteModel(config, [
      { role: "system", content: "把下面内容修正为合法 JSON。不得增加、删除或改变任何知识判断，只返回 JSON。" },
      { role: "user", content: raw },
    ], signal, maxTokens)
    try {
      return extractJson(repaired)
    } catch {
      throw error
    }
  }
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function uniqueAllowedIds(value: unknown, allowedIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === "string" && allowedIds.has(item)))]
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const expected = new Set(a)
  return b.every((id) => expected.has(id))
}

export function sanitizeBoardProposals(value: unknown, allowedIds: ReadonlySet<string>): BoardProposal[] {
  if (!Array.isArray(value)) return []
  const result: BoardProposal[] = []
  for (const item of value.slice(0, MAX_BOARDS_PER_PROPOSAL)) {
    if (!item || typeof item !== "object") continue
    const raw = item as Record<string, unknown>
    const kind = BOARD_KINDS.has(raw.kind as LearningBoardKind) ? raw.kind as LearningBoardKind : null
    const nodeIds = uniqueAllowedIds(raw.nodeIds, allowedIds)
    const requestedOrder = uniqueAllowedIds(raw.orderedNodeIds, allowedIds)
    const orderedNodeIds = kind === "category" ? nodeIds : requestedOrder
    const confidence = Number(raw.confidence)
    if (
      !kind || nodeIds.length < 2 || nodeIds.length > MAX_BOARD_SIZE || !sameIds(nodeIds, orderedNodeIds)
      || !cleanString(raw.title) || !cleanString(raw.centralQuestion) || !cleanString(raw.reason)
      || !Number.isFinite(confidence) || confidence < 0.5
    ) continue
    result.push({
      title: cleanString(raw.title),
      centralQuestion: cleanString(raw.centralQuestion),
      kind,
      nodeIds,
      orderedNodeIds,
      reason: cleanString(raw.reason),
      confidence: Math.min(1, confidence),
    })
  }
  return result
}

export function sanitizeProposalNodeDecisions(
  value: unknown,
  allowedIds: ReadonlySet<string>,
  proposals: readonly BoardProposal[],
): ProposalNodeDecision[] | null {
  if (!Array.isArray(value)) return null
  const proposedIds = new Set(proposals.flatMap((proposal) => proposal.nodeIds))
  const decisions: ProposalNodeDecision[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== "object") return null
    const record = item as Record<string, unknown>
    const nodeId = cleanString(record.nodeId)
    const status = record.status === "proposed" || record.status === "unlinked" ? record.status : null
    const reason = cleanString(record.reason)
    if (!allowedIds.has(nodeId) || seen.has(nodeId) || !status || !reason) return null
    if ((status === "proposed") !== proposedIds.has(nodeId)) return null
    seen.add(nodeId)
    decisions.push({ nodeId, status, reason })
  }
  return seen.size === allowedIds.size ? decisions : null
}

function stableBoardId(board: Pick<BoardProposal, "kind" | "nodeIds">): string {
  const value = `${board.kind}:${[...board.nodeIds].sort().join("|")}`
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `learning-board-${(hash >>> 0).toString(36)}`
}

export function sanitizeBoardRelations(value: unknown, nodeIds: readonly string[], boardKind: LearningBoardKind, orderedNodeIds: readonly string[]): LearningBoardRelation[] {
  if (!Array.isArray(value)) return []
  const allowedIds = new Set(nodeIds)
  const relations: LearningBoardRelation[] = []
  const seenPairs = new Set<string>()
  for (const item of value.slice(0, Math.min(16, nodeIds.length * 2))) {
    if (!item || typeof item !== "object") continue
    const raw = item as Record<string, unknown>
    const sourceId = cleanString(raw.sourceId)
    const targetId = cleanString(raw.targetId)
    const kind = RELATION_KINDS.has(raw.kind as LearningBoardRelationKind) ? raw.kind as LearningBoardRelationKind : null
    const label = cleanString(raw.label)
    const evidence = cleanString(raw.evidence)
    const pairKey = [sourceId, targetId].sort().join(":::")
    if (
      !kind || !allowedIds.has(sourceId) || !allowedIds.has(targetId) || sourceId === targetId
      || !label || Array.from(label).length > 10 || VAGUE_RELATION_LABELS.has(label) || !evidence || seenPairs.has(pairKey)
    ) continue
    seenPairs.add(pairKey)
    relations.push({ sourceId, targetId, kind, label, evidence })
  }
  if (relations.length < nodeIds.length - 1) return []
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
  if (connected.size !== nodeIds.length) return []
  if (boardKind === "process" || boardKind === "prerequisite") {
    const requiredKind = boardKind
    for (let index = 0; index < orderedNodeIds.length - 1; index++) {
      if (!relations.some((relation) => relation.sourceId === orderedNodeIds[index] && relation.targetId === orderedNodeIds[index + 1] && relation.kind === requiredKind)) return []
    }
  }
  return relations
}

export function sanitizeReviewedBoards(value: unknown, allowedIds: ReadonlySet<string>): LearningBoard[] {
  if (!Array.isArray(value)) return []
  const boards: LearningBoard[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const raw = item as Record<string, unknown>
    if (raw.approved !== true) continue
    const proposals = sanitizeBoardProposals([raw], allowedIds)
    const proposal = proposals[0]
    if (!proposal || proposal.confidence < MIN_APPROVED_CONFIDENCE) continue
    const evidence = Array.isArray(raw.evidence)
      ? raw.evidence.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return []
        const record = entry as Record<string, unknown>
        const nodeId = cleanString(record.nodeId)
        const detail = cleanString(record.detail)
        return allowedIds.has(nodeId) && detail ? [{ nodeId, detail }] : []
      })
      : []
    const mnemonicParts = Array.isArray(raw.mnemonicParts)
      ? raw.mnemonicParts.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return []
        const record = entry as Record<string, unknown>
        const nodeId = cleanString(record.nodeId)
        const phrase = cleanString(record.phrase)
        return allowedIds.has(nodeId) && phrase ? [{ nodeId, phrase }] : []
      })
      : []
    const evidenceIds = new Set(evidence.map((entry) => entry.nodeId))
    const mnemonicIds = new Set(mnemonicParts.map((entry) => entry.nodeId))
    const mnemonic = cleanString(raw.mnemonic)
    const relations = sanitizeBoardRelations(raw.relations, proposal.nodeIds, proposal.kind, proposal.orderedNodeIds)
    if (
      !mnemonic || !proposal.nodeIds.every((id) => evidenceIds.has(id))
      || !proposal.nodeIds.every((id) => mnemonicIds.has(id)) || relations.length === 0
    ) continue
    const id = stableBoardId(proposal)
    if (seen.has(id)) continue
    seen.add(id)
    boards.push({
      id,
      ...proposal,
      evidence: evidence.filter((entry) => proposal.nodeIds.includes(entry.nodeId)),
      mnemonic,
      mnemonicParts: mnemonicParts.filter((entry) => proposal.nodeIds.includes(entry.nodeId)),
      relations,
    })
  }
  return boards
}

function proposalCatalog(candidates: readonly LearningRouteCandidate[]): string {
  const titleById = new Map(candidates.map((candidate) => [candidate.id, candidate.title]))
  return candidates.map((candidate) => JSON.stringify({
    id: candidate.id,
    title: candidate.title,
    type: candidate.semanticType,
    summary: candidate.summary.slice(0, 420),
    outline: candidate.outline.map((item) => item.title).slice(0, 10),
    related: candidate.neighborIds.map((id) => titleById.get(id)).filter(Boolean).slice(0, 10),
  })).join("\n")
}

function scopeSignature(candidates: readonly LearningRouteCandidate[]): string {
  return candidates.map((candidate) => candidate.id).sort().join("\n")
}

export function buildLearningRouteProposalScopes(
  candidates: readonly LearningRouteCandidate[],
): LearningRouteCandidate[][] {
  if (candidates.length <= MAX_CANDIDATES_PER_PROPOSAL) return [[...candidates]]
  const sorted = [...candidates].sort((a, b) => a.title.localeCompare(b.title, "zh-CN") || a.id.localeCompare(b.id))
  const scopes: LearningRouteCandidate[][] = []
  const signatures = new Set<string>()
  const addScope = (scope: LearningRouteCandidate[]) => {
    const unique = [...new Map(scope.map((candidate) => [candidate.id, candidate])).values()]
    if (unique.length < 2) return
    const signature = scopeSignature(unique)
    if (signatures.has(signature)) return
    signatures.add(signature)
    scopes.push(unique)
  }

  const step = MAX_CANDIDATES_PER_PROPOSAL - PROPOSAL_SCOPE_OVERLAP
  for (let start = 0; start < sorted.length; start += step) {
    const scope = sorted.slice(start, start + MAX_CANDIDATES_PER_PROPOSAL)
    if (scope.length < 2) break
    addScope(scope)
    if (start + MAX_CANDIDATES_PER_PROPOSAL >= sorted.length) break
  }

  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const coveredPairs = new Set<string>()
  for (const scope of scopes) {
    const ids = new Set(scope.map((candidate) => candidate.id))
    for (const candidate of scope) {
      for (const neighborId of candidate.neighborIds) {
        if (ids.has(neighborId)) coveredPairs.add([candidate.id, neighborId].sort().join(":::"))
      }
    }
  }
  const uncoveredEdges = candidates.flatMap((candidate) => candidate.neighborIds.flatMap((neighborId) => {
    if (!byId.has(neighborId)) return []
    const pair = [candidate.id, neighborId].sort()
    const key = pair.join(":::")
    return coveredPairs.has(key) || pair[0] !== candidate.id ? [] : [{ key, ids: pair }]
  }))
  while (uncoveredEdges.length > 0) {
    const scopeIds = new Set(uncoveredEdges.shift()!.ids)
    for (let index = 0; index < uncoveredEdges.length && scopeIds.size < MAX_CANDIDATES_PER_PROPOSAL;) {
      const edge = uncoveredEdges[index]
      if (!edge.ids.some((id) => scopeIds.has(id))) {
        index++
        continue
      }
      edge.ids.forEach((id) => scopeIds.add(id))
      uncoveredEdges.splice(index, 1)
    }
    addScope([...scopeIds].map((id) => byId.get(id)!).filter(Boolean))
  }
  return scopes
}

function proposalSystemPrompt(): string {
  return `你是学习知识板块设计师。只能依据输入的知识资料判断，准确优先于覆盖率：宁可让知识点不归类，也不得为了完整而强行归类。

只允许三种经过审核后可展示的板块：
1. category：同一中心问题、同一分类标准、相近层级下的并列类型。并列不代表流程，不得编造先后。
2. process：共同目标下的真实阶段或动作；前一步输出成为后一步条件，顺序交换后过程不成立。
3. prerequisite：理解后项确实依赖前项；仅仅相关、同章或相邻不足以建立箭头。

以下情况不得建立板块主线：只在同一本教材；只有相同标签或词语；正文互相提到；人物与概念仅有研究关系；同属宽泛学科；知识层级混杂；无法从详情说明共同中心问题或每条顺序依据。

一个知识点可以进入多个目的明确的板块。每个板块2至8项。category的orderedNodeIds必须与nodeIds同序；process和prerequisite必须给出包含全部成员且不重复的真实顺序。不要生成顺口溜，本轮只提出候选。

  必须逐项处理输入中的每个知识点。decisions必须覆盖输入的全部id且不重复：进入至少一个候选板块写proposed；没有充分依据写unlinked并给出具体原因。少一个id都视为本轮失败。

  只返回JSON：{"boards":[{"title":"板块名","centralQuestion":"共同回答的一个具体问题","kind":"category|process|prerequisite","nodeIds":["真实id"],"orderedNodeIds":["真实id"],"reason":"为什么同板块以及顺序为何成立；category说明并列标准","confidence":0.0}],"decisions":[{"nodeId":"真实id","status":"proposed|unlinked","reason":"该知识点为何进入候选或为何没有可靠串联"}]}`
}

function auditSystemPrompt(): string {
  return `你是独立的知识板块审核员。必须依据知识详情逐项复核候选，不能因为候选已经存在就放宽标准。准确优先：有疑问就拒绝或移除节点。

审核规则：
- category必须是同一分类维度的并列项，不能用箭头暗示因果或时间。
- process每条相邻关系都必须有阶段传递依据，顺序交换应不成立。
- prerequisite必须说明不理解前项为何会妨碍后项；目录顺序、同章和普通引用都不是依据。
- 人物、案例、方法、现象、宽泛章节不得仅因有关而混成同类。
  - 板块保持2至8项；可以删项或拒绝，但不得添加候选之外的节点。
- evidence必须为每个成员提供来自详情的简短转述，不能编造。
- relations必须给出一张最小而完整的知识关系图：所有成员必须连通，每条关系都要有sourceId、targetId、kind、2至10字的明确label和来自详情的evidence。只保留理解所需关系，通常为成员数减一条，最多为成员数的两倍，不得生成任意两两连线。
- relation kind只有四种：connection表示性质、表示、对应等不应冒充先后的联系；prerequisite表示理解前置；process表示真实过程或变化顺序；application表示方法用于对象。label必须写清“图像表示、根与交点对应、具有特征、用于确定”等具体含义，禁止只写“相关、关系、联系”。
- process板块的每对相邻orderedNodeIds必须有同方向process关系；prerequisite板块的每对相邻orderedNodeIds必须有同方向prerequisite关系。顺口溜只能概括审核后的关系，不能反过来作为关系证据。
- 只有板块审核通过后才生成顺口溜。mnemonicParts必须逐项覆盖成员，让每个短语能对应一个知识点；顺口溜不得改变知识含义。

  输入中的每个proposalId都必须在reviews中恰好出现一次，不能遗漏。通过时approved=true并返回完整板块；拒绝时approved=false并返回具体rejectionReason。

  只返回JSON：{"reviews":[{"proposalId":"输入中的id","approved":true,"title":"板块名","centralQuestion":"共同问题","kind":"category|process|prerequisite","nodeIds":["id"],"orderedNodeIds":["id"],"reason":"复核后的理由","confidence":0.0,"evidence":[{"nodeId":"id","detail":"来自详情的依据"}],"relations":[{"sourceId":"id","targetId":"id","kind":"connection|prerequisite|process|application","label":"明确关系","evidence":"支持这条连线的详情依据"}],"mnemonic":"完整顺口溜","mnemonicParts":[{"nodeId":"id","phrase":"对应短语"}]},{"proposalId":"输入中的id","approved":false,"rejectionReason":"拒绝的具体依据"}]}`
}

function detailText(candidate: LearningRouteCandidate): string {
  const body = candidate.content.replace(/^---[\s\S]*?---\s*/m, "").trim()
  return JSON.stringify({
    id: candidate.id,
    title: candidate.title,
    type: candidate.semanticType,
    summary: candidate.summary,
    source: candidate.sourcePath,
    outline: candidate.outline.map((item) => ({ title: item.title, summary: item.summary })).slice(0, 12),
    detail: body.slice(0, MAX_DETAIL_CHARS),
  })
}

function chunkProposalsForAudit(
  proposals: readonly BoardProposal[],
  candidatesById: ReadonlyMap<string, LearningRouteCandidate>,
): BoardProposal[][] {
  const maxProposalsPerChunk = 3
  const chunks: BoardProposal[][] = []
  let current: BoardProposal[] = []
  let currentSize = 0
  for (const proposal of proposals) {
    const size = proposal.nodeIds.reduce((total, id) => total + detailText(candidatesById.get(id)!).length, 0) + JSON.stringify(proposal).length
    if (current.length > 0 && (current.length >= maxProposalsPerChunk || currentSize + size > MAX_AUDIT_INPUT_CHARS)) {
      chunks.push(current)
      current = []
      currentSize = 0
    }
    current.push(proposal)
    currentSize += size
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export async function generateReviewedLearningBoards(input: {
  candidates: LearningRouteCandidate[]
  config: LlmConfig
  signal?: AbortSignal
}): Promise<LearningRouteGenerationResult> {
  if (input.candidates.length < 2) {
    return {
      boards: [],
      decisions: input.candidates.map((candidate) => ({
        nodeId: candidate.id,
        status: "unlinked",
        boardIds: [],
        reason: "当前知识区域只有一个候选知识点，无法形成至少包含两项的可靠串联。",
      })),
    }
  }
  const proposed: BoardProposal[] = []
  const proposalDecisions = new Map<string, ProposalNodeDecision[]>()
  for (const scope of buildLearningRouteProposalScopes(input.candidates)) {
    const scopeIds = new Set(scope.map((candidate) => candidate.id))
    let complete: { proposals: BoardProposal[]; decisions: ProposalNodeDecision[] } | null = null
    for (let attempt = 0; attempt < 2 && !complete; attempt++) {
      const proposalValue = await callJsonRouteModel(input.config, [
        { role: "system", content: proposalSystemPrompt() },
        { role: "user", content: `这是从较大知识区域中拆出的一批候选。请检查批次内所有知识点，找出所有证据明确的板块，不要只挑最显眼的一个；没有依据的仍应留空，不得凑数。decisions必须逐项覆盖下面全部id。${attempt > 0 ? "上一次返回遗漏或自相矛盾，本次必须完整修正。" : ""}\n\n候选知识目录如下，每行一个知识点：\n${proposalCatalog(scope)}` },
      ], input.signal, 7_000)
      const proposals = sanitizeBoardProposals(proposalValue.boards, scopeIds)
      const decisions = sanitizeProposalNodeDecisions(proposalValue.decisions, scopeIds, proposals)
      if (decisions) complete = { proposals, decisions }
    }
    if (!complete) throw new Error(`候选批次未逐项处理全部 ${scope.length} 个知识点。`)
    proposed.push(...complete.proposals)
    for (const decision of complete.decisions) {
      const existing = proposalDecisions.get(decision.nodeId) ?? []
      existing.push(decision)
      proposalDecisions.set(decision.nodeId, existing)
    }
  }
  const uniqueProposals = new Map<string, BoardProposal>()
  for (const proposal of proposed) {
    const key = `${proposal.kind}:${[...proposal.nodeIds].sort().join("|")}`
    const existing = uniqueProposals.get(key)
    if (!existing || proposal.confidence > existing.confidence) uniqueProposals.set(key, proposal)
  }
  const proposals = [...uniqueProposals.values()]
  if (proposals.length === 0) {
    return {
      boards: [],
      decisions: input.candidates.map((candidate) => ({
        nodeId: candidate.id,
        status: "unlinked",
        boardIds: [],
        reason: proposalDecisions.get(candidate.id)?.map((decision) => decision.reason).join("；") || "AI 未找到证据充分的串联。",
      })),
    }
  }

  const candidatesById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]))
  const reviewed: LearningBoard[] = []
  const auditReasons = new Map<string, string[]>()
  const auditChunk = async (chunk: readonly BoardProposal[]): Promise<boolean> => {
    const detailIds = [...new Set(chunk.flatMap((proposal) => proposal.nodeIds))]
    const details = detailIds.map((id) => detailText(candidatesById.get(id)!)).join("\n")
    const auditable = chunk.map((proposal) => ({ proposalId: stableBoardId(proposal), ...proposal }))
    let complete = false
    for (let attempt = 0; attempt < 2 && !complete; attempt++) {
      const auditValue = await callJsonRouteModel(input.config, [
        { role: "system", content: auditSystemPrompt() },
        { role: "user", content: `候选板块：\n${JSON.stringify(auditable)}\n\n对应知识详情，每行一个：\n${details}\n\nreviews必须逐项覆盖全部proposalId。${attempt > 0 ? "上一次返回有遗漏或格式不完整，本次必须完整修正。" : ""}` },
      ], input.signal, 8_000)
      if (!Array.isArray(auditValue.reviews)) continue
      const byProposalId = new Map(auditable.map((proposal) => [proposal.proposalId, proposal]))
      const seen = new Set<string>()
      const approved: Array<{ board: LearningBoard; proposal: BoardProposal }> = []
      const rejected: Array<{ proposal: BoardProposal; reason: string }> = []
      let valid = true
      for (const review of auditValue.reviews) {
        if (!review || typeof review !== "object") { valid = false; break }
        const record = review as Record<string, unknown>
        const proposalId = cleanString(record.proposalId)
        const proposal = byProposalId.get(proposalId)
        if (!proposal || seen.has(proposalId)) { valid = false; break }
        seen.add(proposalId)
        if (record.approved === true) {
          const board = sanitizeReviewedBoards([record], new Set(detailIds))[0]
          const proposalIds = new Set(proposal.nodeIds)
          if (!board || board.kind !== proposal.kind || !board.nodeIds.every((id) => proposalIds.has(id))) { valid = false; break }
          approved.push({ board, proposal })
        } else if (record.approved === false && cleanString(record.rejectionReason)) {
          rejected.push({ proposal, reason: cleanString(record.rejectionReason) })
        } else {
          valid = false
          break
        }
      }
      if (!valid || seen.size !== auditable.length) continue
      reviewed.push(...approved.map((item) => item.board))
      for (const rejection of rejected) {
        for (const nodeId of rejection.proposal.nodeIds) {
          const reasons = auditReasons.get(nodeId) ?? []
          reasons.push(rejection.reason)
          auditReasons.set(nodeId, reasons)
        }
      }
      for (const item of approved) {
        const approvedNodeIds = new Set(item.board.nodeIds)
        for (const nodeId of item.proposal.nodeIds) {
          if (approvedNodeIds.has(nodeId)) continue
          const reasons = auditReasons.get(nodeId) ?? []
          reasons.push("独立审核认为该知识点不应保留在此板块。")
          auditReasons.set(nodeId, reasons)
        }
      }
      complete = true
    }
    return complete
  }
  for (const chunk of chunkProposalsForAudit(proposals, candidatesById)) {
    if (await auditChunk(chunk)) continue
    if (chunk.length === 1) throw new Error("独立审核未处理当前候选板块。")
    for (const proposal of chunk) {
      if (!await auditChunk([proposal])) throw new Error("独立审核逐项补审时仍未处理当前候选板块。")
    }
  }
  const unique = new Map<string, LearningBoard>()
  for (const board of reviewed) {
    const existing = unique.get(board.id)
    if (!existing || board.confidence > existing.confidence) unique.set(board.id, board)
  }
  const boards = [...unique.values()]
  const decisions = input.candidates.map((candidate): LearningRouteNodeDecision => {
    const boardIds = boards.filter((board) => board.nodeIds.includes(candidate.id)).map((board) => board.id)
    if (boardIds.length > 0) {
      return {
        nodeId: candidate.id,
        status: "linked",
        boardIds,
        reason: `已通过独立审核并进入 ${boardIds.length} 个可靠板块。`,
      }
    }
    const reasons = [
      ...(auditReasons.get(candidate.id) ?? []),
      ...(proposalDecisions.get(candidate.id)?.map((decision) => decision.reason).filter(Boolean) ?? []),
    ]
    return {
      nodeId: candidate.id,
      status: "unlinked",
      boardIds: [],
      reason: reasons.join("；") || "候选板块未通过独立审核，没有形成可靠串联。",
    }
  })
  return { boards, decisions }
}
