import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { createTempProject, realFs, writeFileRaw } from "@/test-helpers/fs-temp"
import { useActivityStore } from "@/stores/activity-store"
import { useChatStore } from "@/stores/chat-store"
import { useReviewStore } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"
import { sourceSummarySlugFromIdentity } from "./source-identity"
import { migrateSourcePath } from "./source-lifecycle"

vi.mock("@/commands/fs", () => realFs)

let sourceMarkers: string[] = []
let failLongChunksOnce = new Set<number>()
let extraReviewResponse = ""
let generationBodySuffix = ""
let generationSuffix = ""
let truncatedRepairResponse = ""
let missingPageRepairResponse = ""
let analysisOverride = ""
let abortDuringReview: AbortController | null = null
let interactiveGenerationOverride = ""
let mergeRequestCount = 0
let generationBatchRequests: string[][] = []
let generationBatchResponder: ((paths: string[], requestIndex: number) => {
  output?: string
  error?: string
}) | null = null
let longSourceDigestLinks: string[] = []
let longSourceFinalPlan = [
  "## Generation Contract",
  "NO_STANDALONE_PAGES: the test fixture contains repeated placeholder text only.",
].join("\n")

vi.mock("./llm-client", () => ({
  streamChat: vi.fn(async (_cfg, messages, cb) => {
    const systemPrompt = String(messages?.[0]?.content ?? "")
    const userPrompt = String(messages?.[1]?.content ?? "")

    if (systemPrompt.startsWith("You are merging two versions")) {
      mergeRequestCount++
      const incoming = userPrompt.split("## Newly generated version")[1]?.split("---")[2]
      cb.onToken(incoming?.trim() || "---\ntitle: merged\n---\n\n# merged")
      cb.onDone()
      return
    }

    if (systemPrompt.startsWith("You are a wiki generation assistant")) {
      if (interactiveGenerationOverride) {
        cb.onToken(interactiveGenerationOverride)
        cb.onDone()
        return
      }
      cb.onToken([
        "---FILE: wiki/sources/config.md---",
        "---",
        'type: "source"',
        'title: "Source: config.yaml"',
        'sources: ["config.yaml"]',
        "tags: []",
        "related: []",
        "---",
        "",
        "# Source: config.yaml",
        "",
        "Configuration source generated from the chat handoff.",
        "---END FILE---",
      ].join("\n"))
      cb.onDone()
      return
    }

    if (systemPrompt.startsWith("You are analyzing a long source document")) {
      const chunkMatch = userPrompt.match(/Chunk:\s*(\d+)\/(\d+)/)
      const chunkIndex = chunkMatch?.[1] ?? "0"
      const numericChunkIndex = Number(chunkIndex)
      if (failLongChunksOnce.has(numericChunkIndex)) {
        failLongChunksOnce.delete(numericChunkIndex)
        cb.onError(new Error(`chunk ${chunkIndex} failed once`))
        return
      }
      cb.onToken([
        "## Chunk Analysis",
        `Chunk ${chunkIndex} introduced topic ${chunkIndex}.`,
        "",
        "## Updated Global Digest",
        `Digest after chunk ${chunkIndex}: stable context ${chunkIndex}.`,
        ...longSourceDigestLinks,
      ].join("\n"))
      cb.onDone()
      return
    }

    if (systemPrompt.startsWith("You are identifying high-value follow-up research items")) {
      if (abortDuringReview) {
        abortDuringReview.abort()
        throw new Error("AbortError")
      }
      cb.onToken(extraReviewResponse)
      cb.onDone()
      return
    }

    if (systemPrompt.startsWith("You are repairing truncated wiki FILE blocks")) {
      cb.onToken(truncatedRepairResponse)
      cb.onDone()
      return
    }

    if (systemPrompt.startsWith("You are finalizing the knowledge-page plan for a long document")) {
      cb.onToken(longSourceFinalPlan)
      cb.onDone()
      return
    }

    if (systemPrompt.startsWith("You are completing wiki pages")) {
      cb.onToken(missingPageRepairResponse)
      cb.onDone()
      return
    }

    if (generationBatchResponder && systemPrompt.startsWith("Based on the analysis below")) {
      const requestedSection = systemPrompt.split("## Requested paths")[1]?.split("## Source Context")[0] ?? ""
      const paths = Array.from(requestedSection.matchAll(/^-\s+(wiki\/[^\s]+\.md)\s*$/gm))
        .map((match) => match[1])
      const requestIndex = generationBatchRequests.length
      generationBatchRequests.push(paths)
      const response = generationBatchResponder(paths, requestIndex)
      if (response.output) cb.onToken(response.output)
      if (response.error) cb.onError(new Error(response.error))
      else cb.onDone()
      return
    }

    const targetMatch = systemPrompt.match(
      /source summary page at \*\*(wiki\/sources\/[^*]+)\*\*/,
    )
    if (!targetMatch) {
      cb.onToken(analysisOverride || "## Analysis\nConfiguration source.")
      cb.onDone()
      return
    }

    const marker = sourceMarkers.shift() ?? "unknown project"
    const targetPath = targetMatch[1]
    const sourceIdentity =
      systemPrompt.match(/original source file is:\s*\*\*([^*]+)\*\*/i)?.[1] ?? "config.yaml"
    cb.onToken([
      `---FILE: ${targetPath}---`,
      "---",
      `title: "Source: ${sourceIdentity}"`,
      `sources: ["${sourceIdentity}"]`,
      "---",
      "",
      `# ${marker}`,
      "",
      `Configuration details for ${marker}.`,
      generationBodySuffix,
      "---END FILE---",
      generationSuffix,
    ].join("\n"))
    cb.onDone()
  }),
}))

