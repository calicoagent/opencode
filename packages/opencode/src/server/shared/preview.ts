import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path"

/**
 * Single-page site mode.
 *
 * Serves the project directory as a live website at `/preview/*` and exposes
 * the project's AGENTS.md for reading and writing at `/preview-agents`, so the
 * browser UI can show the rendered `index.html` next to the chat and let a
 * non-technical user edit the brief the agent works from.
 *
 * The root defaults to the server's working directory and can be pinned with
 * `OPENCODE_PREVIEW_ROOT` (which is what the Docker image does).
 */
export const PREVIEW_PREFIX = "/preview"
export const PREVIEW_AGENTS_PATH = "/preview-agents"
export const PREVIEW_CONFIG_PATH = "/preview-config"

const AGENTS_FILE = "AGENTS.md"

/**
 * Site mode turns the app from a coding tool into a one-page website editor:
 * the UI skips project and session pickers and drops the user straight into a
 * chat with the preview open. The Docker image sets this; a normal opencode
 * install never sees it.
 */
export function siteMode() {
  const value = process.env["OPENCODE_SITE_MODE"]
  return value === "1" || value === "true"
}

export function previewRoot() {
  const configured = process.env["OPENCODE_PREVIEW_ROOT"]
  return resolve(configured && configured.length > 0 ? configured : process.cwd())
}

/**
 * Resolve a request path inside the preview root, refusing anything that
 * escapes it. Returns null when the path is not contained by the root.
 */
export function resolveWithinRoot(root: string, requestPath: string) {
  const decoded = (() => {
    try {
      return decodeURIComponent(requestPath)
    } catch {
      return requestPath
    }
  })()
  const relative = normalize(decoded).replace(/^([/\\])+/, "")
  if (isAbsolute(relative)) return null
  const target = resolve(join(root, relative))
  if (target !== root && !target.startsWith(root + sep)) return null
  return target
}

function notFound() {
  return HttpServerResponse.text("Not Found", { status: 404 })
}

/**
 * Previewed pages are the user's own site, so they must not inherit the app's
 * `default-src 'self'` policy — client sites routinely pull fonts, CDN scripts
 * and images from elsewhere. They are same-origin, so the app can still frame
 * them.
 */
function previewHeaders(file: string) {
  return new Headers({
    "content-type": FSUtil.mimeType(file),
    "cache-control": "no-store",
  })
}

async function readCandidate(target: string) {
  const info = await stat(target).catch(() => null)
  if (!info) return null
  const file = info.isDirectory() ? join(target, "index.html") : target
  const body = await readFile(file).catch(() => null)
  if (!body) return null
  return { file, body }
}

export function servePreviewEffect(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const root = previewRoot()
    const requested = stripPrefix(request, PREVIEW_PREFIX)
    if (requested === null) return notFound()
    const target = resolveWithinRoot(root, requested || "/")
    if (!target) return notFound()

    const found = yield* Effect.promise(() => readCandidate(target))
    if (!found) return notFound()

    return HttpServerResponse.raw(found.body, { headers: previewHeaders(found.file) })
  })
}

export function previewConfigEffect() {
  return Effect.sync(() =>
    HttpServerResponse.jsonUnsafe(
      { siteMode: siteMode(), root: previewRoot() },
      { headers: { "cache-control": "no-store" } },
    ),
  )
}

export function readAgentsEffect() {
  return Effect.gen(function* () {
    const file = join(previewRoot(), AGENTS_FILE)
    const content = yield* Effect.promise(() => readFile(file, "utf8").catch(() => ""))
    return HttpServerResponse.text(content, {
      headers: new Headers({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }),
    })
  })
}

export function writeAgentsEffect(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const body = yield* Effect.orDie(request.text)
    const file = join(previewRoot(), AGENTS_FILE)
    yield* Effect.promise(() => writeFile(file, body, "utf8"))
    return HttpServerResponse.text("ok")
  })
}

/**
 * Flat file API over the site directory, for an external agent driving the
 * site with plain HTTP:
 *
 *   GET    /files            list every file, relative to the root
 *   GET    /files/index.html read one file
 *   PUT    /files/index.html write one file (creates parent directories)
 *   DELETE /files/index.html delete one file
 *
 * Deliberately dumb: raw bodies, no JSON envelope, no partial edits. It is
 * behind the same auth as everything else on this server, and every path is
 * resolved inside the root, so a caller cannot reach the rest of the machine.
 */
export const FILES_PREFIX = "/files"

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", ".opencode"])

function badRequest(message: string) {
  return HttpServerResponse.text(message, { status: 400 })
}

/**
 * The request path with the route prefix removed. Returns null when the path
 * does not actually start with the prefix — a proxy or client that rewrote the
 * URL must not have the remainder blindly sliced off, or `/tmp/pwned.html`
 * silently becomes the file `wned.html`.
 */
function stripPrefix(request: HttpServerRequest.HttpServerRequest, prefix: string) {
  const path = new URL(request.url, "http://localhost").pathname
  if (path !== prefix && !path.startsWith(prefix + "/")) return null
  return path.slice(prefix.length).replace(/^\/+/, "")
}

function requestRelativePath(request: HttpServerRequest.HttpServerRequest) {
  return stripPrefix(request, FILES_PREFIX)
}

async function listFiles(root: string, directory = root, out: string[] = []) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      await listFiles(root, join(directory, entry.name), out)
      continue
    }
    if (entry.isFile()) out.push(relative(root, join(directory, entry.name)))
  }
  return out.sort()
}

export function listFilesEffect() {
  return Effect.gen(function* () {
    const root = previewRoot()
    const files = yield* Effect.promise(() => listFiles(root))
    return HttpServerResponse.jsonUnsafe({ root, files }, { headers: { "cache-control": "no-store" } })
  })
}

export function readFileEffect(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const relativePath = requestRelativePath(request)
    if (relativePath === null) return notFound()
    if (!relativePath) return yield* listFilesEffect()

    const target = resolveWithinRoot(previewRoot(), relativePath)
    if (!target) return notFound()

    const body = yield* Effect.promise(() => readFile(target).catch(() => null))
    if (!body) return notFound()

    return HttpServerResponse.raw(body, { headers: previewHeaders(target) })
  })
}

export function writeFileEffect(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const relativePath = requestRelativePath(request)
    if (!relativePath) return badRequest("Path required, e.g. PUT /files/index.html")

    const target = resolveWithinRoot(previewRoot(), relativePath)
    if (!target) return badRequest("Path escapes the site directory")

    const body = yield* Effect.orDie(request.text)
    yield* Effect.promise(async () => {
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, body, "utf8")
    })
    return HttpServerResponse.jsonUnsafe({ ok: true, path: relativePath, bytes: Buffer.byteLength(body) })
  })
}

export function deleteFileEffect(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const relativePath = requestRelativePath(request)
    if (!relativePath) return badRequest("Path required, e.g. DELETE /files/old.html")

    const target = resolveWithinRoot(previewRoot(), relativePath)
    if (!target) return badRequest("Path escapes the site directory")

    const removed = yield* Effect.promise(() =>
      rm(target, { force: false })
        .then(() => true)
        .catch(() => false),
    )
    if (!removed) return notFound()
    return HttpServerResponse.jsonUnsafe({ ok: true, path: relativePath, deleted: true })
  })
}
