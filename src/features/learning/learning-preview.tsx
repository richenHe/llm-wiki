import { IconSidebar } from "@/components/layout/icon-sidebar"
import { LearningView } from "./learning-view"

export function LearningPreview() {
  return (
    <div className="flex h-full bg-background text-foreground">
      <IconSidebar onSwitchProject={() => {}} />
      <div className="min-w-0 flex-1"><LearningView /></div>
    </div>
  )
}
