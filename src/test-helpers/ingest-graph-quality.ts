import { parseFrontmatter } from "@/lib/frontmatter"

export interface RelatedPairContract {
  left: string
  right: string
}

export interface IngestGraphQualityContract {
  /** Alternative spellings that should resolve to the same concept name. */
  aliases?: Record<string, string[]>
  /** Relations that indicate same-batch or same-chapter contamination. */
  forbiddenRelatedPairs: RelatedPairContract[]
  /** Legitimate relations used to ensure de-noising did not erase the graph. */
  expectedRelatedPairs: RelatedPairContract[]
  /** Minimum expected pairs that must survive. Defaults to every expected pair. */
  minExpectedRelatedPairs?: number
}

export interface WikiPageForGraphQuality {
  path: string
  content: string
}

export interface IngestGraphQualityReport {
  forbiddenHits: RelatedPairContract[]
  expectedHits: RelatedPairContract[]
  missingExpectedPairs: RelatedPairContract[]
  observedEdges: RelatedPairContract[]
  passes: boolean
}

/**
 * Captured from the 2025 人教版九年级物理 PDF regression. The forbidden
 * pairs were generated despite lacking a direct factual relationship; the
 * expected pairs are positive controls from the same import.
 */
export const PHYSICS_RELATION_BOUNDARY: IngestGraphQualityContract = {
  aliases: {
    微波中继通信: ["微波通信"],
    卫星通信: ["地球同步卫星通信"],
  },
  forbiddenRelatedPairs: [
    { left: "热导率", right: "微波中继通信" },
    { left: "安全用电", right: "核能" },
    { left: "电功率", right: "电流的磁效应" },
    { left: "磁化", right: "换向器" },
    { left: "家庭电路", right: "磁场" },
    { left: "FAST", right: "沈括" },
  ],
  expectedRelatedPairs: [
    { left: "欧姆定律", right: "焦耳定律" },
    { left: "比热容", right: "内能" },
    { left: "电磁感应", right: "发电机" },
    { left: "电磁波", right: "卫星通信" },
  ],
  minExpectedRelatedPairs: 2,
}

/**
 * Evaluate only explicit `related:` frontmatter edges. Body wikilinks are
 * citations/navigation and are intentionally outside this contract: the
 * regression being preserved is the model promoting mere co-occurrence into
 * a knowledge-graph relation.
 */
export function evaluateIngestGraphQuality(
  pages: WikiPageForGraphQuality[],
  contract: IngestGraphQualityContract,
): IngestGraphQualityReport {
  const aliasToCanonical = buildAliasMap(contract)
  const observedKeys = new Set<string>()
  const observedEdges: RelatedPairContract[] = []

  for (const page of pages) {
    const { frontmatter } = parseFrontmatter(page.content)
    if (!frontmatter) continue

    const source = resolveCanonical(
      typeof frontmatter.title === "string"
        ? frontmatter.title
        : slugFromPath(page.path),
      aliasToCanonical,
    )
    const related = toStringArray(frontmatter.related)

    for (const targetRaw of related) {
      const target = resolveCanonical(targetRaw, aliasToCanonical)
      if (!source || !target || source === target) continue
      const key = pairKey(source, target)
      if (observedKeys.has(key)) continue
      observedKeys.add(key)
      observedEdges.push({ left: source, right: target })
    }
  }

  const forbiddenHits = contract.forbiddenRelatedPairs.filter((pair) =>
    observedKeys.has(contractPairKey(pair, aliasToCanonical)),
  )
  const expectedHits = contract.expectedRelatedPairs.filter((pair) =>
    observedKeys.has(contractPairKey(pair, aliasToCanonical)),
  )
  const missingExpectedPairs = contract.expectedRelatedPairs.filter((pair) =>
    !observedKeys.has(contractPairKey(pair, aliasToCanonical)),
  )
  const minimumExpected =
    contract.minExpectedRelatedPairs ?? contract.expectedRelatedPairs.length

  return {
    forbiddenHits,
    expectedHits,
    missingExpectedPairs,
    observedEdges,
    passes: forbiddenHits.length === 0 && expectedHits.length >= minimumExpected,
  }
}

function buildAliasMap(
  contract: IngestGraphQualityContract,
): Map<string, string> {
  const map = new Map<string, string>()
  const concepts = new Set<string>()
  for (const pair of [
    ...contract.forbiddenRelatedPairs,
    ...contract.expectedRelatedPairs,
  ]) {
    concepts.add(pair.left)
    concepts.add(pair.right)
  }

  for (const concept of concepts) {
    map.set(normalizeRef(concept), concept)
    for (const alias of contract.aliases?.[concept] ?? []) {
      map.set(normalizeRef(alias), concept)
    }
  }
  return map
}

function resolveCanonical(
  raw: string,
  aliasToCanonical: Map<string, string>,
): string {
  const normalized = normalizeRef(raw)
  return aliasToCanonical.get(normalized) ?? normalized
}

function contractPairKey(
  pair: RelatedPairContract,
  aliasToCanonical: Map<string, string>,
): string {
  return pairKey(
    resolveCanonical(pair.left, aliasToCanonical),
    resolveCanonical(pair.right, aliasToCanonical),
  )
}

function pairKey(left: string, right: string): string {
  return [left, right].sort((a, b) => a.localeCompare(b)).join("\u0000")
}

function normalizeRef(raw: string): string {
  let value = raw.trim()
  const wikilink = value.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/)
  if (wikilink) value = wikilink[1]
  value = value.replace(/\\/g, "/")
  value = value.split("/").pop() ?? value
  value = value.replace(/\.md$/i, "")
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "")
}

function slugFromPath(pagePath: string): string {
  return pagePath.replace(/\\/g, "/").split("/").pop()?.replace(/\.md$/i, "") ?? pagePath
}

function toStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value
  if (typeof value !== "string" || value.trim() === "") return []
  return [value]
}
