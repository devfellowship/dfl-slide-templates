import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  applyRegistryEntry,
  registryPatchFor,
  RegistryMergeError,
} from './registry-merge.mjs'

const OWNER = 'devfellowship'
const REPO = 'dfl-slide-templates'
const BASE_BRANCH = 'main'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

interface PublishPayload {
  type: 'template' | 'theme'
  id: string
  description: string
  files: Array<{ path: string; content: string }>
  /**
   * An RFC 7396 merge patch for this id's `registry.json` entry — NOT a
   * replacement. Every field the caller omits is PRESERVED; a field set to
   * `null` is deleted. See `registry-merge.mjs` for the full contract and why
   * deletion stays expressible.
   *
   * The type is deliberately open. `registry.json` is `$schema_version: 2`
   * with ten fields per template, it will grow more, and the previous
   * three-field type is exactly what made this endpoint destroy the seven
   * fields `search_templates` ranks on (plan Gap 4).
   */
  registryEntry?: Record<string, unknown>
}

async function githubApi(path: string, options: RequestInit = {}) {
  const token = Deno.env.get('GITHUB_ORG_ADMIN_PAT')
  if (!token) throw new Error('GITHUB_ORG_ADMIN_PAT not configured')

  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      },
    },
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub API ${res.status}: ${body}`)
  }

  return res.json()
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization' }, 401)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const jwt = authHeader.replace('Bearer ', '')
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(jwt)
    if (authError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const payload: PublishPayload = await req.json()
    const { type, id, description, files, registryEntry } = payload

    if (!type || !id || !description || !files?.length) {
      return jsonResponse({ error: 'Missing required fields' }, 400)
    }

    const allFiles = [...files]

    /*
     * ── registry.json ────────────────────────────────────────────────────
     *
     * This block used to REPLACE the whole entry with whatever the caller
     * sent. `update_template` sends `{ id, version, category }`, and
     * `registry.json` carries seven more fields per template — `name`,
     * `when_to_use`, `avoid_when`, `media_profile`, `text_density`, `layout`,
     * `tags` — which are precisely the fields `dfl-mcp-studio:rank.ts` scores
     * on. So a version bump over MCP made the template unfindable by
     * `search_templates`, and a template created over MCP was born
     * unrankable. No guard in this repo reads that metadata, so every check
     * stayed green. Plan Gap 4 / risk 6.
     *
     * It now MERGES, as text, and the merge is the whole fix: a three-field
     * patch from an OLD caller preserves the other seven. That is why this
     * change is safe to deploy before `dfl-mcp-server` widens its side.
     *
     * A THEME now registers itself too. `update_theme` wrote
     * `themes/<id>.css` and never touched `registry.json`, whose own
     * `themes_doc` calls that array the source of truth and which
     * `list_themes` reads. A theme published over MCP therefore did not
     * appear in the catalogue — the same defect class, on the theme side.
     * `file` is derived from the id so it can never disagree with the path
     * this same request writes.
     */
    const registryTarget = registryPatchFor(type, id, registryEntry)

    let registryOutcome: { action: string; warnings: string[] } | undefined

    if (registryTarget) {
      const registryRaw = await githubApi(
        `/contents/registry.json?ref=${BASE_BRANCH}`,
      )
      // `atob` is byte-wise, so a multi-byte character (registry.json holds
      // em-dashes) must be decoded as UTF-8 rather than read as latin-1.
      const registryText = new TextDecoder().decode(
        Uint8Array.from(atob(registryRaw.content), (c) => c.charCodeAt(0)),
      )
      const merged = applyRegistryEntry(
        registryText,
        registryTarget.arrayKey,
        registryTarget.patch,
      )
      registryOutcome = { action: merged.action, warnings: merged.warnings }
      if (merged.action !== 'unchanged') {
        allFiles.push({ path: 'registry.json', content: merged.text })
      }
    }

    // 1. Get main branch ref
    const ref = await githubApi(`/git/ref/heads/${BASE_BRANCH}`)
    const baseSha: string = ref.object.sha

    // 2. Get base commit tree
    const baseCommit = await githubApi(`/git/commits/${baseSha}`)
    const baseTreeSha: string = baseCommit.tree.sha

    // 3. Create new tree with file changes
    const newTree = await githubApi('/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: allFiles.map((f) => ({
          path: f.path,
          mode: '100644',
          type: 'blob',
          content: f.content,
        })),
      }),
    })

    // 4. Create commit
    const timestamp = Date.now()
    const branchName = `template-studio/${type}-${id}-${timestamp}`
    const commitMessage =
      type === 'template'
        ? `feat(templates): ${description}`
        : `feat(themes): ${description}`

    const newCommit = await githubApi('/git/commits', {
      method: 'POST',
      body: JSON.stringify({
        message: commitMessage,
        tree: newTree.sha,
        parents: [baseSha],
      }),
    })

    // 5. Create branch
    await githubApi('/git/refs', {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: newCommit.sha,
      }),
    })

    // 6. Open PR
    const prBody = [
      '## Template Studio Publish',
      '',
      `**Type:** ${type}`,
      `**ID:** \`${id}\``,
      `**Author:** ${user.email || user.id}`,
      '',
      '### Changed files',
      '',
      ...allFiles.map((f) => `- \`${f.path}\``),
      '',
      '---',
      '_This PR was automatically generated by Template Studio._',
    ].join('\n')

    const pr = await githubApi('/pulls', {
      method: 'POST',
      body: JSON.stringify({
        title: commitMessage,
        body: prBody,
        head: branchName,
        base: BASE_BRANCH,
      }),
    })

    return jsonResponse({
      prUrl: pr.html_url,
      prNumber: pr.number,
      branch: branchName,
      // Additive. `registry.action` says whether the entry was created,
      // updated or already correct; `registry.warnings` names a new template
      // that arrived with nothing for `search_templates` to rank on.
      registry: registryOutcome,
    })
  } catch (err) {
    console.error('Publish error:', err)
    // A registry merge refusal is the CALLER's problem to fix — a missing
    // theme name, an ambiguous id — so it must not read as a server fault.
    if (err instanceof RegistryMergeError) {
      return jsonResponse({ error: err.message }, 400)
    }
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Internal error' },
      500,
    )
  }
})
