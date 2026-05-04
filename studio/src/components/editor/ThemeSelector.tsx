import { useEffect } from 'react'
import { useEditorStore } from '@/stores/editorStore'

const BASE_URL =
  'https://raw.githubusercontent.com/devfellowship/dfl-slide-templates/main'

const THEMES = [
  { name: 'default', label: 'Default' },
  { name: 'devfellowship', label: 'DevFellowship' },
]

export function ThemeSelector() {
  const selectedTheme = useEditorStore((s) => s.selectedTheme)
  const setTheme = useEditorStore((s) => s.setTheme)

  useEffect(() => {
    loadThemeCss(selectedTheme).then((css) => setTheme(selectedTheme, css))
  }, [selectedTheme, setTheme])

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const name = e.target.value
    const css = await loadThemeCss(name)
    setTheme(name, css)
  }

  return (
    <select
      value={selectedTheme}
      onChange={handleChange}
      className="rounded border border-input bg-background px-2 py-1 text-xs"
    >
      {THEMES.map((t) => (
        <option key={t.name} value={t.name}>
          {t.label}
        </option>
      ))}
    </select>
  )
}

const themeCache = new Map<string, string>()

async function loadThemeCss(name: string): Promise<string> {
  const cached = themeCache.get(name)
  if (cached !== undefined) return cached

  try {
    const res = await fetch(`${BASE_URL}/themes/${name}.css`)
    if (!res.ok) return ''
    const css = await res.text()
    themeCache.set(name, css)
    return css
  } catch {
    return ''
  }
}
