import { useThemeEditorStore } from '@/stores/themeEditorStore'
import type { ThemeVars } from '@/types/theme'

const SYSTEM_FONTS = [
  { label: 'Segoe UI (Windows)', value: "'Segoe UI', system-ui, -apple-system, sans-serif" },
  { label: 'System UI', value: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif' },
  { label: 'Helvetica Neue', value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: 'Futura PT Cond', value: "'Futura PT Cond', 'Futura', 'Helvetica Neue', sans-serif" },
  { label: 'Georgia (Serif)', value: "Georgia, 'Times New Roman', serif" },
  { label: 'Courier New (Mono)', value: "'Courier New', Courier, monospace" },
  { label: 'Roboto', value: "Roboto, 'Helvetica Neue', Arial, sans-serif" },
]

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5"
      />
      <label className="flex-1 text-sm text-foreground">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded border border-input bg-background px-2 py-1 text-xs font-mono"
        spellCheck={false}
      />
    </div>
  )
}

function FontRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const isKnown = SYSTEM_FONTS.some((f) => f.value === value)

  return (
    <div className="flex flex-col gap-1.5 py-2">
      <label className="text-sm text-foreground">{label}</label>
      <select
        value={isKnown ? value : '__custom__'}
        onChange={(e) => {
          if (e.target.value !== '__custom__') onChange(e.target.value)
        }}
        className="rounded border border-input bg-background px-2 py-1 text-xs"
      >
        {SYSTEM_FONTS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
        {!isKnown && <option value="__custom__">Custom…</option>}
      </select>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="CSS font stack"
        className="rounded border border-input bg-background px-2 py-1 text-xs font-mono"
        spellCheck={false}
      />
    </div>
  )
}

export function ThemeVarsForm() {
  const vars = useThemeEditorStore((s) => s.vars)
  const updateVar = useThemeEditorStore((s) => s.updateVar)

  function set<K extends keyof ThemeVars>(key: K, value: ThemeVars[K]) {
    updateVar(key, value)
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          CSS Variables
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2 divide-y divide-border/50">
        <ColorRow
          label="--slide-primary"
          value={vars.primary}
          onChange={(v) => set('primary', v)}
        />
        <ColorRow label="--slide-bg" value={vars.bg} onChange={(v) => set('bg', v)} />
        <ColorRow label="--slide-text" value={vars.text} onChange={(v) => set('text', v)} />
        <ColorRow
          label="--slide-heading-color"
          value={vars.headingColor}
          onChange={(v) => set('headingColor', v)}
        />

        {/* Border: color + opacity */}
        <div className="py-2">
          <ColorRow
            label="--slide-border (color)"
            value={vars.border}
            onChange={(v) => set('border', v)}
          />
          <div className="mt-1 flex items-center gap-3 pl-11">
            <label className="flex-1 text-xs text-muted-foreground">opacity</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={vars.borderOpacity}
              onChange={(e) => set('borderOpacity', parseFloat(e.target.value))}
              className="w-32"
            />
            <span className="w-10 text-right text-xs font-mono text-muted-foreground">
              {vars.borderOpacity.toFixed(2)}
            </span>
          </div>
        </div>

        <FontRow
          label="--slide-font-family"
          value={vars.fontFamily}
          onChange={(v) => set('fontFamily', v)}
        />
        <FontRow
          label="--slide-font-family-heading"
          value={vars.fontFamilyHeading}
          onChange={(v) => set('fontFamilyHeading', v)}
        />
      </div>
    </div>
  )
}
