import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTemplates } from '@/hooks/useTemplates'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Plus } from 'lucide-react'
import type { RegistryEntry } from '@/types/template'

const CATEGORIES = ['all', 'content', 'layout', 'data'] as const
type CategoryFilter = (typeof CATEGORIES)[number]

const BASE_URL =
  'https://raw.githubusercontent.com/devfellowship/dfl-slide-templates/main'

function categoryColor(cat: string) {
  switch (cat) {
    case 'content':
      return 'default'
    case 'layout':
      return 'secondary'
    case 'data':
      return 'outline'
    default:
      return 'default'
  }
}

export function TemplateGallery() {
  const { catalog, loading, error } = useTemplates()
  const [filter, setFilter] = useState<CategoryFilter>('all')
  const navigate = useNavigate()

  const filtered = useMemo(() => {
    if (!catalog) return []
    const entries = catalog.registry.templates
    if (filter === 'all') return entries
    return entries.filter((t) => t.category === filter)
  }, [catalog, filter])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading templates…</p>
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
        <h2 className="text-2xl font-bold">Templates</h2>
        <Button onClick={() => navigate('/editor/new')}>
          <Plus className="mr-2 h-4 w-4" />
          New Template
        </Button>
      </div>

      <div className="mb-6 flex gap-2">
        {CATEGORIES.map((cat) => (
          <Button
            key={cat}
            variant={filter === cat ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(cat)}
          >
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((entry: RegistryEntry) => (
          <TemplateCard key={entry.id} entry={entry} catalog={catalog} />
        ))}
      </div>
    </div>
  )
}

function TemplateCard({
  entry,
  catalog,
}: {
  entry: RegistryEntry
  catalog: NonNullable<ReturnType<typeof useTemplates>['catalog']>
}) {
  const assets = catalog.templates.get(entry.id)
  const previewUrl = `${BASE_URL}/templates/${entry.id}/preview-landscape.png`

  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-lg">
      <div className="aspect-video bg-muted">
        <img
          src={previewUrl}
          alt={assets?.config.name ?? entry.id}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {assets?.config.name ?? entry.id}
          </span>
          <Badge variant={categoryColor(entry.category) as 'default' | 'secondary' | 'outline'}>
            {entry.category}
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}
