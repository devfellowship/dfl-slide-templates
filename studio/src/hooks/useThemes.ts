import { useState, useEffect, useRef } from 'react'
import type { ThemeEntry, ThemeVars } from '@/types/theme'

export const KNOWN_THEMES = [
  { id: 'default', label: 'Default' },
  { id: 'devfellowship', label: 'DevFellowship' },
]

const BASE_URL =
  'https://raw.githubusercontent.com/devfellowship/dfl-slide-templates/main'

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!m) return null
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function parseBorderValue(value: string): { hex: string; opacity: number } {
  const t = value.trim()
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(t)
  if (m) {
    return {
      hex: rgbToHex(parseInt(m[1]), parseInt(m[2]), parseInt(m[3])),
      opacity: m[4] !== undefined ? parseFloat(m[4]) : 1,
    }
  }
  if (t.startsWith('#')) return { hex: t, opacity: 1 }
  return { hex: '#e5e7eb', opacity: 1 }
}

export function parseThemeVars(css: string): ThemeVars {
  function getVar(name: string): string {
    const m = new RegExp(`--slide-${name}\\s*:\\s*([^;]+);`).exec(css)
    return m ? m[1].trim() : ''
  }

  const primary = getVar('primary') || '#3b82f6'
  const bg = getVar('bg') || '#ffffff'
  const text = getVar('text') || '#1f2937'
  const headingRaw = getVar('heading-color') || text
  const borderRaw = getVar('border') || '#e5e7eb'
  const fontFamily = getVar('font-family') || "system-ui, -apple-system, sans-serif"
  const fontFamilyHeadingRaw = getVar('font-family-heading') || fontFamily

  const { hex: border, opacity: borderOpacity } = parseBorderValue(borderRaw)
  const fontFamilyHeading = fontFamilyHeadingRaw.startsWith('var(') ? fontFamily : fontFamilyHeadingRaw

  return {
    primary: primary.startsWith('#') ? primary : '#3b82f6',
    bg: bg.startsWith('#') ? bg : '#ffffff',
    text: text.startsWith('#') ? text : '#1f2937',
    headingColor: headingRaw.startsWith('#') ? headingRaw : '#111827',
    border,
    borderOpacity,
    fontFamily,
    fontFamilyHeading,
  }
}

export function buildThemeCss(vars: ThemeVars): string {
  const rgb = hexToRgb(vars.border)
  const borderVal = rgb
    ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${vars.borderOpacity})`
    : vars.border

  return `.tpl-root {
  --slide-primary: ${vars.primary};
  --slide-bg: ${vars.bg};
  --slide-text: ${vars.text};
  --slide-heading-color: ${vars.headingColor};
  --slide-border: ${borderVal};
  --slide-font-family: ${vars.fontFamily};
  --slide-font-family-heading: ${vars.fontFamilyHeading};
}`
}

const themeCache = new Map<string, ThemeEntry>()

async function fetchThemeEntry(id: string, label: string): Promise<ThemeEntry> {
  if (themeCache.has(id)) return themeCache.get(id)!
  const res = await fetch(`${BASE_URL}/themes/${id}.css`)
  const rawCss = res.ok ? await res.text() : ''
  const vars = parseThemeVars(rawCss)
  const entry: ThemeEntry = { id, label, vars, rawCss }
  themeCache.set(id, entry)
  return entry
}

export function useThemes() {
  const [themes, setThemes] = useState<ThemeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    Promise.all(KNOWN_THEMES.map((t) => fetchThemeEntry(t.id, t.label)))
      .then((entries) => {
        setThemes(entries)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)))
        setLoading(false)
      })
  }, [])

  return { themes, loading, error }
}
