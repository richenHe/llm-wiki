const REPOSITORY_CAPSULE_MARKERS = [
  "report_contract: repository-framework-v1",
  "report_contract: repository-framework-v2",
] as const

export function isRepositoryFrameworkCapsule(sourceContent: string): boolean {
  return REPOSITORY_CAPSULE_MARKERS.some((marker) => sourceContent.includes(marker))
}

/**
 * Repository capsules are already evidence-oriented analyses of a pinned
 * snapshot. Preserve their evidence status instead of flattening every
 * statement into an unqualified wiki fact.
 */
export function repositoryCapsuleDirective(sourceContent: string): string {
  if (!isRepositoryFrameworkCapsule(sourceContent)) return ""

  return [
    "## Repository framework capsule fidelity policy",
    "This source is a framework-level analysis of a commit-pinned repository snapshot.",
    "- Treat repository, source_url, commit, branch_or_tag, retrieved_at, license, evidence_mode, tree_inventory, and runtime_verification as protected source metadata. Copy exact values when relevant; never infer replacements.",
    "- Preserve evidence labels exactly. Do not upgrade project-claim, runtime-unverified, inference, unknown, or conflict statements into implemented, tested, or runtime-verified facts.",
    "- Keep important evidence IDs and commit-pinned URLs in the source-summary page so implementation details remain reopenable.",
    "- Do not invent authors, publication dates, release dates, licenses, benchmark results, supported hardware, configuration keys, commands, or runtime behavior.",
    "- Treat omitted code detail as intentionally deferred. Generate framework-level knowledge, not symbol-by-symbol pages.",
    "- If the capsule reports conflicting evidence or an unknown decision-critical fact, preserve the uncertainty and create a REVIEW item when human judgment would materially help.",
  ].join("\n")
}
