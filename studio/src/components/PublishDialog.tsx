import { useState, useCallback } from 'react'
import yaml from 'js-yaml'
import { useEditorStore } from '@/stores/editorStore'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { X, ExternalLink, Loader2, FileCode, AlertCircle } from 'lucide-react'

interface PublishResult {
  prUrl: string
  prNumber: number
  branch: string
}

export function PublishDialog({ onClose }: { onClose: () => void }) {
  const config = useEditorStore((s) => s.config)
  const landscapeHtml = useEditorStore((s) => s.landscapeHtml)
  const landscapeCss = useEditorStore((s) => s.landscapeCss)
  const portraitHtml = useEditorStore((s) => s.portraitHtml)
  const portraitCss = useEditorStore((s) => s.portraitCss)
  const isNew = useEditorStore((s) => s.isNew)

  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<
    'idle' | 'publishing' | 'success' | 'error'
  >('idle')
  const [result, setResult] = useState<PublishResult | null>(null)
  const [error, setError] = useState('')

  const basePath = `templates/${config.id}`
  const files = [
    { path: `${basePath}/config.yaml`, label: 'config.yaml' },
    { path: `${basePath}/landscape.html`, label: 'landscape.html' },
    { path: `${basePath}/landscape.css`, label: 'landscape.css' },
    { path: `${basePath}/portrait.html`, label: 'portrait.html' },
    { path: `${basePath}/portrait.css`, label: 'portrait.css' },
  ]

  const handlePublish = useCallback(async () => {
    setStatus('publishing')
    setError('')

    try {
      const configYaml = yaml.dump(config, {
        lineWidth: -1,
        quotingType: '"',
        forceQuotes: false,
      })

      const payload = {
        type: 'template' as const,
        id: config.id,
        description,
        files: [
          { path: `${basePath}/config.yaml`, content: configYaml },
          { path: `${basePath}/landscape.html`, content: landscapeHtml },
          { path: `${basePath}/landscape.css`, content: landscapeCss },
          { path: `${basePath}/portrait.html`, content: portraitHtml },
          { path: `${basePath}/portrait.css`, content: portraitCss },
        ],
        ...(isNew && {
          registryEntry: {
            id: config.id,
            version: config.version,
            category: config.category,
          },
        }),
      }

      const { data, error: fnError } = await supabase.functions.invoke(
        'publish-template',
        { body: payload },
      )

      if (fnError) throw new Error(fnError.message)
      if (data?.error) throw new Error(data.error)

      setResult(data as PublishResult)
      setStatus('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed')
      setStatus('error')
    }
  }, [
    config,
    description,
    basePath,
    landscapeHtml,
    landscapeCss,
    portraitHtml,
    portraitCss,
    isNew,
  ])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-lg border border-border bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Publish Template</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-3">
          {status === 'success' && result ? (
            <div className="space-y-3">
              <p className="text-sm text-green-400">
                PR created successfully!
              </p>
              <a
                href={result.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View PR #{result.prNumber}
              </a>
              <p className="text-xs text-muted-foreground">
                Branch: <code>{result.branch}</code>
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Template info */}
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  {isNew ? 'New template' : 'Updating template'}:{' '}
                  <strong>{config.name}</strong> ({config.id})
                </p>
              </div>

              {/* File list */}
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Files to {isNew ? 'create' : 'update'}
                </p>
                <ul className="space-y-1 rounded border border-border bg-card p-2">
                  {files.map((f) => (
                    <li
                      key={f.path}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <FileCode className="h-3 w-3 text-muted-foreground" />
                      <code>{f.path}</code>
                    </li>
                  ))}
                  {isNew && (
                    <li className="flex items-center gap-1.5 text-xs">
                      <FileCode className="h-3 w-3 text-muted-foreground" />
                      <code>registry.json</code>
                      <span className="text-muted-foreground">(updated)</span>
                    </li>
                  )}
                </ul>
              </div>

              {/* Description */}
              <div>
                <label
                  htmlFor="publish-desc"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  Description
                </label>
                <textarea
                  id="publish-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={
                    isNew
                      ? `Add ${config.name} template`
                      : `Update ${config.name} template`
                  }
                  rows={2}
                  className="w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  disabled={status === 'publishing'}
                />
              </div>

              {/* Error */}
              {status === 'error' && (
                <div className="flex items-start gap-1.5 rounded border border-destructive/50 bg-destructive/10 px-2 py-1.5">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 text-destructive" />
                  <p className="text-xs text-destructive">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          {status === 'success' ? (
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={status === 'publishing'}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handlePublish}
                disabled={
                  status === 'publishing' || !description.trim()
                }
              >
                {status === 'publishing' ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Publishing...
                  </>
                ) : (
                  'Publish'
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
