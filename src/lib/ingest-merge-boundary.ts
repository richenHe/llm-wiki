import { parseFrontmatter } from "@/lib/frontmatter"
import { sourceReferenceIdentity } from "@/lib/source-identity"
import { parseSources } from "@/lib/sources-merge"

export interface SourceEvidenceIndex {
  compactText: string
}

export interface CrossSourceMergeDecision {
  allow: boolean
  reason: string
  evidenceTerms: string[]
}

/**
 * Normalize the complete extracted source once, then reuse the result for all
 * page collisions in this write pass. This keeps the guard linear in source
 * size instead of rescanning a 100+ page PDF for every generated page.
 */
export function buildSourceEvidenceIndex(sourceContent: string): SourceEvidenceIndex {
  return { compactText: normalizeEvidenceText(sourceContent) }
}

/**
 * Block only strong cross-source conflicts. New pages, same-source re-ingests,
 * legacy pages without ownership metadata, and source-summary pages keep their
 * historical behavior. The guard deliberately makes no model call: it checks
 * whether the existing page's title (or every core term in a comparison title)
 * occurs anywhere in the complete extracted text, including image captions.
 */
export function evaluateCrossSourceMerge(params: {
  existingContent: string
  incomingSourceIdentity: string
  pagePath: string
  evidence: SourceEvidenceIndex
}): CrossSourceMergeDecision {
  const normalizedPath = params.pagePath.replace(/\\/g, "/").toLowerCase()
  if (normalizedPath.startsWith("wiki/sources/") || normalizedPath.includes("/sources/")) {
    return { allow: true, reason: "source-summary", evidenceTerms: [] }
  }

  const sources = parseSources(params.existingContent)
  if (sources.length === 0) {
    return { allow: true, reason: "legacy-page-without-source-owner", evidenceTerms: [] }
  }

  const incomingKey = sourceReferenceIdentity(params.incomingSourceIdentity).toLowerCase()
  if (sources.some((source) => sourceReferenceIdentity(source).toLowerCase() === incomingKey)) {
    return { allow: true, reason: "existing-page-already-cites-source", evidenceTerms: [] }
  }

  // Empty evidence can occur for an extraction failure that is handled by a
  // different ingest check. Do not turn that failure into broad page blocking.
  if (!params.evidence.compactText) {
    return { allow: true, reason: "source-evidence-unavailable", evidenceTerms: [] }
  }

  const titleValue = parseFrontmatter(params.existingContent).frontmatter?.title
  const title = typeof titleValue === "string" ? titleValue.trim() : ""
  if (!title) {
    return { allow: true, reason: "existing-page-title-unavailable", evidenceTerms: [] }
  }

  const normalizedTitle = normalizeEvidenceText(title)
  if (normalizedTitle.length >= 2 && params.evidence.compactText.includes(normalizedTitle)) {
    return { allow: true, reason: "full-title-supported-by-source", evidenceTerms: [title] }
  }

  const evidenceTerms = coreTitleTerms(title)
  if (
    evidenceTerms.length > 0
    && evidenceTerms.every((term) => params.evidence.compactText.includes(normalizeEvidenceText(term)))
  ) {
    return { allow: true, reason: "core-title-terms-supported-by-source", evidenceTerms }
  }

  return {
    allow: false,
    reason: `existing page topic "${title}" has no title-level support in the incoming source`,
    evidenceTerms,
  }
}

function normalizeEvidenceText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

function coreTitleTerms(title: string): string[] {
  const withoutGenericSuffix = title
    .replace(/(?:的)?(?:对比|比较|区别|差异|概述|简介|介绍|指南|原理|方法|应用|案例|分析|定义|性质|图象|图像|判定|计算|求法)$/iu, "")
    .replace(/尺规作图$/u, "")
    .trim()
  const rawTerms = withoutGenericSuffix.split(
    /(?:与|和|及|以及|、|\/|&|\bvs\.?\b|\bversus\b)/iu,
  )
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of rawTerms) {
    const term = raw.replace(/^的|的$/gu, "").trim()
    const normalized = normalizeEvidenceText(term)
    if (normalized.length < 2 || seen.has(normalized)) continue
    seen.add(normalized)
    terms.push(term)
  }
  return terms
}
