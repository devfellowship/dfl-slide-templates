import { useEditorStore } from '@/stores/editorStore'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'

const SLOT_TYPES = ['text', 'richText', 'image', 'items', 'rows', 'data'] as const

export function SlotSchemaEditor() {
  const config = useEditorStore((s) => s.config)
  const updateSlot = useEditorStore((s) => s.updateSlot)
  const addSlot = useEditorStore((s) => s.addSlot)
  const removeSlot = useEditorStore((s) => s.removeSlot)
  const moveSlot = useEditorStore((s) => s.moveSlot)
  const updateConfigField = useEditorStore((s) => s.updateConfigField)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          Template Config & Slots
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <div className="mb-4 grid grid-cols-4 gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">ID</label>
            <input
              type="text"
              value={config.id}
              onChange={(e) => updateConfigField('id', e.target.value)}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Name</label>
            <input
              type="text"
              value={config.name}
              onChange={(e) => updateConfigField('name', e.target.value)}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Version</label>
            <input
              type="text"
              value={config.version}
              onChange={(e) => updateConfigField('version', e.target.value)}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Category</label>
            <select
              value={config.category}
              onChange={(e) => updateConfigField('category', e.target.value)}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
            >
              <option value="content">content</option>
              <option value="layout">layout</option>
              <option value="data">data</option>
            </select>
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Slots</span>
          <Button variant="ghost" size="sm" onClick={addSlot} className="h-6 gap-1 px-2 text-xs">
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>

        <div className="space-y-1">
          {config.slots.map((slot, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded border border-border bg-card p-2"
            >
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => i > 0 && moveSlot(i, i - 1)}
                  disabled={i === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  onClick={() => i < config.slots.length - 1 && moveSlot(i, i + 1)}
                  disabled={i === config.slots.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>

              <input
                type="text"
                value={slot.name}
                onChange={(e) => updateSlot(i, { name: e.target.value })}
                placeholder="name"
                className="w-28 rounded border border-input bg-background px-2 py-1 text-xs"
              />
              <select
                value={slot.type}
                onChange={(e) => updateSlot(i, { type: e.target.value })}
                className="rounded border border-input bg-background px-2 py-1 text-xs"
              >
                {SLOT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={slot.required}
                  onChange={(e) => updateSlot(i, { required: e.target.checked })}
                  className="h-3 w-3"
                />
                Req
              </label>
              <input
                type="text"
                value={slot.description}
                onChange={(e) => updateSlot(i, { description: e.target.value })}
                placeholder="description"
                className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs"
              />
              <button
                onClick={() => removeSlot(i)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
