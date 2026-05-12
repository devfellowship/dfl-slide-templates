import { create } from 'zustand'
import type { TemplateConfig, TemplateSlot, TemplateAssets } from '@/types/template'

export type CodeTab =
  | 'landscape.html'
  | 'portrait.html'
  | 'landscape.css'
  | 'portrait.css'

const DRAFT_KEY_PREFIX = 'dfl-template-draft-'
const AUTOSAVE_INTERVAL = 10_000

interface EditorState {
  templateId: string
  isNew: boolean
  config: TemplateConfig
  landscapeHtml: string
  landscapeCss: string
  portraitHtml: string
  portraitCss: string
  activeTab: CodeTab
  selectedTheme: string
  themeCss: string
  isDirty: boolean
  lastSavedAt: number | null
  fullscreenPreview: boolean
  sampleOverrides: Record<string, string>
}

interface EditorActions {
  setCode: (tab: CodeTab, code: string) => void
  setActiveTab: (tab: CodeTab) => void
  setConfig: (config: TemplateConfig) => void
  updateConfigField: (field: keyof TemplateConfig, value: string) => void
  setTheme: (name: string, css: string) => void
  loadTemplate: (id: string, assets: TemplateAssets) => void
  createNewTemplate: () => void
  updateSlot: (index: number, updates: Partial<TemplateSlot>) => void
  addSlot: () => void
  removeSlot: (index: number) => void
  moveSlot: (fromIndex: number, toIndex: number) => void
  saveDraft: () => void
  loadDraft: (id: string) => boolean
  loadDraftOverridesOnly: (id: string) => void
  toggleFullscreen: () => void
  getCodeForTab: (tab: CodeTab) => string
  setSampleOverride: (name: string, value: string) => void
  clearSampleOverrides: () => void
}

const BLANK_CONFIG: TemplateConfig = {
  id: '',
  name: 'Untitled Template',
  version: '1.0.0',
  category: 'content',
  slots: [{ name: 'title', type: 'text', required: true, description: 'Main title' }],
}

const BLANK_HTML = `<div class="tpl-root">
  <h1>{{title}}</h1>
</div>`

