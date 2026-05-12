import { useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useThemes } from '@/hooks/useThemes'
import { useThemeEditorStore } from '@/stores/themeEditorStore'
import { ThemeVarsForm } from '@/components/theme/ThemeVarsForm'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { useTemplates } from '@/hooks/useTemplates'
import { renderTemplate } from '@/lib/renderTemplate'
import { generateSampleData } from '@/lib/sampleData'
import { ArrowLeft, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'

const LANDSCAPE_W = 960
const LANDSCAPE_H = 540
const PORTRAIT_W = 540
const PORTRAIT_H = 960
const PREVIEW_SCALE = 0.3

function PreviewFrame({
  srcdoc,
  width,
  height,
  label,
}: {
  srcdoc: string
  width: number
  height: number
  label: string
}) {
  const scaledW = Math.round(width * PREVIEW_SCALE)
  const scaledH = Math.round(height * PREVIEW_SCALE)

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">
        {label} ({width}×{height})
      </span>
      <div
        className="relative overflow-hidden rounded border border-border bg-white"
        style={{ width: `${scaledW}px`, height: `${scaledH}px` }}
      >
        <iframe
          srcDoc={srcdoc}
          title={label}
          sandbox="allow-same-origin"
          className="pointer-events-none absolute left-0 top-0 origin-top-left"
          style={{
            width: `${width}px`,
            height: `${height}px`,
            transform: `scale(${PREVIEW_SCALE})`,
          }}
        />
      </div>
    </div>
  )
}

function ThemePreviewPanel() {
  const { catalog } = useTemplates()
  const rawCss = useThemeEditorStore((s) => s.rawCss)
  const selectedPreviewTemplate = useThemeEditorStore((s) => s.selectedPreviewTemplate)
  const setPreviewTemplate = useThemeEditorStore((s) => s.setPreviewTemplate)

  // Default to first template
  useEffect(() => {
    if (!selectedPreviewTemplate && catalog) {
      const first = catalog.registry.templates[0]
      if (first) setPreviewTemplate(first.id)
    }
  }, [catalog, selectedPreviewTemplate, setPreviewTemplate])

  const assets = catalog?.templates.get(selectedPreviewTemplate)

  const sampleData = useMemo(
    () => (assets ? generateSampleData(assets.config.slots) : {}),
    [assets],
  )

  const landscapeSrcdoc = useMemo(
    () =>
      assets
        ? renderTemplate(assets.landscapeHtml, assets.landscapeCss, rawCss, sampleData, 'tp-ls')
        : '',
    [assets, rawCss, sampleData],
  )

  const portraitSrcdoc = useMemo(
    () =>
      assets
        ? renderTemplate(assets.portraitHtml, assets.portraitCss, rawCss, sampleData, 'tp-pt')
        : '',
    [assets, rawCss, sampleData],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Preview</span>
        <div className="flex-1" />
        <select
          value={selectedPreviewTemplate}
          onChange={(e) => setPreviewTemplate(e.target.value)}
          className="rounded border border-input bg-background px-2 py-1 text-xs"
        >
          {catalog?.registry.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {catalog.templates.get(t.id)?.config.name ?? t.id}
            </option>
          ))}
        </select>
      </div>

      {assets ? (
        <div className="flex flex-1 items-start gap-4 overflow-auto p-4">
          <div>
            <PreviewFrame
              srcdoc={landscapeSrcdoc}
              width={LANDSCAPE_W}
              height={LANDSCAPE_H}
              label="Landscape"
            />
          </div>
          <div>
            <PreviewFrame
              srcdoc={portraitSrcdoc}
              width={PORTRAIT_W}
              height={PORTRAIT_H}
              label="Portrait"
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            {catalog ? 'Select a template to preview' : 'Loading templates…'}
          </p>
        </div>
      )}
    </div>
  )
}

export function ThemeEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { themes } = useThemes()

  const label = useThemeEditorStore((s) => s.label)
  const rawCss = useThemeEditorStore((s) => s.rawCss)
  const showRawEditor = useThemeEditorStore((s) => s.showRawEditor)
  const isDirty = useThemeEditorStore((s) => s.isDirty)
  const lastSavedAt = useThemeEditorStore((s) => s.lastSavedAt)

  const loadTheme = useThemeEditorStore((s) => s.loadTheme)
  const createNewTheme = useThemeEditorStore((s) => s.createNewTheme)
  const loadDraft = useThemeEditorStore((s) => s.loadDraft)
  const saveDraft = useThemeEditorStore((s) => s.saveDraft)
  const toggleRawEditor = useThemeEditorStore((s) => s.toggleRawEditor)
  const setRawCss = useThemeEditorStore((s) => s.setRawCss)

  const initializedRef = useRef(false)

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    if (id === 'new') {
      if (!loadDraft('new')) createNewTheme()
      return
    }

    if (id && loadDraft(id)) return

    const found = themes.find((t) => t.id === id)
    if (found) {
      loadTheme(found.id, found.label, found.vars, found.rawCss)
    }
  }, [id, themes, loadTheme, createNewTheme, loadDraft])

  // Re-initialize when themes load (they may not be ready on first render)
  useEffect(() => {
    if (!initializedRef.current || id === 'new' || !id || !themes.length) return
    const found = themes.find((t) => t.id === id)
    if (found && !loadDraft(id)) {
      loadTheme(found.id, found.label, found.vars, found.rawCss)
    }
  }, [themes, id, loadTheme, loadDraft])

  const handleRawCssChange = useCallback(
    (value: string) => setRawCss(value),
    [setRawCss],
  )

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-10 items-center gap-3 border-b border-border px-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/themes')}
          className="h-7 gap-1 px-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <span className="text-sm font-medium">{label}</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={toggleRawEditor} className="h-7 px-2 text-xs">
          {showRawEditor ? 'Variables' : 'Raw CSS'}
        </Button>
        <Button variant="ghost" size="sm" onClick={saveDraft} className="h-7 gap-1 px-2">
          <Save className="h-3.5 w-3.5" />
          Save
        </Button>
        <span className="text-xs text-muted-foreground">
          {isDirty
            ? 'Unsaved changes'
            : lastSavedAt
              ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
              : ''}
        </span>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: vars form or raw CSS editor */}
        <div className="flex w-1/2 flex-col border-r border-border overflow-hidden">
          {showRawEditor ? (
            <CodeEditor value={rawCss} language="css" onChange={handleRawCssChange} />
          ) : (
            <ThemeVarsForm />
          )}
        </div>

        {/* Right: live preview */}
        <div className="flex w-1/2 flex-col">
          <ThemePreviewPanel />
        </div>
      </div>
    </div>
  )
}
