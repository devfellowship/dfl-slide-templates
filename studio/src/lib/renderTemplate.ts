import Mustache from 'mustache'

function scopeSelectors(css: string, scopeId: string): string {
  const keyframeNames = new Map<string, string>()

  let scoped = css.replace(
    /@keyframes\s+([\w-]+)/g,
    (_match, name: string) => {
      const nsName = `${scopeId}-${name}`
      keyframeNames.set(name, nsName)
      return `@keyframes ${nsName}`
    },
  )

  for (const [original, namespaced] of keyframeNames) {
    scoped = scoped.replace(
      new RegExp(`animation(?:-name)?\\s*:[^;]*\\b${original}\\b`, 'g'),
      (match) => match.replace(original, namespaced),
    )
  }

  scoped = scoped.replace(/([^{}@/]+)\{/g, (match, selectorGroup: string) => {
    if (selectorGroup.trim().startsWith('@')) return match
    const selectors = selectorGroup.split(',').map((s) => {
      const trimmed = s.trim()
      if (
        !trimmed ||
        trimmed.startsWith('@') ||
        trimmed.startsWith('from') ||
        trimmed.startsWith('to') ||
        /^\d+%/.test(trimmed)
      ) {
        return s
      }
      return ` #${scopeId} ${trimmed}`
    })
    return selectors.join(',') + '{'
  })

  return scoped
}

export function renderTemplate(
  html: string,
  css: string,
  themeCss: string,
  data: Record<string, unknown>,
  scopeId: string,
): string {
  const rendered = Mustache.render(html, data)
  const scoped = scopeSelectors(css, scopeId)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${themeCss}</style>
<style>${scoped}</style>
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; }
</style>
</head>
<body>
<div id="${scopeId}" class="tpl-root">
${rendered}
</div>
</body>
</html>`
}
