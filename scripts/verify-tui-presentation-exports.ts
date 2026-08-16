import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const mapPath = resolve(root, '.agents/maps/tui-presentation-exports.json')

interface ExportEntry {
  package_dir: string
  package: string
  subpath: string
  source: string
  runtime_artifact: string
  types_artifact: string
  value_symbols: string[]
  type_symbols: string[]
}

interface FeatureMap {
  status: string
  modules: Array<{ module_id: string; owned_paths: string[] }>
  exports: ExportEntry[]
  forbidden_runtime_imports: string[]
}

interface PackageManifest {
  exports?: Record<string, { types?: string; default?: string } | string>
  files?: string[]
}

interface PackedEntry {
  packageDir: string
  runtimePath: string
  runtimeText: string
}

const feature = JSON.parse(readFileSync(mapPath, 'utf8')) as FeatureMap
const failures: string[] = []
const owned = new Map<string, string>()

for (const module of feature.modules) {
  for (const path of module.owned_paths) {
    const previous = owned.get(path)
    if (previous !== undefined) failures.push(`${path}: owned by both ${previous} and ${module.module_id}`)
    owned.set(path, module.module_id)
  }
}

function packagePayload(packageDir: string): Set<string> {
  const destination = mkdtempSync(resolve(tmpdir(), 'dsh-tui-presentation-pack-'))
  try {
    const result = spawnSync('pnpm', ['pack', '--pack-destination', destination], {
      cwd: packageDir,
      encoding: 'utf8',
    })
    if (result.error !== undefined || result.status !== 0) {
      throw new Error(`${result.stdout ?? ''}${result.stderr ?? ''}`.trim())
    }
    const tarball = readdirSync(destination).find(name => name.endsWith('.tgz'))
    if (tarball === undefined) throw new Error('pnpm pack produced no tarball')
    const listing = spawnSync('tar', ['-tzf', resolve(destination, tarball)], {
      encoding: 'utf8',
    })
    if (listing.error !== undefined || listing.status !== 0) {
      throw new Error(`${listing.stdout ?? ''}${listing.stderr ?? ''}`.trim())
    }
    return new Set(listing.stdout.split('\n')
      .filter(line => line !== '')
      .map(line => line.replace(/^package\//, '')))
  } finally {
    rmSync(destination, { recursive: true, force: true })
  }
}

function relativeImportPaths(text: string, filePath: string): string[] {
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)
  const imports: string[] = []
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier
      if (specifier !== undefined && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) {
        imports.push(specifier.text)
      }
    }
  }
  return imports
}

function artifactPathVariants(specifier: string, sourcePath: string): string[] {
  const base = resolve(sourcePath, '..', specifier)
  return [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    resolve(base, 'index.js'),
    resolve(base, 'index.mjs'),
    resolve(base, 'index.cjs'),
  ]
}

function verifyPackedImportClosure(entry: PackedEntry, payload: Set<string>): void {
  const pending = [entry.runtimePath]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || seen.has(current)) continue
    seen.add(current)
    const normalized = current.replaceAll('\\', '/')
    if (!payload.has(normalized)) {
      failures.push(`${entry.runtimePath}: packed payload omits relative import ${normalized}`)
      continue
    }
    const absolute = resolve(entry.packageDir, normalized)
    if (!existsSync(absolute)) {
      failures.push(`${entry.runtimePath}: checkout artifact missing packed file ${normalized}`)
      continue
    }
    const text = normalized === entry.runtimePath
      ? entry.runtimeText
      : readFileSync(absolute, 'utf8')
    for (const specifier of relativeImportPaths(text, absolute)) {
      const resolved = artifactPathVariants(specifier, absolute)
        .map(path => path.replace(`${entry.packageDir}/`, ''))
        .find(path => payload.has(path))
      if (resolved === undefined) {
        failures.push(`${entry.runtimePath}: packed payload cannot resolve ${specifier} from ${normalized}`)
      } else {
        pending.push(resolved)
      }
    }
  }
}

for (const entry of feature.exports) {
  if (!owned.has(entry.source)) failures.push(`${entry.source}: no module owner`)
  const packageDir = resolve(root, entry.package_dir)
  const manifest = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8')) as PackageManifest
  const published = manifest.exports?.[entry.subpath]
  if (typeof published !== 'object'
    || published.types !== `./${entry.types_artifact}`
    || published.default !== `./${entry.runtime_artifact}`) {
    failures.push(`${entry.package}${entry.subpath.slice(1)}: package export does not match the map`)
  }
  if (!manifest.files?.includes(entry.runtime_artifact)) {
    failures.push(`${entry.package}: files does not publish ${entry.runtime_artifact}`)
  }

  const typesPath = resolve(packageDir, entry.types_artifact)
  const program = ts.createProgram({ rootNames: [typesPath], options: { moduleResolution: ts.ModuleResolutionKind.NodeNext } })
  const source = program.getSourceFile(typesPath)
  const moduleSymbol = source === undefined ? undefined : program.getTypeChecker().getSymbolAtLocation(source)
  const exported = new Set(moduleSymbol === undefined
    ? []
    : program.getTypeChecker().getExportsOfModule(moduleSymbol).map(symbol => symbol.name))
  for (const symbol of [...entry.value_symbols, ...entry.type_symbols]) {
    if (!exported.has(symbol)) failures.push(`${entry.package}${entry.subpath.slice(1)}: missing declaration export ${symbol}`)
  }

  const runtimePath = resolve(packageDir, entry.runtime_artifact)
  const runtimeText = readFileSync(runtimePath, 'utf8')
  let payload: Set<string>
  try {
    payload = packagePayload(packageDir)
  } catch (error: unknown) {
    failures.push(`${entry.package}${entry.subpath.slice(1)}: npm payload check failed: ${error instanceof Error ? error.message : String(error)}`)
    payload = new Set()
  }
  if (!payload.has(entry.runtime_artifact)) {
    failures.push(`${entry.package}${entry.subpath.slice(1)}: npm payload omits ${entry.runtime_artifact}`)
  }
  verifyPackedImportClosure({ packageDir, runtimePath: entry.runtime_artifact, runtimeText }, payload)
  const runtimeSource = ts.createSourceFile(runtimePath, runtimeText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)
  for (const statement of runtimeSource.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
    const specifier = statement.moduleSpecifier
    if (specifier === undefined || !ts.isStringLiteral(specifier)) continue
    if (feature.forbidden_runtime_imports.some(forbidden =>
      specifier.text === forbidden || specifier.text.startsWith(`${forbidden}/`))) {
      failures.push(`${entry.package}${entry.subpath.slice(1)}: forbidden runtime import ${specifier.text}`)
    }
    if (specifier.text.endsWith('.css') || specifier.text.endsWith('.tsx')) {
      failures.push(`${entry.package}${entry.subpath.slice(1)}: browser-only runtime import ${specifier.text}`)
    }
  }

  try {
    const runtime = await import(`${pathToFileURL(runtimePath).href}?verify=${Date.now()}`) as Record<string, unknown>
    for (const symbol of entry.value_symbols) {
      if (!(symbol in runtime)) failures.push(`${entry.package}${entry.subpath.slice(1)}: missing runtime export ${symbol}`)
    }
  } catch (error: unknown) {
    failures.push(`${entry.package}${entry.subpath.slice(1)}: plain-Node import failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (feature.status !== 'active') failures.push(`feature status is ${feature.status}, expected active`)

if (failures.length > 0) {
  console.error('verify-tui-presentation-exports: failures:')
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log(`verify-tui-presentation-exports: ${feature.exports.length} installable presentation exports passed.`)
