import { useEffect, useRef, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useThemes } from '@/hooks/useThemes'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Plus } from 'lucide-react'
import type { ThemeVars, ThemeEntry } from '@/types/theme'

function buildPreviewSrcdoc(vars: ThemeVars): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:960px;height:540px;overflow:hidden;}
.tpl-root{
  width:100%;height:100%;display:flex;flex-direction:column;
  align-items:flex-start;justify-content:center;padding:80px;
  background:${vars.bg};font-family:${vars.fontFamily};color:${vars.text};
}
.bar{width:56px;height:6px;background:${vars.primary};border-radius:3px;margin-bottom:24px;}
h1{font-size:52px;font-weight:700;font-family:${vars.fontFamilyHeading};
  color:${vars.headingColor};line-height:1.15;margin-bottom:14px;}
p{font-size:22px;color:${vars.text};opacity:0.65;}
</style></head><body>
<div class="tpl-root">
  <div class="bar"></div>
  <h1>DevFellowship</h1>
  <p>Template Studio · Theme Preview</p>
</div>
</body></html>`
}

function ScaledPreview({ vars }: { vars: ThemeVars }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.3)
  const srcdoc = useMemo(() => buildPreviewSrcdoc(vars), [vars])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / 960)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden bg-muted"
      style={{ paddingBottom: '56.25%' }}
    >
      <iframe
        srcDoc={srcdoc}
        title="theme preview"
        sandbox="allow-same-origin"
        className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
        style={{ width: '960px', height: '540px', transform: `scale(${scale})` }}
      />
    </div>
  )
}

function ColorSwatch({ color, title }: { color: string; title: string }) {
  return (
    <div
      className="h-5 w-5 rounded-full border border-border shadow-sm"
      style={{ background: color }}
      title={title}
    />
  )
}

function ThemeCard({ entry }: { entry: ThemeEntry }) {
  const navigate = useNavigate()
  return (
    <Card
      className="cursor-pointer overflow-hidden transition-shadow hover:shadow-lg"
      onClick={() => navigate(`/themes/${entry.id}`)}
    >
      <ScaledPreview vars={entry.vars} />
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{entry.label}</span>
          <div className="flex items-center gap-1.5">
            <ColorSwatch color={entry.vars.primary} title="primary" />
            <ColorSwatch color={entry.vars.bg} title="bg" />
            <ColorSwatch color={entry.vars.text} title="text" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function ThemesPage() {
  const { themes, loading, error } = useThemes()
  const navigate = useNavigate()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading themes…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-destructive">Error: {error.message}</p>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold">Themes</h2>
        <Button onClick={() => navigate('/themes/new')}>
          <Plus className="mr-2 h-4 w-4" />
          New Theme
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {themes.map((entry) => (
          <ThemeCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}
