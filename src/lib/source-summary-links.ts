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
  if (links.length === 0) return sourceSummary
  const unique = new Map<string, SourceKnowledgeLink>()
  for (const link of links) {
    const target = link.target.trim()
    if (!target || unique.has(target.toLowerCase())) continue
    unique.set(target.toLowerCase(), { target, title: link.title.trim() || target })
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
  const markerPattern = new RegExp(
    `${escapeRegExp(SOURCE_KNOWLEDGE_LINKS_START)}[\\s\\S]*?${escapeRegExp(SOURCE_KNOWLEDGE_LINKS_END)}`,
  )
  return markerPattern.test(sourceSummary)
    ? sourceSummary.replace(markerPattern, block)
    : `${sourceSummary.trimEnd()}\n\n${block}\n`
}
