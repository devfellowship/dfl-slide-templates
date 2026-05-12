import { useMemo, useCallback, useRef, useState, useEffect } from 'react'
import { renderTemplate } from '@/lib/renderTemplate'
import { generateSampleData } from '@/lib/sampleData'
import { useEditorStore } from '@/stores/editorStore'
import { Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

const LANDSCAPE_W = 960
const LANDSCAPE_H = 540
const PORTRAIT_W = 540
const PORTRAIT_H = 960

function PreviewFrame({
  srcdoc,
  width,
  height,
  label,
  scale,
}: {
  srcdoc: string
  width: number
  height: number
  label: string
  scale: number
}) {
  const scaledW = Math.round(width * scale)
  const scaledH = Math.round(height * scale)

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label} ({width}x{height})</span>
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
            transform: `scale(${scale})`,
          }}
        />
      </div>
    </div>
  )
}

export function TemplatePreview() {
  const landscapeHtml = useEditorStore((s) => s.landscapeHtml)
  const landscapeCss = useEditorStore((s) => s.landscapeCss)
  const portraitHtml = useEditorStore((s) => s.portraitHtml)
  const portraitCss = useEditorStore((s) => s.portraitCss)
  const themeCss = useEditorStore((s) => s.themeCss)
  const config = useEditorStore((s) => s.config)
  const sampleOverrides = useEditorStore((s) => s.sampleOverrides)
  const toggleFullscreen = useEditorStore((s) => s.toggleFullscreen)

  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.3)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const compute = () => {
      const availW = el.clientWidth - 32 // 16px padding each side
      const availH = el.clientHeight - 32
      if (availW <= 0 || availH <= 0) return

      // Two frames side by side with a gap; compute per-frame slot width
      const GAP = 16
      const perFrameW = (availW - GAP) / 2

      // Scale so each frame fits its slot without overflow
      const scaleByLandscapeW = perFrameW / LANDSCAPE_W
      const scaleByPortraitW = perFrameW / PORTRAIT_W
      // Both frames must fit the available height
      const scaleByLandscapeH = availH / LANDSCAPE_H
      const scaleByPortraitH = availH / PORTRAIT_H

      // Choose the scale that satisfies all constraints, capped at 0.7
      const best = Math.min(
        scaleByLandscapeW,
        scaleByPortraitW,
        scaleByLandscapeH,
        scaleByPortraitH,
        0.7,
      )
      setScale(Math.max(best, 0.1))
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const sampleData = useMemo(
    () => ({ ...generateSampleData(config.slots), ...sampleOverrides }),
    [config.slots, sampleOverrides],
  )

  const landscapeSrcdoc = useMemo(
    () => renderTemplate(landscapeHtml, landscapeCss, themeCss, sampleData, 'preview-landscape'),
    [landscapeHtml, landscapeCss, themeCss, sampleData],
  )

  const portraitSrcdoc = useMemo(
    () => renderTemplate(portraitHtml, portraitCss, themeCss, sampleData, 'preview-portrait'),
    [portraitHtml, portraitCss, themeCss, sampleData],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Preview</span>
        <Button variant="ghost" size="sm" onClick={toggleFullscreen} className="h-6 w-6 p-0">
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div ref={containerRef} className="flex flex-1 items-start gap-4 overflow-auto p-4">
        <div>
          <PreviewFrame
            srcdoc={landscapeSrcdoc}
            width={LANDSCAPE_W}
            height={LANDSCAPE_H}
            label="Landscape"
            scale={scale}
          />
        </div>
        <div>
          <PreviewFrame
            srcdoc={portraitSrcdoc}
            width={PORTRAIT_W}
            height={PORTRAIT_H}
            label="Portrait"
            scale={scale}
          />
        </div>
      </div>
    </div>
  )
}

export function FullscreenPreview({ onClose }: { onClose: () => void }) {
  const landscapeHtml = useEditorStore((s) => s.landscapeHtml)
  const landscapeCss = useEditorStore((s) => s.landscapeCss)
  const portraitHtml = useEditorStore((s) => s.portraitHtml)
  const portraitCss = useEditorStore((s) => s.portraitCss)
  const themeCss = useEditorStore((s) => s.themeCss)
  const config = useEditorStore((s) => s.config)

  const sampleData = useMemo(
    () => generateSampleData(config.slots),
    [config.slots],
  )

  const landscapeSrcdoc = useMemo(
    () => renderTemplate(landscapeHtml, landscapeCss, themeCss, sampleData, 'fs-landscape'),
    [landscapeHtml, landscapeCss, themeCss, sampleData],
  )

  const portraitSrcdoc = useMemo(
    () => renderTemplate(portraitHtml, portraitCss, themeCss, sampleData, 'fs-portrait'),
    [portraitHtml, portraitCss, themeCss, sampleData],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center gap-8 bg-black/90 p-8"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 text-white hover:text-gray-300"
      >
        ESC to close
      </button>
      <div
        className="overflow-hidden rounded bg-white shadow-2xl"
        style={{ width: '576px', height: '324px' }}
      >
        <iframe
          srcDoc={landscapeSrcdoc}
          title="Landscape Fullscreen"
          sandbox="allow-same-origin"
          className="origin-top-left"
          style={{
            width: `${LANDSCAPE_W}px`,
            height: `${LANDSCAPE_H}px`,
            transform: `scale(${576 / LANDSCAPE_W})`,
          }}
        />
      </div>
      <div
        className="overflow-hidden rounded bg-white shadow-2xl"
        style={{ width: '270px', height: '480px' }}
      >
        <iframe
          srcDoc={portraitSrcdoc}
          title="Portrait Fullscreen"
          sandbox="allow-same-origin"
          className="origin-top-left"
          style={{
            width: `${PORTRAIT_W}px`,
            height: `${PORTRAIT_H}px`,
            transform: `scale(${270 / PORTRAIT_W})`,
          }}
        />
      </div>
    </div>
  )
}
