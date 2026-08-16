import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DEFAULT_TEACHING_IMAGE_CONFIG, type TeachingImageConfig } from "@/features/learning/teaching-image"
import { loadTeachingImageConfig, saveTeachingImageConfig } from "@/lib/project-store"

export function TeachingSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<TeachingImageConfig>(DEFAULT_TEACHING_IMAGE_CONFIG)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")

  useEffect(() => {
    loadTeachingImageConfig().then(setConfig).catch(() => setStatus("error"))
  }, [])

  const update = <K extends keyof TeachingImageConfig>(key: K, value: TeachingImageConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }))
    setStatus("idle")
  }

  const save = async () => {
    setStatus("saving")
    try {
      await saveTeachingImageConfig(config)
      setStatus("saved")
    } catch {
      setStatus("error")
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.teaching.title")}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("settings.sections.teaching.description")}</p>
      </div>
      <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
        <label className="flex items-start gap-3 text-sm">
          <input className="mt-1" type="checkbox" checked={config.enabled} onChange={(event) => update("enabled", event.target.checked)} />
          <span><strong className="block font-medium">{t("settings.sections.teaching.imageEnabled")}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{t("settings.sections.teaching.imageEnabledHint")}</span></span>
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="teaching-image-endpoint">{t("settings.sections.teaching.endpoint")}</Label>
          <Input id="teaching-image-endpoint" value={config.endpoint} onChange={(event) => update("endpoint", event.target.value)} placeholder="https://api.openai.com/v1/images/generations" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="teaching-image-key">{t("settings.sections.teaching.apiKey")}</Label>
          <Input id="teaching-image-key" type="password" value={config.apiKey} onChange={(event) => update("apiKey", event.target.value)} autoComplete="off" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="teaching-image-model">{t("settings.sections.teaching.model")}</Label><Input id="teaching-image-model" value={config.model} onChange={(event) => update("model", event.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="teaching-image-size">{t("settings.sections.teaching.size")}</Label><select id="teaching-image-size" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={config.size} onChange={(event) => update("size", event.target.value as TeachingImageConfig["size"])}><option value="1536x1024">1536 × 1024</option><option value="1024x1024">1024 × 1024</option><option value="1024x1536">1024 × 1536</option></select></div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4"><p className={`text-xs ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{status === "saved" ? t("settings.savedTick") : status === "error" ? t("settings.saveFailed") : t("settings.sections.teaching.costHint")}</p><Button onClick={() => void save()} disabled={status === "saving"}>{status === "saving" ? t("settings.sections.teaching.saving") : t("settings.save")}</Button></div>
    </div>
  )
}
