import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTemplates } from '@/hooks/useTemplates'
import { useEditorStore, AUTOSAVE_INTERVAL } from '@/stores/editorStore'
import type { CodeTab } from '@/stores/editorStore'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { TemplatePreview, FullscreenPreview } from '@/components/editor/TemplatePreview'
import { SlotSchemaEditor } from '@/components/editor/SlotSchemaEditor'
import { ThemeSelector } from '@/components/editor/ThemeSelector'
import { ArrowLeft, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'

const TABS: { key: CodeTab; label: string; lang: 'html' | 'css' }[] = [
  { key: 'landscape.html', label: 'landscape.html', lang: 'html' },
  { key: 'portrait.html', label: 'portrait.html', lang: 'html' },
  { key: 'landscape.css', label: 'landscape.css', lang: 'css' },
  { key: 'portrait.css', label: 'portrait.css', lang: 'css' },
]

export function TemplateEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { catalog, loading: catalogLoading } = useTemplates()

  const activeTab = useEditorStore((s) => s.activeTab)
  const setActiveTab = useEditorStore((s) => s.setActiveTab)
  const setCode = useEditorStore((s) => s.setCode)
  const loadTemplate = useEditorStore((s) => s.loadTemplate)
  const createNewTemplate = useEditorStore((s) => s.createNewTemplate)
  const loadDraft = useEditorStore((s) => s.loadDraft)
  const saveDraft = useEditorStore((s) => s.saveDraft)
  const isDirty = useEditorStore((s) => s.isDirty)
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt)
  const config = useEditorStore((s) => s.config)
  const fullscreenPreview = useEditorStore((s) => s.fullscreenPreview)
  const toggleFullscreen = useEditorStore((s) => s.toggleFullscreen)

  const [bottomPanelOpen, setBottomPanelOpen] = useState(true)
  const initializedRef = useRef(false)

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    if (id === 'new') {
      if (!loadDraft('new')) {
        createNewTemplate()
      }
      return
    }

    if (id && loadDraft(id)) return

    if (id && catalog) {
      const assets = catalog.templates.get(id)
      if (assets) {
        loadTemplate(id, assets)
      }
    }
  }, [id, catalog, loadTemplate, createNewTemplate, loadDraft])

  useEffect(() => {
    const timer = setInterval(() => {
      if (useEditorStore.getState().isDirty) {
        saveDraft()
      }
    }, AUTOSAVE_INTERVAL)
    return () => clearInterval(timer)
  }, [saveDraft])

  const currentTab = useMemo(
    () => TABS.find((t) => t.key === activeTab)!,
    [activeTab],
  )

  const codeValue = useEditorStore((s) => {
    switch (s.activeTab) {
      case 'landscape.html': return s.landscapeHtml
      case 'portrait.html': return s.portraitHtml
      case 'landscape.css': return s.landscapeCss
      case 'portrait.css': return s.portraitCss
    }
  })

  const handleCodeChange = useCallback(
    (value: string) => setCode(activeTab, value),
    [activeTab, setCode],
  )

  if (catalogLoading && id !== 'new') {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading template...</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-10 items-center gap-3 border-b border-border px-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/templates')} className="h-7 gap-1 px-2">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <span className="text-sm font-medium">{config.name || 'Untitled'}</span>
        <div className="flex-1" />
        <ThemeSelector />
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
        {/* Left: code editor */}
        <div className="flex w-1/2 flex-col border-r border-border">
          {/* Code tabs */}
          <div className="flex border-b border-border">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-1.5 text-xs transition-colors ${
                  activeTab === tab.key
                    ? 'border-b-2 border-primary bg-card text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            <CodeEditor
              key={currentTab.key}
              value={codeValue}
              language={currentTab.lang}
              onChange={handleCodeChange}
            />
          </div>
        </div>

        {/* Right: preview */}
        <div className="flex w-1/2 flex-col">
          <TemplatePreview />
        </div>
      </div>

      {/* Bottom: slot schema editor */}
      <div
        className={`border-t border-border transition-all ${
          bottomPanelOpen ? 'h-56' : 'h-8'
        }`}
      >
        <button
          onClick={() => setBottomPanelOpen(!bottomPanelOpen)}
          className="flex h-8 w-full items-center justify-center text-xs text-muted-foreground hover:bg-card"
        >
          {bottomPanelOpen ? 'Hide' : 'Show'} Config & Slots
        </button>
        {bottomPanelOpen && (
          <div className="h-[calc(100%-2rem)] overflow-hidden">
            <SlotSchemaEditor />
          </div>
        )}
      </div>

      {/* Fullscreen overlay */}
      {fullscreenPreview && <FullscreenPreview onClose={toggleFullscreen} />}
    </div>
  )
}
