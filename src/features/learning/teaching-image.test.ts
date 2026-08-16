import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_TEACHING_IMAGE_CONFIG, generateTeachingImage } from "./teaching-image"

const mocks = vi.hoisted(() => ({
  exists: false,
  write: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  fileExists: () => Promise.resolve(mocks.exists),
  readFileAsBase64: () => Promise.resolve({ base64: "cached", mimeType: "image/png" }),
  writeFileBase64: mocks.write,
}))

vi.mock("@/lib/tauri-fetch", () => ({ getHttpFetch: () => Promise.resolve(mocks.fetch) }))

describe("teaching image generation", () => {
  beforeEach(() => { mocks.exists = false; mocks.write.mockReset(); mocks.fetch.mockReset() })

  it("reuses a project cache without calling the paid endpoint", async () => {
    mocks.exists = true
    const result = await generateTeachingImage({ projectPath: "C:/project", fingerprint: "source", prompt: "diagram", config: DEFAULT_TEACHING_IMAGE_CONFIG })
    expect(result).toBe("data:image/png;base64,cached")
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it("refuses to generate when the user has not enabled image generation", async () => {
    await expect(generateTeachingImage({ projectPath: "C:/project", fingerprint: "source", prompt: "diagram", config: DEFAULT_TEACHING_IMAGE_CONFIG })).rejects.toThrow("尚未开启")
  })

  it("saves a successful base64 response inside the project", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [{ b64_json: "new-image" }] }) })
    const result = await generateTeachingImage({ projectPath: "C:/project", fingerprint: "source", prompt: "diagram", config: { ...DEFAULT_TEACHING_IMAGE_CONFIG, enabled: true, apiKey: "key" } })
    expect(result).toBe("data:image/png;base64,new-image")
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({
      model: "gpt-image-1",
      size: "1536x1024",
      output_format: "png",
    })
    expect(mocks.write).toHaveBeenCalledWith(expect.stringContaining("/.llm-wiki/learning/visuals/"), "new-image")
  })
})