export const useEditorStore = create<EditorState & EditorActions>((set, get) => ({
  templateId: 'new',
  isNew: true,
  config: { ...BLANK_CONFIG },
  sampleOverrides: {},
  landscapeHtml: BLANK_HTML,
  landscapeCss: `.tpl-root {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 100%;\n  height: 100%;\n  background: var(--slide-bg, #fff);\n  color: var(--slide-text, #1f2937);\n  font-family: var(--slide-font-family, sans-serif);\n}\n\n.tpl-root h1 {\n  font-size: 3rem;\n  color: var(--slide-heading-color, #111827);\n}`,
  landscapeCss_default: '',
  portraitHtml: BLANK_HTML,
  portraitCss: `.tpl-root {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 100%;\n  height: 100%;\n  background: var(--slide-bg, #fff);\n  color: var(--slide-text, #1f2937);\n  font-family: var(--slide-font-family, sans-serif);\n}\n\n.tpl-root h1 {\n  font-size: 2.5rem;\n  color: var(--slide-heading-color, #111827);\n}`,
  activeTab: 'landscape.html',
  selectedTheme: 'default',
  themeCss: '',
  isDirty: false,
  lastSavedAt: null,
  fullscreenPreview: false,

  setCode: (tab, code) => {
    const field = tabToField(tab)
    set({ [field]: code, isDirty: true })
  },

  setActiveTab: (tab) => set({ activeTab: tab }),

  setConfig: (config) => set({ config, isDirty: true }),

  updateConfigField: (field, value) =>
    set((state) => ({
      config: { ...state.config, [field]: value },
      isDirty: true,
    })),

  setTheme: (name, css) => set({ selectedTheme: name, themeCss: css }),

  loadTemplate: (id, assets) =>
    set({
      templateId: id,
      isNew: false,
      config: assets.config,
      landscapeHtml: assets.landscapeHtml,
      landscapeCss: assets.landscapeCss,
      portraitHtml: assets.portraitHtml,
      portraitCss: assets.portraitCss,
      isDirty: false,
      lastSavedAt: null,
      activeTab: 'landscape.html',
      sampleOverrides: {},
    }),

  createNewTemplate: () => {
    const id = `template-${Date.now()}`
    set({
      templateId: id,
      isNew: true,
      config: { ...BLANK_CONFIG, id },
      landscapeHtml: BLANK_HTML,
      landscapeCss: `.tpl-root {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 100%;\n  height: 100%;\n  background: var(--slide-bg, #fff);\n  color: var(--slide-text, #1f2937);\n  font-family: var(--slide-font-family, sans-serif);\n}\n\n.tpl-root h1 {\n  font-size: 3rem;\n  color: var(--slide-heading-color, #111827);\n}`,
      portraitHtml: BLANK_HTML,
      portraitCss: `.tpl-root {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 100%;\n  height: 100%;\n  background: var(--slide-bg, #fff);\n  color: var(--slide-text, #1f2937);\n  font-family: var(--slide-font-family, sans-serif);\n}\n\n.tpl-root h1 {\n  font-size: 2.5rem;\n  color: var(--slide-heading-color, #111827);\n}`,
      activeTab: 'landscape.html',
      isDirty: false,
      lastSavedAt: null,
      sampleOverrides: {},
    })
  },

  updateSlot: (index, updates) =>
    set((state) => {
      const slots = [...state.config.slots]
      slots[index] = { ...slots[index], ...updates }
      return { config: { ...state.config, slots }, isDirty: true }
    }),

  addSlot: () =>
    set((state) => ({
      config: {
        ...state.config,
        slots: [
          ...state.config.slots,
          { name: 'newSlot', type: 'text', required: false, description: '' },
        ],
      },
      isDirty: true,
    })),

  removeSlot: (index) =>
    set((state) => {
      const slots = state.config.slots.filter((_, i) => i !== index)
      return { config: { ...state.config, slots }, isDirty: true }
    }),

  moveSlot: (fromIndex, toIndex) =>
    set((state) => {
      const slots = [...state.config.slots]
      const [moved] = slots.splice(fromIndex, 1)
      slots.splice(toIndex, 0, moved)
      return { config: { ...state.config, slots }, isDirty: true }
    }),

  saveDraft: () => {
    const state = get()
    const draft = {
      templateId: state.templateId,
      isNew: state.isNew,
      config: state.config,
      landscapeHtml: state.landscapeHtml,
      landscapeCss: state.landscapeCss,
      portraitHtml: state.portraitHtml,
      portraitCss: state.portraitCss,
      sampleOverrides: state.sampleOverrides,
    }
    try {
      localStorage.setItem(
        `${DRAFT_KEY_PREFIX}${state.templateId}`,
        JSON.stringify(draft),
      )
      set({ isDirty: false, lastSavedAt: Date.now() })
    } catch {
      // localStorage full
    }
  },

  loadDraft: (id) => {
    try {
      const raw = localStorage.getItem(`${DRAFT_KEY_PREFIX}${id}`)
      if (!raw) return false
      const draft = JSON.parse(raw)
      set({
        templateId: draft.templateId,
        isNew: draft.isNew,
        config: draft.config,
        landscapeHtml: draft.landscapeHtml,
        landscapeCss: draft.landscapeCss,
        portraitHtml: draft.portraitHtml,
        portraitCss: draft.portraitCss,
        sampleOverrides: draft.sampleOverrides ?? {},
        isDirty: false,
        lastSavedAt: Date.now(),
      })
      return true
    } catch {
      return false
    }
  },

  loadDraftOverridesOnly: (id) => {
    try {
      const raw = localStorage.getItem(`${DRAFT_KEY_PREFIX}${id}`)
      if (!raw) return
      const draft = JSON.parse(raw)
      // Only restore sample overrides — HTML/CSS comes from catalog (always fresh)
      set({ sampleOverrides: draft.sampleOverrides ?? {} })
    } catch {
      // ignore stale/corrupt draft
    }
  },

  toggleFullscreen: () => set((s) => ({ fullscreenPreview: !s.fullscreenPreview })),

  getCodeForTab: (tab) => {
    const state = get()
    return state[tabToField(tab)]
  },

  setSampleOverride: (name, value) =>
    set((state) => ({
      sampleOverrides: { ...state.sampleOverrides, [name]: value },
      isDirty: true,
    })),

  clearSampleOverrides: () => set({ sampleOverrides: {}, isDirty: true }),
}))

type CodeField = 'landscapeHtml' | 'portraitHtml' | 'landscapeCss' | 'portraitCss'

function tabToField(tab: CodeTab): CodeField {
  switch (tab) {
    case 'landscape.html': return 'landscapeHtml'
    case 'portrait.html': return 'portraitHtml'
    case 'landscape.css': return 'landscapeCss'
    case 'portrait.css': return 'portraitCss'
  }
}

export { AUTOSAVE_INTERVAL }
