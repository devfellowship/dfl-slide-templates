import type { TemplateSlot } from '@/types/template'

export function generateSampleData(
  slots: TemplateSlot[],
): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  for (const slot of slots) {
    switch (slot.type) {
      case 'text':
        data[slot.name] = `Sample ${slot.name}`
        break
      case 'richText':
        data[slot.name] = `<p>Sample <strong>${slot.name}</strong> content</p>`
        break
      case 'image':
        data[slot.name] = 'https://placehold.co/400x300/e2e8f0/64748b?text=Image'
        break
      case 'items':
        data[slot.name] = [
          { text: 'Item 1' },
          { text: 'Item 2' },
          { text: 'Item 3' },
        ]
        break
      case 'rows':
        data[slot.name] = [
          { cells: [{ value: 'A1' }, { value: 'B1' }, { value: 'C1' }] },
          { cells: [{ value: 'A2' }, { value: 'B2' }, { value: 'C2' }] },
        ]
        break
      case 'data':
        data[slot.name] = {}
        break
      default:
        data[slot.name] = `Sample ${slot.name}`
    }
  }

  return data
}
