import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_TEACHING_IMAGE_CONFIG, enforcePureVisualPrompt, generateTeachingImage } from "./teaching-image"

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

  it("removes source prose and forces one text-free scene before generation", () => {
    const prompt = enforcePureVisualPrompt("画一个并联电路。来源依据：这里是很长的教材定义和公式。")
    expect(prompt).toContain("单一形象画面")
    expect(prompt).toContain("画一个并联电路")
    expect(prompt).not.toContain("教材定义和公式")
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
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).prompt).toContain("单一形象画面")
    expect(mocks.write).toHaveBeenCalledWith(expect.stringContaining("/.llm-wiki/learning/visuals/"), "new-image")
  })

  it("uses the native Alibaba request for qwen-image-3.0 and caches the returned image", async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          output: { choices: [{ message: { content: [{ image: "https://example.com/qwen.png" }] } }] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      })

    const result = await generateTeachingImage({
      projectPath: "C:/project",
      fingerprint: "qwen-source",
      prompt: "并联电路知识关系图",
      config: {
        ...DEFAULT_TEACHING_IMAGE_CONFIG,
        enabled: true,
        endpoint: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/images/generations",
        apiKey: "sk-test",
        model: "qwen-image-3.0",
      },
    })

    expect(mocks.fetch.mock.calls[0][0]).toBe("https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation")
    const qwenBody = JSON.parse(mocks.fetch.mock.calls[0][1].body)
    expect(qwenBody).toMatchObject({
      model: "qwen-image-3.0",
      parameters: { size: "1536*1024", n: 1, prompt_extend: false, watermark: false },
    })
    expect(qwenBody.input.messages[0].content[0].text).toContain("单一形象画面")
    expect(qwenBody.parameters.negative_prompt).toContain("教材页面")
    expect(qwenBody.parameters.negative_prompt).toContain("二维码")
    expect(mocks.fetch.mock.calls[1][0]).toBe("https://example.com/qwen.png")
    expect(mocks.write).toHaveBeenCalledWith(expect.stringContaining("/.llm-wiki/learning/visuals/"), "AQID")
    expect(result).toBe("data:image/png;base64,AQID")
  })
})
