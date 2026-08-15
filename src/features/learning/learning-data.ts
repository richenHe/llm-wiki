export type LearningMastery = "unseen" | "started" | "understood" | "practiced" | "mastered"
export type LearningTargetKind = "remember" | "understand" | "apply" | "judge" | "create" | "reference"
export type LearningContentRole = "teachable" | "reference" | "evidence" | "overview"

export interface LearningNode {
  id: string
  title: string
  glyph: string
  essence: string
  parentId: string | null
  prerequisiteIds: string[]
  source: string
  sourceDetail: string
  capabilities: string[]
  mastery: LearningMastery
  position: { x: number; y: number }
  kind?: "region" | "group" | "concept"
  sourcePath?: string
  linkCount?: number
  semanticType?: string
  routeMnemonic?: string
  targetKind?: LearningTargetKind
  contentRole?: LearningContentRole
}

export type LearningRelationKind = "prerequisite" | "related"

export interface LearningRelation {
  sourceId: string
  targetId: string
  kind: LearningRelationKind
  weight: number
  reason: string
}

export interface LearningRegion {
  id: string
  title: string
  color: "violet" | "blue" | "cyan"
  position: { x: number; y: number; width: number; height: number }
  nodeIds: string[]
}

export const LEARNING_NODES: LearningNode[] = [
  { id: "mechanics", title: "力学", glyph: "力", essence: "研究物体运动以及改变运动的原因。", parentId: null, prerequisiteIds: [], source: "普通高中教科书 物理 必修第一册", sourceDetail: "第一章至第四章", capabilities: ["建模", "受力分析", "实验设计"], mastery: "started", position: { x: 50, y: 14 } },
  { id: "motion", title: "运动", glyph: "运", essence: "用位置随时间的变化描述物体。", parentId: "mechanics", prerequisiteIds: [], source: "普通高中教科书 物理 必修第一册", sourceDetail: "第一章 运动的描述", capabilities: ["图像分析", "物理建模"], mastery: "started", position: { x: 29, y: 39 } },
  { id: "displacement", title: "位移", glyph: "位", essence: "从初位置指向末位置的有向线段。", parentId: "motion", prerequisiteIds: [], source: "普通高中教科书 物理 必修第一册", sourceDetail: "第一章 第2节", capabilities: ["方向判断", "矢量表达"], mastery: "understood", position: { x: 22, y: 51 } },
  { id: "velocity", title: "速度", glyph: "速", essence: "位置改变得有多快，并包含方向。", parentId: "motion", prerequisiteIds: ["displacement"], source: "普通高中教科书 物理 必修第一册", sourceDetail: "第一章 第3节", capabilities: ["图像分析", "公式推导"], mastery: "understood", position: { x: 37, y: 50 } },
  { id: "acceleration", title: "加速度", glyph: "加", essence: "速度变化得有多快。", parentId: "motion", prerequisiteIds: ["velocity"], source: "普通高中教科书 物理 必修第一册", sourceDetail: "第一章 运动的描述 第3节", capabilities: ["图像分析", "公式推导", "实验设计"], mastery: "understood", position: { x: 25, y: 68 } },
  { id: "motion-graph", title: "运动图像", glyph: "图", essence: "把运动规律转成随时间变化的图像。", parentId: "motion", prerequisiteIds: ["velocity", "acceleration"], source: "普通高中教科书 物理 必修第一册", sourceDetail: "第一章 第4节", capabilities: ["图像分析", "信息转换"], mastery: "started", position: { x: 41, y: 68 } },
  { id: "force", title: "相互作用与力", glyph: "力", essence: "力描述物体之间的相互作用。", parentId: "mechanics", prerequisiteIds: [], source: "普通高中教科书 物理 必修第一册", sourceDetail: "第三章 相互作用——力", capabilities: ["受力分析", "实验设计"], mastery: "started", position: { x: 67, y: 38 } },
  { id: "energy", title: "能量", glyph: "能", essence: "用状态变化追踪做功与转化。", parentId: "mechanics", prerequisiteIds: ["force"], source: "普通高中教科书 物理 必修第二册", sourceDetail: "第八章 机械能守恒定律", capabilities: ["守恒分析", "公式推导"], mastery: "unseen", position: { x: 60, y: 63 } },
  { id: "momentum", title: "动量", glyph: "动", essence: "用质量与速度描述运动状态。", parentId: "mechanics", prerequisiteIds: ["velocity", "force"], source: "普通高中教科书 物理 选择性必修第一册", sourceDetail: "第一章 动量守恒定律", capabilities: ["守恒分析", "碰撞建模"], mastery: "unseen", position: { x: 38, y: 86 } },
  { id: "thermal", title: "热学", glyph: "热", essence: "研究宏观热现象与微观粒子运动。", parentId: null, prerequisiteIds: [], source: "普通高中教科书 物理 选择性必修第三册", sourceDetail: "第一章至第三章", capabilities: ["微观解释", "状态分析"], mastery: "unseen", position: { x: 50, y: 48 } },
  { id: "electromagnetism", title: "电磁", glyph: "电", essence: "研究电荷、电场、电路与磁场。", parentId: null, prerequisiteIds: [], source: "普通高中教科书 物理 必修第三册", sourceDetail: "第九章至第十三章", capabilities: ["场模型", "电路分析"], mastery: "unseen", position: { x: 50, y: 50 } },
  { id: "optics", title: "光学", glyph: "光", essence: "研究光的传播、成像与波动性质。", parentId: null, prerequisiteIds: [], source: "普通高中教科书 物理 选择性必修第一册", sourceDetail: "第四章 光", capabilities: ["光路分析", "实验设计"], mastery: "unseen", position: { x: 50, y: 50 } },
  { id: "atomic", title: "原子物理", glyph: "原", essence: "研究原子结构和微观世界的基本规律。", parentId: null, prerequisiteIds: [], source: "普通高中教科书 物理 选择性必修第三册", sourceDetail: "第四章至第五章", capabilities: ["模型解释", "证据推理"], mastery: "unseen", position: { x: 50, y: 50 } },
]

