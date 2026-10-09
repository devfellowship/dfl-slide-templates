export interface RegistryEntry {
  id: string
  version: string
  category: 'content' | 'layout' | 'data'
}

export interface TemplateRegistry {
  templates: RegistryEntry[]
}

export interface TemplateSlot {
  name: string
  type: string
  required: boolean
  description: string
  sample?: string | string[] | Record<string, unknown>
  /** items slots: a new slide starts with this many blank items. */
  minItems?: number
  /** items slots: the entry field that holds an image url. */
  mediaField?: string
  /** text slots: the slot holds an image or a video url. */
  media?: "image" | "video"
}

export interface TemplateConfig {
  id: string
  name: string
  version: string
  category: string
  slots: TemplateSlot[]
}

export interface TemplateAssets {
  config: TemplateConfig
  landscapeHtml: string
  landscapeCss: string
  portraitHtml: string
  portraitCss: string
}

export interface TemplateCatalog {
  registry: TemplateRegistry
  templates: Map<string, TemplateAssets>
}
