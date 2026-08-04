import { describe, expect, it } from "vitest"
import { hasRunningIngestActivity, ingestActivityKey, type ActivityItem } from "./activity-store"

describe("ingestActivityKey", () => {
  it("uses the same identity for relative and absolute paths", () => {
    expect(ingestActivityKey("D:/wiki", "raw/sources/report.pdf")).toBe(
      ingestActivityKey("D:/wiki", "D:/wiki/raw/sources/report.pdf"),
    )
  })

  it("keeps same-named files in different projects separate", () => {
    expect(ingestActivityKey("D:/wiki-a", "raw/sources/report.pdf")).not.toBe(
      ingestActivityKey("D:/wiki-b", "raw/sources/report.pdf"),
    )
  })

  it("recognizes when the queue task already has a live activity row", () => {
    const projectPath = "D:/wiki"
    const items: ActivityItem[] = [{
      id: "activity-1",
      type: "ingest",
      activityKey: ingestActivityKey(projectPath, "D:/wiki/raw/sources/report.pdf"),
      title: "report.pdf",
      status: "running",
      detail: "Analyzing long source chunk 6/9...",
      filesWritten: [],
      createdAt: 1,
    }]

    expect(hasRunningIngestActivity(items, projectPath, "raw/sources/report.pdf")).toBe(true)
    expect(hasRunningIngestActivity(items, projectPath, "raw/sources/other.pdf")).toBe(false)
  })
})
