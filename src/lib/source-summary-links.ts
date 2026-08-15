export const SOURCE_KNOWLEDGE_LINKS_START = "<!-- llm-wiki:knowledge-links:start -->"
export const SOURCE_KNOWLEDGE_LINKS_END = "<!-- llm-wiki:knowledge-links:end -->"

export interface SourceKnowledgeLink {
  target: string
  title: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Replace only the navigation block owned by the application. */
export function upsertSourceKnowledgeLinks(
  sourceSummary: string,
  links: readonly SourceKnowledgeLink[],
): string {
  const markerPattern = new RegExp(
    `${escapeRegExp(SOURCE_KNOWLEDGE_LINKS_START)}[\\s\\S]*?${escapeRegExp(SOURCE_KNOWLEDGE_LINKS_END)}`,
  )
  const unique = new Map<string, SourceKnowledgeLink>()
  for (const link of links) {
    const target = link.target.trim()
    if (!target || unique.has(target.toLowerCase())) continue
    unique.set(target.toLowerCase(), { target, title: link.title.trim() || target })
  }
  if (unique.size === 0) {
    if (!markerPattern.test(sourceSummary)) return sourceSummary
    return `${sourceSummary.replace(markerPattern, "").trimEnd()}\n`
  }
  const lines = [...unique.values()]
    .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"))
    .map((link) => `- [[${link.target}|${link.title}]]`)
  const block = [
    SOURCE_KNOWLEDGE_LINKS_START,
    "## 本来源已整理的知识页面",
    "",
    ...lines,
    SOURCE_KNOWLEDGE_LINKS_END,
  ].join("\n")
  return markerPattern.test(sourceSummary)
    ? sourceSummary.replace(markerPattern, block)
    : `${sourceSummary.trimEnd()}\n\n${block}\n`
}
