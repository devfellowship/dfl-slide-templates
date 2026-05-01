import { useState, useEffect, useCallback, useRef } from 'react'
import yaml from 'js-yaml'
import type {
  TemplateRegistry,
  TemplateConfig,
  TemplateAssets,
  TemplateCatalog,
} from '@/types/template'

const BASE_URL =
  'https://raw.githubusercontent.com/devfellowship/dfl-slide-templates/main'

const SESSION_CACHE_MS = 5 * 60 * 1000
const CACHE_STORAGE_KEY = 'dfl-template-studio-cache'
const CACHE_TS_KEY = 'dfl-template-studio-ts'

let inMemoryCache: TemplateCatalog | null = null
let inMemoryCacheTs = 0

function getLocalStorageCache(): TemplateCatalog | null {
  try {
    const ts = Number(localStorage.getItem(CACHE_TS_KEY) || '0')
    if (Date.now() - ts > SESSION_CACHE_MS) return null
    const raw = localStorage.getItem(CACHE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return {
      registry: parsed.registry,
      templates: new Map(Object.entries(parsed.templates)),
    }
  } catch {
    return null
  }
}

function setLocalStorageCache(catalog: TemplateCatalog) {
  try {
    const serializable = {
      registry: catalog.registry,
      templates: Object.fromEntries(catalog.templates),
    }
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(serializable))
    localStorage.setItem(CACHE_TS_KEY, String(Date.now()))
  } catch {
    // localStorage full or unavailable
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return res.text()
}

async function fetchRegistry(): Promise<TemplateRegistry> {
  const res = await fetch(`${BASE_URL}/registry.json`)
  if (!res.ok) throw new Error(`registry.json fetch failed: ${res.status}`)
  return res.json()
}

async function fetchTemplateAssets(templateId: string): Promise<TemplateAssets> {
  const base = `${BASE_URL}/templates/${templateId}`
  const [configYaml, landscapeHtml, landscapeCss, portraitHtml, portraitCss] =
    await Promise.all([
      fetchText(`${base}/config.yaml`),
      fetchText(`${base}/landscape.html`),
      fetchText(`${base}/landscape.css`),
      fetchText(`${base}/portrait.html`),
      fetchText(`${base}/portrait.css`),
    ])

  const config = yaml.load(configYaml) as TemplateConfig
  return { config, landscapeHtml, landscapeCss, portraitHtml, portraitCss }
}

export function useTemplates() {
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(inMemoryCache)
  const [loading, setLoading] = useState(!inMemoryCache)
  const [error, setError] = useState<Error | null>(null)
  const fetchedRef = useRef(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const registry = await fetchRegistry()
      const entries = await Promise.all(
        registry.templates.map((entry) => fetchTemplateAssets(entry.id))
      )

      const templates = new Map<string, TemplateAssets>()
      entries.forEach((assets) => templates.set(assets.config.id, assets))

      const newCatalog: TemplateCatalog = { registry, templates }
      inMemoryCache = newCatalog
      inMemoryCacheTs = Date.now()
      setLocalStorageCache(newCatalog)
      setCatalog(newCatalog)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    if (inMemoryCache && Date.now() - inMemoryCacheTs < SESSION_CACHE_MS) {
      setCatalog(inMemoryCache)
      setLoading(false)
      return
    }

    const cached = getLocalStorageCache()
    if (cached) {
      inMemoryCache = cached
      inMemoryCacheTs = Date.now()
      setCatalog(cached)
      setLoading(false)
      return
    }

    refresh()
  }, [refresh])

  return { catalog, loading, error, refresh }
}
