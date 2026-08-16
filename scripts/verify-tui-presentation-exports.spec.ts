import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const feature = JSON.parse(readFileSync(resolve(root, '.agents/maps/tui-presentation-exports.json'), 'utf8')) as {
  exports: Array<{ source: string }>
  modules: Array<{ owned_paths: string[] }>
  resource_edges: Array<{ from: string; via: string; to: string }>
}

describe('TUI presentation export map', () => {
  it('gives every planned source exactly one module owner', () => {
    const owned = feature.modules.flatMap(module => module.owned_paths)
    expect(new Set(owned).size).toBe(owned.length)
    expect(owned.sort()).toEqual(feature.exports.map(entry => entry.source).sort())
  })

  it('routes business input through the projection and grammar owners', () => {
    expect(feature.resource_edges).toEqual([
      {
        from: 'session.event_window',
        via: 'conversation.presentation',
        to: 'conversation.view_snapshot',
      },
      {
        from: 'assistant.markdown',
        via: 'markdown.grammar',
        to: 'markdown.ast',
      },
    ])
  })

  it('publishes the Markdown parser chunk selected by the package manifest', () => {
    const packageManifest = JSON.parse(readFileSync(
      resolve(root, 'packages/client/ui-primitives/package.json'),
      'utf8',
    )) as { files: string[] }
    expect(packageManifest.files).toContain('lib/parse-*.js')
  })
})
