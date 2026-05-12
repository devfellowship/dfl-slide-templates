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
