import { fileExists, readFileAsBase64, writeFileBase64 } from "@/commands/fs"
import { getHttpFetch } from "@/lib/tauri-fetch"

export interface TeachingImageConfig {
  enabled: boolean
  endpoint: string
  apiKey: string
  model: string
  size: "1024x1024" | "1536x1024" | "1024x1536"
}

export const DEFAULT_TEACHING_IMAGE_CONFIG: TeachingImageConfig = {
  enabled: false,
  endpoint: "https://api.openai.com/v1/images/generations",
  apiKey: "",
  model: "gpt-image-1",
  size: "1536x1024",
}

function cachePath(projectPath: string, fingerprint: string): string {
  return `${projectPath.replace(/[\\/]+$/, "")}/.llm-wiki/learning/visuals/${fingerprint}.png`
}

async function cacheFingerprint(input: { fingerprint: string; prompt: string; model: string; size: string }): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${input.fingerprint}\n${input.model}\n${input.size}\n${input.prompt}`))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function isQwenImage3(model: string): boolean {
  return /^qwen-image-3\.0(?:-|$)/i.test(model.trim())
}

function dashScopeImageEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint.trim())
    if (url.hostname === "dashscope.aliyuncs.com"
      || url.hostname === "dashscope-intl.aliyuncs.com"
      || url.hostname.endsWith(".maas.aliyuncs.com")) {
      url.pathname = "/api/v1/services/aigc/multimodal-generation/generation"
      url.search = ""
      url.hash = ""
      return url.toString()
    }
  } catch {
    // Let fetch report malformed or custom endpoints with its normal error.
  }
  return endpoint.trim()
}

function qwenImageUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const output = (payload as { output?: unknown }).output
  if (!output || typeof output !== "object") return undefined
  const choices = (output as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return undefined
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue
    const message = (choice as { message?: unknown }).message
    if (!message || typeof message !== "object") continue
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const item of content) {
      if (item && typeof item === "object" && typeof (item as { image?: unknown }).image === "string") {
        return (item as { image: string }).image
      }
    }
  }
  return undefined
}

export async function generateTeachingImage(input: {
  projectPath: string
  fingerprint: string
  prompt: string
  config: TeachingImageConfig
  signal?: AbortSignal
}): Promise<string> {
  const path = cachePath(input.projectPath, await cacheFingerprint({ fingerprint: input.fingerprint, prompt: input.prompt, model: input.config.model, size: input.config.size }))
  if (await fileExists(path)) {
    const cached = await readFileAsBase64(path)
    return `data:${cached.mimeType};base64,${cached.base64}`
  }
  if (!input.config.enabled) throw new Error("尚未开启教学图片生成。")
  if (!input.config.endpoint.trim() || !input.config.apiKey.trim() || !input.config.model.trim()) {
    throw new Error("教学图片接口还没有配置完整。")
  }
  const httpFetch = await getHttpFetch()
  const qwenImage = isQwenImage3(input.config.model)
  const endpoint = qwenImage ? dashScopeImageEndpoint(input.config.endpoint) : input.config.endpoint.trim()
  const body = qwenImage
    ? {
        model: input.config.model.trim(),
        input: {
          messages: [{ role: "user", content: [{ text: input.prompt }] }],
        },
        parameters: {
          size: input.config.size.replace("x", "*"),
          n: 1,
          prompt_extend: false,
          watermark: false,
        },
      }
    : {
        model: input.config.model.trim(),
        prompt: input.prompt,
        size: input.config.size,
        output_format: "png",
      }
  const response = await httpFetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.config.apiKey.trim()}`,
    },
    body: JSON.stringify(body),
    signal: input.signal,
  })
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500)
    throw new Error(`教学图片生成失败（HTTP ${response.status}）${detail ? `：${detail}` : "。"}`)
  }
  const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> }
  const result = payload.data?.[0]
  let base64 = result?.b64_json
  const resultUrl = qwenImage ? qwenImageUrl(payload) : result?.url
  if (!base64 && resultUrl) {
    const imageResponse = await httpFetch(resultUrl, { signal: input.signal })
    if (!imageResponse.ok) throw new Error(`教学图片已经生成，但下载失败（HTTP ${imageResponse.status}）。`)
    base64 = arrayBufferToBase64(await imageResponse.arrayBuffer())
  }
  if (!base64) throw new Error("图片接口没有返回可用图片。")
  await writeFileBase64(path, base64)
  return `data:image/png;base64,${base64}`
}
