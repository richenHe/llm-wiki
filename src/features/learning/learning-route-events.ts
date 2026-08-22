export const LEARNING_ROUTES_UPDATED_EVENT = "llm-wiki:learning-routes-updated"
export const LEARNING_ROUTES_COMPLETED_EVENT = "llm-wiki:learning-routes-completed"

export interface LearningRoutesCompletedDetail {
  projectPath: string
  processed: number
  total: number
  boardCount: number
  linkedCount: number
  unlinkedCount: number
}