export const LEARNING_REGIONS: LearningRegion[] = [
  { id: "mechanics", title: "力学", color: "violet", position: { x: 5, y: 8, width: 50, height: 61 }, nodeIds: ["mechanics", "motion", "displacement", "velocity", "acceleration", "motion-graph", "force", "energy", "momentum"] },
  { id: "thermal", title: "热学", color: "blue", position: { x: 57, y: 7, width: 21, height: 28 }, nodeIds: ["thermal"] },
  { id: "electromagnetism", title: "电磁", color: "blue", position: { x: 62, y: 43, width: 23, height: 31 }, nodeIds: ["electromagnetism"] },
  { id: "optics", title: "光", color: "blue", position: { x: 31, y: 73, width: 19, height: 22 }, nodeIds: ["optics"] },
  { id: "atomic", title: "原子", color: "cyan", position: { x: 58, y: 76, width: 19, height: 20 }, nodeIds: ["atomic"] },
]

export const DEFAULT_LEARNING_NODE_ID = "acceleration"

export function getLearningChildren(nodeId: string | null, nodes: readonly LearningNode[]): LearningNode[] {
  return nodes.filter((node) => node.parentId === nodeId)
}

export function getLearningSiblings(nodeId: string, nodes: readonly LearningNode[]): LearningNode[] {
  const node = nodes.find((item) => item.id === nodeId)
  if (!node) return []
  return getLearningChildren(node.parentId, nodes)
}

export function buildLearningRoute(nodeId: string, nodes: readonly LearningNode[]): LearningNode[] {
  const siblings = getLearningSiblings(nodeId, nodes)
  if (siblings.length < 2) return siblings
  const siblingIds = new Set(siblings.map((node) => node.id))
  const indegree = new Map(siblings.map((node) => [node.id, 0]))
  const outgoing = new Map(siblings.map((node) => [node.id, [] as string[]]))
  for (const node of siblings) {
    for (const prerequisiteId of node.prerequisiteIds) {
      if (!siblingIds.has(prerequisiteId)) continue
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1)
      outgoing.get(prerequisiteId)?.push(node.id)
    }
  }
  const originalOrder = new Map(siblings.map((node, index) => [node.id, index]))
  const ready = siblings.filter((node) => indegree.get(node.id) === 0)
  const result: LearningNode[] = []
  while (ready.length > 0) {
    ready.sort((a, b) => (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0))
    const current = ready.shift()
    if (!current) break
    result.push(current)
    for (const targetId of outgoing.get(current.id) ?? []) {
      const next = (indegree.get(targetId) ?? 1) - 1
      indegree.set(targetId, next)
      if (next === 0) {
        const target = siblings.find((node) => node.id === targetId)
        if (target) ready.push(target)
      }
    }
  }
  return result.length === siblings.length ? result : siblings
}

export function buildRouteMnemonic(route: readonly LearningNode[]): string {
  const configured = route.find((node) => node.routeMnemonic)?.routeMnemonic
  if (configured) return configured
  if (route.length === 0) return ""
  if (route.length === 1) return `先抓住“${route[0].glyph}”，再进入细节。`
  const compact = route.map((node) => node.glyph).join("、")
  return `顺着“${compact}”逐步掌握；先理解前一项，再连接后一项。`
}

export function findLearningNode(id: string, nodes: readonly LearningNode[] = LEARNING_NODES): LearningNode {
  return nodes.find((node) => node.id === id) ?? nodes[0] ?? LEARNING_NODES[0]
}

export function getLearningBreadcrumb(nodeId: string, nodes: readonly LearningNode[] = LEARNING_NODES): LearningNode[] {
  const result: LearningNode[] = []
  let current: LearningNode | undefined = findLearningNode(nodeId, nodes)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    result.unshift(current)
    current = current.parentId ? nodes.find((node) => node.id === current?.parentId) : undefined
  }
  return result
}
