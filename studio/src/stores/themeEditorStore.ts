import { create } from 'zustand'
import type { ThemeVars } from '@/types/theme'
import { parseThemeVars, buildThemeCss } from '@/hooks/useThemes'

const DRAFT_KEY_PREFIX = 'dfl-theme-draft-'

const DEFAULT_VARS: ThemeVars = {
  primary: '#3b82f6',
  bg: '#ffffff',
  text: '#1f2937',
  headingColor: '#111827',
  border: '#e5e7eb',
  borderOpacity: 1,
  fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  fontFamilyHeading: "'Segoe UI', system-ui, -apple-system, sans-serif",
}

interface ThemeEditorState {
  themeId: string
  isNew: boolean
  label: string
  vars: ThemeVars
  rawCss: string
  showRawEditor: boolean
  isDirty: boolean
  lastSavedAt: number | null
  selectedPreviewTemplate: string
}

interface ThemeEditorActions {
  loadTheme: (id: string, label: string, vars: ThemeVars, rawCss: string) => void
  createNewTheme: () => void
  updateVar: (key: keyof ThemeVars, value: string | number) => void
  setRawCss: (css: string) => void
  toggleRawEditor: () => void
  setPreviewTemplate: (id: string) => void
  saveDraft: () => void
  loadDraft: (id: string) => boolean
}

export const useThemeEditorStore = create<ThemeEditorState & ThemeEditorActions>((set, get) => ({
  themeId: 'new',
  isNew: true,
  label: 'New Theme',
  vars: { ...DEFAULT_VARS },
  rawCss: buildThemeCss(DEFAULT_VARS),
  showRawEditor: false,
  isDirty: false,
  lastSavedAt: null,
  selectedPreviewTemplate: '',

  loadTheme: (id, label, vars, rawCss) =>
    set({ themeId: id, isNew: false, label, vars, rawCss, isDirty: false, lastSavedAt: null }),

  createNewTheme: () => {
    const vars = { ...DEFAULT_VARS }
    set({
      themeId: `theme-${Date.now()}`,
      isNew: true,
      label: 'New Theme',
      vars,
      rawCss: buildThemeCss(vars),
      isDirty: false,
      lastSavedAt: null,
    })
  },

  updateVar: (key, value) =>
    set((state) => {
      const vars = { ...state.vars, [key]: value }
      return { vars, rawCss: buildThemeCss(vars), isDirty: true }
    }),

  setRawCss: (css) => {
    const vars = parseThemeVars(css)
    set({ rawCss: css, vars, isDirty: true })
  },

  toggleRawEditor: () => set((s) => ({ showRawEditor: !s.showRawEditor })),

  setPreviewTemplate: (id) => set({ selectedPreviewTemplate: id }),

  saveDraft: () => {
    const state = get()
    try {
      localStorage.setItem(
        `${DRAFT_KEY_PREFIX}${state.themeId}`,
        JSON.stringify({
          themeId: state.themeId,
          isNew: state.isNew,
          label: state.label,
          vars: state.vars,
          rawCss: state.rawCss,
        }),
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
      const d = JSON.parse(raw)
      set({
        themeId: d.themeId,
        isNew: d.isNew,
        label: d.label,
        vars: d.vars,
        rawCss: d.rawCss,
        isDirty: false,
        lastSavedAt: Date.now(),
      })
      return true
    } catch {
      return false
    }
  },
}))