vi.mock("./mineru", () => ({
  parseWithMineru: vi.fn(),
  parseWithMineruResult: vi.fn(),
}))

import {
  autoIngest,
  buildFallbackSourceSummary,
  executeIngestWrites,
  hasMineruImageRefs,
} from "./ingest"
import { streamChat } from "./llm-client"
import { parseWithMineruResult } from "./mineru"

const mockStreamChat = vi.mocked(streamChat)
const mockParseWithMineru = vi.mocked(parseWithMineruResult)

describe("autoIngest source summary paths", () => {
  let tmp: { path: string; cleanup: () => Promise<void> } | undefined

  beforeEach(async () => {
    sourceMarkers = []
    failLongChunksOnce = new Set()
    extraReviewResponse = ""
    generationBodySuffix = ""
    generationSuffix = ""
    truncatedRepairResponse = ""
    missingPageRepairResponse = ""
    analysisOverride = ""
    abortDuringReview = null
    interactiveGenerationOverride = ""
    mergeRequestCount = 0
    generationBatchRequests = []
    generationBatchResponder = null
    longSourceDigestLinks = []
    longSourceFinalPlan = [
      "## Generation Contract",
      "NO_STANDALONE_PAGES: the test fixture contains repeated placeholder text only.",
    ].join("\n")
    mockStreamChat.mockClear()
    mockParseWithMineru.mockReset()
    tmp = await createTempProject("same-basename-sources")

    await writeFileRaw(`${tmp.path}/purpose.md`, "# Purpose\n\nTrack project config files.\n")
    await writeFileRaw(
      `${tmp.path}/schema.md`,
      "# Schema\n\nEach source needs its own source summary page.\n\n## Page Types\n| goal | wiki/goals/ | Outcomes |\n| habit | wiki/habits/ | Behaviours |",
    )
    await writeFileRaw(`${tmp.path}/wiki/index.md`, "# Index\n")
    await writeFileRaw(`${tmp.path}/wiki/overview.md`, "# Overview\n")
    await writeFileRaw(`${tmp.path}/raw/sources/project-a/config.yaml`, "name: alpha\n")
    await writeFileRaw(`${tmp.path}/raw/sources/project-b/config.yaml`, "name: beta\n")

    useReviewStore.setState({ items: [] })
    useActivityStore.setState({ items: [] })
    useChatStore.setState({
      conversations: [],
      messages: [],
      activeConversationId: null,
      mode: "chat",
      ingestSource: null,
      isStreaming: false,
      streamingContent: "",
    })
    useWikiStore.setState({
      project: {
        id: "same-basename-sources",
        name: "same-basename-sources",
        path: tmp.path,
      },
      fileTree: [],
      outputLanguage: "auto",
      multimodalConfig: {
        enabled: false,
        useMainLlm: true,
        provider: "openai",
        apiKey: "",
        model: "",
        ollamaUrl: "",
        customEndpoint: "",
        concurrency: 1,
      },
      embeddingConfig: {
        enabled: false,
        endpoint: "",
        apiKey: "",
        model: "",
      },
      mineruConfig: {
        enabled: false,
        backend: "cloud",
        token: "",
        modelVersion: "vlm",
      },
    })
  })

  afterEach(async () => {
    await tmp?.cleanup()
    tmp = undefined
  })

  it("detects MinerU image refs with URL-encoded source summary slugs", () => {
    expect(hasMineruImageRefs(
      "![chart](media/%E6%B1%A1%E6%B0%B4%20paper/mineru/images/chart%281%29.png)",
      "污水 paper",
    )).toBe(true)
    expect(hasMineruImageRefs(
      "![chart](media/污水 paper/mineru/images/chart.png)",
      "污水 paper",
    )).toBe(true)
    expect(hasMineruImageRefs(
      "![chart](media/other/mineru/images/chart.png)",
      "污水 paper",
    )).toBe(false)
  })

  it("preserves complete analysis in a fallback source summary", () => {
    const analysis = `begin-${"x".repeat(5000)}-end`
    const content = buildFallbackSourceSummary("long.md", analysis, "2026-07-11")
    expect(content).toContain(analysis)
    expect(content).toContain("-end")
  })

  it("keeps distinct source summaries for same-basename files in different source subdirectories", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config", "project-b config"]

    await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )
    await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-b/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-b",
    )

    const sourcesDir = path.join(tmp.path, "wiki", "sources")
    const summaryFiles = (await fs.readdir(sourcesDir))
      .filter((name) => name.endsWith(".md"))
      .sort()
    const summaryContents = await Promise.all(
      summaryFiles.map((name) => fs.readFile(path.join(sourcesDir, name), "utf8")),
    )
    const allSummaries = summaryContents.join("\n\n--- summary boundary ---\n\n")

    expect(summaryFiles).toHaveLength(2)
    expect(allSummaries).toContain("project-a/config.yaml")
    expect(allSummaries).toContain("project-b/config.yaml")
  })

  it("replaces stale content when a corrected source solely owns the page", async () => {
    if (!tmp) throw new Error("missing temp project")
    const sourcePath = `${tmp.path}/raw/sources/project-a/config.yaml`
    sourceMarkers = ["obsolete wording"]
    await autoIngest(tmp.path, sourcePath, useWikiStore.getState().llmConfig)

    await writeFileRaw(sourcePath, "name: corrected\n")
    sourceMarkers = ["corrected wording"]
    await autoIngest(tmp.path, sourcePath, useWikiStore.getState().llmConfig)

    const summaryPath = `${tmp.path}/wiki/sources/${sourceSummarySlugFromIdentity("project-a/config.yaml")}.md`
    const content = await fs.readFile(summaryPath, "utf8")
    expect(content).toContain("corrected wording")
    expect(content).not.toContain("obsolete wording")
    expect(mergeRequestCount).toBe(0)
  })

  it("moves the canonical source summary and its source reference", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["movable summary"]
    const oldSource = `${tmp.path}/raw/sources/project-a/config.yaml`
    await autoIngest(tmp.path, oldSource, useWikiStore.getState().llmConfig)

    const oldIdentity = "project-a/config.yaml"
    const newIdentity = "archive/config.yaml"
    const oldSummary = `${tmp.path}/wiki/sources/${sourceSummarySlugFromIdentity(oldIdentity)}.md`
    const newSummary = `${tmp.path}/wiki/sources/${sourceSummarySlugFromIdentity(newIdentity)}.md`
    await migrateSourcePath(
      tmp.path,
      "raw/sources/project-a/config.yaml",
      "raw/sources/archive/config.yaml",
    )

    await expect(fs.access(oldSummary)).rejects.toThrow()
    const content = await fs.readFile(newSummary, "utf8")
    expect(content).toContain('sources: ["archive/config.yaml"]')
  })

  it("migrates source references for a case-only rename", async () => {
    if (!tmp) throw new Error("missing temp project")
    const pagePath = `${tmp.path}/wiki/entities/case.md`
    await writeFileRaw(pagePath, [
      "---",
      'sources: ["project-a/config.yaml"]',
      "---",
      "# Case",
    ].join("\n"))

    await migrateSourcePath(
      tmp.path,
      "raw/sources/project-a/config.yaml",
      "raw/sources/Project-A/config.yaml",
    )

    expect(await fs.readFile(pagePath, "utf8")).toContain(
      'sources: ["Project-A/config.yaml"]',
    )
  })

  it("migrates a unique legacy basename source reference", async () => {
    if (!tmp) throw new Error("missing temp project")
    // Remove the second same-basename source so the legacy shorthand is
    // unambiguous after the move.
    await fs.rm(`${tmp.path}/raw/sources/project-b/config.yaml`)
    const pagePath = `${tmp.path}/wiki/entities/legacy.md`
    await writeFileRaw(pagePath, [
      "---",
      'sources: ["config.yaml"]',
      "---",
      "# Legacy",
    ].join("\n"))

    await migrateSourcePath(
      tmp.path,
      "raw/sources/project-a/config.yaml",
      "raw/sources/archive/config.yaml",
    )

    expect(await fs.readFile(pagePath, "utf8")).toContain(
      'sources: ["archive/config.yaml"]',
    )
  })

  it("does not rewrite an ambiguous legacy basename source reference", async () => {
    if (!tmp) throw new Error("missing temp project")
    const pagePath = `${tmp.path}/wiki/entities/ambiguous.md`
    await writeFileRaw(pagePath, [
      "---",
      'sources: ["config.yaml"]',
      "---",
      "# Ambiguous",
    ].join("\n"))

    await migrateSourcePath(
      tmp.path,
      "raw/sources/project-a/config.yaml",
      "raw/sources/archive/config.yaml",
    )

    expect(await fs.readFile(pagePath, "utf8")).toContain(
      'sources: ["config.yaml"]',
    )
  })

  it("migrates a safe legacy basename source summary to the canonical nested source path", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config"]
    await fs.rm(path.join(tmp.path, "raw", "sources", "project-b", "config.yaml"))

    const legacySummaryPath = path.join(tmp.path, "wiki", "sources", "config.md")
    await writeFileRaw(
      legacySummaryPath,
      [
        "---",
        'title: "Source: config.yaml"',
        'sources: ["config.yaml"]',
        "---",
        "",
        "# Legacy config",
        "",
        "Legacy source summary body.",
      ].join("\n"),
    )

    await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )

    const canonicalSummary = `wiki/sources/${sourceSummarySlugFromIdentity("project-a/config.yaml")}.md`
    const canonicalSummaryPath = path.join(tmp.path, canonicalSummary)
    const content = await fs.readFile(canonicalSummaryPath, "utf8")

    await expect(fs.access(legacySummaryPath)).rejects.toThrow()
    expect(content).toContain('sources: ["project-a/config.yaml"]')
    expect(content).toContain("project-a config")
  })

  it("does not migrate a legacy basename source summary when the basename is ambiguous", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config"]

    const legacySummaryPath = path.join(tmp.path, "wiki", "sources", "config.md")
    const legacyContent = [
      "---",
      'title: "Source: config.yaml"',
      'sources: ["config.yaml"]',
      "---",
      "",
      "# Legacy config",
      "",
      "Ambiguous legacy source summary body.",
    ].join("\n")
    await writeFileRaw(legacySummaryPath, legacyContent)

    await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )

    const canonicalSummary = `wiki/sources/${sourceSummarySlugFromIdentity("project-a/config.yaml")}.md`
    const canonicalSummaryPath = path.join(tmp.path, canonicalSummary)

    expect(await fs.readFile(legacySummaryPath, "utf8")).toBe(legacyContent)
    expect(await fs.readFile(canonicalSummaryPath, "utf8")).toContain("project-a config")
  })

  it("analyzes oversized sources in chunks before final wiki generation", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["long source"]
    const longSourcePath = `${tmp.path}/raw/sources/project-a/long-report.md`
    await writeFileRaw(
      longSourcePath,
      [
        "# Chapter One",
        "",
        "A".repeat(9000),
        "",
        "## Chapter Two",
        "",
        "B".repeat(9000),
        "",
        "## Chapter Three",
        "",
        "C".repeat(9000),
      ].join("\n"),
    )

    await autoIngest(
      tmp.path,
      longSourcePath,
      { ...useWikiStore.getState().llmConfig, maxContextSize: 20_000 },
      undefined,
      "project-a",
    )

    const chunkCalls = mockStreamChat.mock.calls.filter(([, messages]) =>
      String(messages?.[0]?.content ?? "").startsWith("You are analyzing a long source document"),
    )
    expect(chunkCalls.length).toBeGreaterThan(1)
    const chunkSystemPrompt = String(chunkCalls[0][1]?.[0]?.content ?? "")
    expect(chunkSystemPrompt).toContain("wiki/goals/")
    expect(chunkSystemPrompt).toContain("Schema-Typed Candidates")
    expect(chunkSystemPrompt).toContain("never invent goals")
    expect(String(chunkCalls[0][1]?.[1]?.content ?? "")).toContain("## MAIN CHUNK TO ANALYZE")
    expect(String(chunkCalls[1][1]?.[1]?.content ?? "")).toContain(
      "Digest after chunk 1: stable context 1.",
    )
    expect(String(chunkCalls[1][1]?.[1]?.content ?? "")).not.toContain(
      "introduced topic 1",
    )

    const generationCall = mockStreamChat.mock.calls.find(([, messages]) =>
      String(messages?.[0]?.content ?? "").includes("Based on the analysis below, generate the requested bounded batch"),
    )
    expect(generationCall).toBeTruthy()
    const generationPrompt = String(generationCall?.[1]?.[0]?.content ?? "")
    expect(generationPrompt).toContain("Long Source Context")
    expect(generationPrompt).toContain(
      `Digest after chunk ${chunkCalls.length}: stable context ${chunkCalls.length}.`,
    )
    const finalDigestSection = generationPrompt
      .split("## Source Context")[1]
      ?.split("## Chunk Analysis Notes")[0] ?? ""
    expect(finalDigestSection).toContain(
      `Digest after chunk ${chunkCalls.length}: stable context ${chunkCalls.length}.`,
    )
    expect(finalDigestSection).not.toContain(
      `Chunk ${chunkCalls.length} introduced topic ${chunkCalls.length}.`,
    )
  })

  it("turns a legacy long-document outline into pages and source links", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["legacy textbook outline"]
    longSourceDigestLinks = [
      "### Entities",
      "- [[entities/邓小平]] — central historical figure",
      "### Concepts",
      "- [[concepts/改革开放]] — central policy",
      "- [[concepts/经济特区]] — implementation mechanism",
    ]
    const longSourcePath = `${tmp.path}/raw/sources/project-a/legacy-outline.md`
    await writeFileRaw(
      longSourcePath,
      [
        "# Chapter One",
        "A".repeat(9_000),
        "# Chapter Two",
        "B".repeat(9_000),
        "# Chapter Three",
        "C".repeat(9_000),
      ].join("\n\n"),
    )

    generationBatchResponder = (paths) => ({
      output: paths.map((requestedPath) => {
        const isSource = requestedPath.startsWith("wiki/sources/")
        const pageName = path.basename(requestedPath, ".md")
        return [
          `---FILE: ${requestedPath}---`,
          "---",
          `type: ${isSource ? "source" : requestedPath.includes("/entities/") ? "entity" : "concept"}`,
          `title: "${pageName}"`,
          'sources: ["project-a/legacy-outline.md"]',
          "tags: []",
          "related: []",
          "---",
          "",
          `# ${pageName}`,
          "",
          "Complete source-backed content without hand-written wikilinks.",
          "---END FILE---",
        ].join("\n")
      }).join("\n\n"),
    })

    const written = await autoIngest(
      tmp.path,
      longSourcePath,
      { ...useWikiStore.getState().llmConfig, maxContextSize: 20_000 },
      undefined,
      "project-a",
    )

    expect(written).toEqual(expect.arrayContaining([
      "wiki/entities/邓小平.md",
      "wiki/concepts/改革开放.md",
      "wiki/concepts/经济特区.md",
    ]))
    const sourceSummaryPath = path.join(
      tmp.path,
      "wiki",
      "sources",
      `${sourceSummarySlugFromIdentity("project-a/legacy-outline.md")}.md`,
    )
    const sourceSummary = await fs.readFile(sourceSummaryPath, "utf8")
    expect(sourceSummary).toContain("[[entities/邓小平|邓小平]]")
    expect(sourceSummary).toContain("[[concepts/改革开放|改革开放]]")
    expect(sourceSummary).toContain("[[concepts/经济特区|经济特区]]")
  })

  it("does not report a long document complete when the knowledge plan is empty", async () => {
    if (!tmp) throw new Error("missing temp project")
    longSourceFinalPlan = ""
    const longSourcePath = `${tmp.path}/raw/sources/project-a/empty-plan.md`
    await writeFileRaw(
      longSourcePath,
      ["# One", "A".repeat(9_000), "# Two", "B".repeat(9_000), "# Three", "C".repeat(9_000)].join("\n\n"),
    )

    await expect(autoIngest(
      tmp.path,
      longSourcePath,
      { ...useWikiStore.getState().llmConfig, maxContextSize: 20_000 },
      undefined,
      "project-a",
    )).rejects.toThrow("Long-document knowledge plan could not be finalized")

    const summaryPath = path.join(
      tmp.path,
      "wiki",
      "sources",
      `${sourceSummarySlugFromIdentity("project-a/empty-plan.md")}.md`,
    )
    await expect(fs.access(summaryPath)).rejects.toThrow()
  })

  it("resumes oversized source analysis from the persisted chunk checkpoint", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["long source"]
    failLongChunksOnce = new Set([2])
    const longSourcePath = `${tmp.path}/raw/sources/project-a/resume-report.md`
    const llmConfig = { ...useWikiStore.getState().llmConfig, maxContextSize: 20_000 }
    await writeFileRaw(
      longSourcePath,
      [
        "# Chapter One",
        "",
        "A".repeat(9000),
        "",
        "## Chapter Two",
        "",
        "B".repeat(9000),
        "",
        "## Chapter Three",
        "",
        "C".repeat(9000),
      ].join("\n"),
    )

    await expect(
      autoIngest(tmp.path, longSourcePath, llmConfig, undefined, "project-a"),
    ).rejects.toThrow("Chunk analysis stream failed")

    const progressDir = path.join(tmp.path, ".llm-wiki", "ingest-progress")
    expect((await fs.readdir(progressDir)).filter((name) => name.endsWith(".json"))).toHaveLength(1)

    mockStreamChat.mockClear()
    await autoIngest(tmp.path, longSourcePath, llmConfig, undefined, "project-a")

    const resumedChunkCalls = mockStreamChat.mock.calls.filter(([, messages]) =>
      String(messages?.[0]?.content ?? "").startsWith("You are analyzing a long source document"),
    )
    expect(resumedChunkCalls.length).toBeGreaterThan(0)
    expect(String(resumedChunkCalls[0][1]?.[1]?.content ?? "")).toContain("Chunk: 2/3")
    expect(String(resumedChunkCalls[0][1]?.[1]?.content ?? "")).toContain(
      "Digest after chunk 1: stable context 1.",
    )
    expect(String(resumedChunkCalls[0][1]?.[1]?.content ?? "")).not.toContain(
      "introduced topic 1",
    )
    await expect(fs.readdir(progressDir)).resolves.toEqual([])
  })

  it("adds follow-up research reviews from the dedicated review stage", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config"]
    generationBodySuffix = "X".repeat(10_500)
    extraReviewResponse = [
      "---REVIEW: suggestion | Research nitrification inhibition signals---",
      "Add follow-up research on early-warning indicators for nitrification inhibition.",
      "OPTIONS: Create Page | Skip",
      "SEARCH: nitrification inhibition early warning wastewater | ammonia oxidation inhibition signals | wastewater nitrification process upset indicators",
      "---END REVIEW---",
    ].join("\n")

    await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )

    const reviews = useReviewStore.getState().items
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({
      type: "suggestion",
      title: "Research nitrification inhibition signals",
    })
    expect(reviews[0].searchQueries).toEqual([
      "nitrification inhibition early warning wastewater",
      "ammonia oxidation inhibition signals",
      "wastewater nitrification process upset indicators",
    ])
  })

  it("parses generation and dedicated review-stage blocks separately", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config"]
    generationBodySuffix = "X".repeat(10_500)
    generationSuffix = [
      "",
      "---REVIEW: missing-page | Truncated Orphan---",
      "Partial description that got cut off",
    ].join("\n")
    extraReviewResponse = [
      "---REVIEW: suggestion | Real Follow-up---",
      "Real description that should not be swallowed by the generation orphan.",
      "OPTIONS: Create Page | Skip",
      "SEARCH: real follow up query | second query",
      "---END REVIEW---",
    ].join("\n")

    await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      { ...useWikiStore.getState().llmConfig, maxContextSize: 128_000 },
      undefined,
      "project-a",
    )

    const reviews = useReviewStore.getState().items
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({
      type: "suggestion",
      title: "Real Follow-up",
    })
    expect(reviews[0].description).not.toContain("Truncated Orphan")
  })

  it("repairs a requested FILE block that was truncated during its generation batch", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config"]
    analysisOverride = [
      "## Generation Contract",
      "- [[concepts/recovered]] — required concept from the source.",
    ].join("\n")
    generationSuffix = [
      "",
      "---FILE: wiki/concepts/recovered.md---",
      "---",
      'title: "Recovered concept"',
      'sources: ["project-a/config.yaml"]',
      "---",
      "",
      "# Recovered concept",
      "",
      "This response was cut off",
    ].join("\n")
    missingPageRepairResponse = [
      "---FILE: wiki/concepts/recovered.md---",
      "---",
      'title: "Recovered concept"',
      'sources: ["project-a/config.yaml"]',
      "---",
      "",
      "# Recovered concept",
      "",
      "This block was regenerated completely.",
      "---END FILE---",
      "",
      "---FILE: wiki/concepts/stray.md---",
      "# Stray concept",
      "---END FILE---",
    ].join("\n")

    const written = await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )

    expect(written).toContain("wiki/concepts/recovered.md")
    await expect(
      fs.readFile(`${tmp.path}/wiki/concepts/recovered.md`, "utf8"),
    ).resolves.toContain("This block was regenerated completely.")
    expect(written).not.toContain("wiki/concepts/stray.md")
    await expect(
      fs.readFile(`${tmp.path}/wiki/concepts/stray.md`, "utf8"),
    ).rejects.toThrow()
    expect(
      mockStreamChat.mock.calls.some(([, messages]) =>
        String(messages[0]?.content ?? "").startsWith(
          "You are completing wiki pages",
        ),
      ),
    ).toBe(true)
  })

  it("repairs an expected analysis page that the main generation never started", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config"]
    analysisOverride = [
      "## Generation Contract",
      "- [[concepts/missing-concept]] — important concept from the source.",
    ].join("\n")
    missingPageRepairResponse = [
      "---FILE: wiki/concepts/missing-concept.md---",
      "---",
      "type: concept",
      "title: Missing Concept",
      "tags: [test]",
      "related: []",
      'sources: ["project-a/config.yaml"]',
      "---",
      "",
      "# Missing Concept",
      "",
      "Recovered after the main generation omitted the page entirely.",
      "---END FILE---",
    ].join("\n")

    const written = await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )

    expect(written).toContain("wiki/concepts/missing-concept.md")
    await expect(
      fs.readFile(`${tmp.path}/wiki/concepts/missing-concept.md`, "utf8"),
    ).resolves.toContain("Recovered after the main generation omitted the page entirely.")
    expect(
      mockStreamChat.mock.calls.some(([, messages]) =>
        String(messages[0]?.content ?? "").startsWith("You are completing wiki pages"),
      ),
    ).toBe(true)
    expect(useActivityStore.getState().items[0]?.status).toBe("done")
  })

  it("fails visibly when expected analysis pages remain missing after bounded repair", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config"]
    analysisOverride = "## Generation Contract\n- [[concepts/still-missing]] — required."
    missingPageRepairResponse = ""

    await expect(
      autoIngest(
        tmp.path,
        `${tmp.path}/raw/sources/project-a/config.yaml`,
        useWikiStore.getState().llmConfig,
        undefined,
        "project-a",
      ),
    ).rejects.toThrow(/1 expected page\(s\) missing/)

    const activity = useActivityStore.getState().items[0]
    expect(activity?.status).toBe("error")
    expect(activity?.detail).toContain("1 expected page(s) missing")
    expect(
      mockStreamChat.mock.calls.filter(([, messages]) =>
        String(messages[0]?.content ?? "").startsWith("You are completing wiki pages"),
      ),
    ).toHaveLength(2)
  })

  it("resumes wiki generation from saved complete blocks instead of regenerating successful batches", async () => {
    if (!tmp) throw new Error("missing temp project")
    const conceptPaths = Array.from({ length: 7 }, (_, index) => `wiki/concepts/topic-${index + 1}.md`)
    analysisOverride = [
      "## Generation Contract",
      ...conceptPaths.map((path) => `- [[${path.replace(/^wiki\//, "").replace(/\.md$/, "")}]] — required topic.`),
    ].join("\n")

    const renderBlocks = (paths: string[]) => paths.map((requestedPath) => [
      `---FILE: ${requestedPath}---`,
      "---",
      'type: "concept"',
      `title: "${path.basename(requestedPath, ".md")}"`,
      'sources: ["project-a/config.yaml"]',
      "tags: []",
      "related: []",
      "---",
      "",
      `# ${path.basename(requestedPath, ".md")}`,
      "",
      `Complete evidence for ${requestedPath}.`,
      "---END FILE---",
    ].join("\n")).join("\n\n")

    generationBatchResponder = (paths, requestIndex) => requestIndex === 0
      ? { output: renderBlocks(paths) }
      : { error: "simulated connection loss" }

    await expect(autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )).rejects.toThrow(/expected page\(s\) missing/)

    const completedFirstBatch = [...generationBatchRequests[0]]
    expect(completedFirstBatch).toHaveLength(6)

    generationBatchRequests = []
    generationBatchResponder = (paths) => ({ output: renderBlocks(paths) })

    const written = await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )

    expect(generationBatchRequests).toEqual([conceptPaths.slice(5)])
    expect(written).toEqual(expect.arrayContaining(conceptPaths))
    expect(generationBatchRequests[0]).not.toEqual(expect.arrayContaining(completedFirstBatch))

    const diagnosticPath = path.join(
      tmp.path,
      ".llm-wiki",
      "ingest-diagnostics",
      `${sourceSummarySlugFromIdentity("project-a/config.yaml")}.json`,
    )
    const diagnostic = JSON.parse(await fs.readFile(diagnosticPath, "utf8")) as {
      resumedKnowledgePages: number
      modelCalls: { analysis: number; generation: number; repair: number; review: number; merge: number }
    }
    expect(diagnostic.resumedKnowledgePages).toBe(6)
    expect(diagnostic.modelCalls.analysis).toBe(0)
    expect(diagnostic.modelCalls.generation).toBe(1)
    expect(diagnostic.modelCalls.repair).toBe(0)
    expect(diagnostic.modelCalls.merge).toBe(0)
  })

  it("does not repeat a completed page merge after a later cancellation", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config"]
    const sourceIdentity = "project-a/config.yaml"
    const summarySlug = sourceSummarySlugFromIdentity(sourceIdentity)
    const summaryPath = path.join(tmp.path, "wiki", "sources", `${summarySlug}.md`)
    await fs.mkdir(path.dirname(summaryPath), { recursive: true })
    await fs.writeFile(summaryPath, [
      "---",
      'title: "Existing shared source page"',
      'sources: ["other/source.md"]',
      "---",
      "",
      "# Existing shared source page",
      "",
      "Content that must survive the merge.",
    ].join("\n"), "utf8")

    const controller = new AbortController()
    await expect(autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      controller.signal,
      "project-a",
      () => controller.abort(),
    )).rejects.toThrow(/cancelled/i)
    expect(mergeRequestCount).toBe(1)

    const written = await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )

    expect(written).toContain(`wiki/sources/${summarySlug}.md`)
    expect(mergeRequestCount).toBe(1)
    const diagnostic = JSON.parse(await fs.readFile(
      path.join(tmp.path, ".llm-wiki", "ingest-diagnostics", `${summarySlug}.json`),
      "utf8",
    )) as { resumedWrittenPages: number; modelCalls: { merge: number } }
    expect(diagnostic.resumedWrittenPages).toBe(1)
    expect(diagnostic.modelCalls.merge).toBe(0)
  })

  it("resumes a large 61-page plan by requesting only the failed batch", async () => {
    if (!tmp) throw new Error("missing temp project")
    const conceptPaths = Array.from({ length: 61 }, (_, index) => `wiki/concepts/large-topic-${index + 1}.md`)
    analysisOverride = [
      "## Generation Contract",
      ...conceptPaths.map((requestedPath) => `- [[${requestedPath.replace(/^wiki\//, "").replace(/\.md$/, "")}]]`),
    ].join("\n")
    const renderBlocks = (paths: string[]) => paths.map((requestedPath) => [
      `---FILE: ${requestedPath}---`,
      "---",
      `title: "${path.basename(requestedPath, ".md")}"`,
      'sources: ["project-a/config.yaml"]',
      "---",
      "",
      `# ${path.basename(requestedPath, ".md")}`,
      "",
      `Complete evidence for ${requestedPath}.`,
      "---END FILE---",
    ].join("\n")).join("\n\n")
    let failTargetBatch = true
    generationBatchResponder = (paths) => (
      failTargetBatch && paths.includes("wiki/concepts/large-topic-24.md")
        ? { error: "simulated one-batch outage" }
        : { output: renderBlocks(paths) }
    )

    await expect(autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )).rejects.toThrow(/expected page\(s\) missing/)

    failTargetBatch = false
    generationBatchRequests = []
    const written = await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )

    expect(generationBatchRequests).toHaveLength(1)
    expect(generationBatchRequests[0]).toEqual([
      "wiki/concepts/large-topic-24.md",
      "wiki/concepts/large-topic-25.md",
      "wiki/concepts/large-topic-26.md",
      "wiki/concepts/large-topic-27.md",
      "wiki/concepts/large-topic-28.md",
      "wiki/concepts/large-topic-29.md",
    ])
    expect(written).toEqual(expect.arrayContaining(conceptPaths))
  })

  it("propagates cancellation that happens during the dedicated review stage", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config"]
    generationBodySuffix = "X".repeat(10_500)
    const controller = new AbortController()
    abortDuringReview = controller

    await expect(
      autoIngest(
        tmp.path,
        `${tmp.path}/raw/sources/project-a/config.yaml`,
        { ...useWikiStore.getState().llmConfig, maxContextSize: 128_000 },
        controller.signal,
        "project-a",
      ),
    ).rejects.toThrow("Ingest cancelled")
  })

  it("falls back to built-in PDF extraction when MinerU fails for a non-cancelled ingest", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["mineru fallback source"]
    await writeFileRaw(`${tmp.path}/raw/sources/project-a/report.pdf`, "pdf fallback text\n")
    useWikiStore.setState({
      mineruConfig: {
        enabled: true,
        token: "mineru-token",
        modelVersion: "vlm",
      },
    })
    mockParseWithMineru.mockRejectedValueOnce(new Error("network failure from MinerU"))
    const updateSpy = vi.spyOn(useActivityStore.getState(), "updateItem")

    const written = await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/report.pdf`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )

    expect(written.length).toBeGreaterThan(0)
    expect(mockParseWithMineru).toHaveBeenCalled()
    expect(
      updateSpy.mock.calls.some(([, updates]) =>
        updates.detail?.includes("falling back to built-in PDF extraction"),
      ),
    ).toBe(true)
    updateSpy.mockRestore()
  })

  it("uses a configured local MinerU backend without a cloud token", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["local mineru source"]
    await writeFileRaw(`${tmp.path}/raw/sources/project-a/local.pdf`, "pdf fallback text\n")
    useWikiStore.setState({
      mineruConfig: {
        enabled: true,
        backend: "local",
        token: "",
        modelVersion: "vlm",
      },
    })
    mockParseWithMineru.mockResolvedValueOnce({
      markdown: "local MinerU markdown",
      savedImages: [],
    })

    await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/local.pdf`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )

    expect(mockParseWithMineru).toHaveBeenCalled()
  })

  it("reuses the verified MinerU stage when only the ingest model changes", async () => {
    if (!tmp) throw new Error("missing temp project")
    const sourcePath = `${tmp.path}/raw/sources/project-a/stage-cache.pdf`
    await writeFileRaw(sourcePath, "pdf fallback text\n")
    sourceMarkers = ["first model", "second model"]
    useWikiStore.setState({
      mineruConfig: {
        enabled: true,
        backend: "local",
        token: "",
        modelVersion: "vlm",
      },
    })
    mockParseWithMineru.mockResolvedValueOnce({
      markdown: "verified MinerU markdown",
      savedImages: [],
      processedPageCount: null,
    })

    const firstConfig = { ...useWikiStore.getState().llmConfig, model: "ingest-model-a" }
    await autoIngest(tmp.path, sourcePath, firstConfig, undefined, "project-a")
    const secondConfig = { ...firstConfig, model: "ingest-model-b" }
    await autoIngest(tmp.path, sourcePath, secondConfig, undefined, "project-a")

    expect(mockParseWithMineru).toHaveBeenCalledTimes(1)
  })

  it("does not fall back to built-in PDF extraction when MinerU is cancelled", async () => {
    if (!tmp) throw new Error("missing temp project")
    await writeFileRaw(`${tmp.path}/raw/sources/project-a/cancelled.pdf`, "pdf fallback text\n")
    useWikiStore.setState({
      mineruConfig: {
        enabled: true,
        token: "mineru-token",
        modelVersion: "vlm",
      },
    })
    const controller = new AbortController()
    controller.abort()
    mockParseWithMineru.mockRejectedValueOnce(new Error("MinerU parsing cancelled"))

    await expect(
      autoIngest(
        tmp.path,
        `${tmp.path}/raw/sources/project-a/cancelled.pdf`,
        useWikiStore.getState().llmConfig,
        controller.signal,
        "project-a",
      ),
    ).rejects.toThrow("Ingest cancelled")

    expect(
      useActivityStore.getState().items.some((item) =>
        item.detail?.includes("falling back to built-in PDF extraction"),
      ),
    ).toBe(false)
  })

  it("canonicalizes interactive source summary paths and sources frontmatter", async () => {
    if (!tmp) throw new Error("missing temp project")

    const conversationId = "conv-interactive-source"
    useChatStore.setState({
      activeConversationId: conversationId,
      conversations: [
        {
          id: conversationId,
          title: "Interactive source summary",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      ingestSource: `${tmp.path}/raw/sources/project-a/config.yaml`,
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Please save the source summary.",
          timestamp: Date.now(),
          conversationId,
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Ready to create the source summary.",
          timestamp: Date.now(),
          conversationId,
        },
      ],
    })

    const writtenPaths = await executeIngestWrites(
      tmp.path,
      useWikiStore.getState().llmConfig,
    )

    const canonicalSummary = `wiki/sources/${sourceSummarySlugFromIdentity("project-a/config.yaml")}.md`
    const canonicalSummaryPath = path.join(tmp.path, canonicalSummary).replace(/\\/g, "/")
    const staleSummaryPath = path.join(tmp.path, "wiki", "sources", "config.md")
    const content = await fs.readFile(canonicalSummaryPath, "utf8")

    expect(writtenPaths.map((p) => p.replace(/\\/g, "/"))).toEqual([canonicalSummaryPath])
    await expect(fs.access(staleSummaryPath)).rejects.toThrow()
    expect(content).toContain('sources: ["project-a/config.yaml"]')
  })

  it("rejects unsafe and application-managed paths from interactive writes", async () => {
    if (!tmp) throw new Error("missing temp project")
    interactiveGenerationOverride = [
      "---FILE: wiki/INDEX.md---\n# hostile index\n---END FILE---",
      "---FILE: wiki\\overview.MD---\n# hostile overview\n---END FILE---",
      "---FILE: ../escape.md---\n# escape\n---END FILE---",
    ].join("\n")
    useChatStore.setState({ ingestSource: `${tmp.path}/raw/sources/project-a/config.yaml` })

    const written = await executeIngestWrites(tmp.path, useWikiStore.getState().llmConfig)

    expect(written).toEqual([])
    await expect(fs.access(path.join(tmp.path, "escape.md"))).rejects.toThrow()
  })
})
