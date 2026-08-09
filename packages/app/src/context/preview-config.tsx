import { createSimpleContext } from "@opencode-ai/ui/context"
import { createResource } from "solid-js"
import { usePlatform } from "./platform"
import { useServer } from "./server"
import { authTokenFromCredentials } from "@/utils/server"

export type PreviewConfig = {
  siteMode: boolean
  root: string
}

const FALLBACK: PreviewConfig = { siteMode: false, root: "" }

// Site mode is a container-only deployment shape. A server that does not answer
// (older build, unreachable, wrong origin) must behave exactly like a normal
// opencode server, so every failure path resolves to FALLBACK rather than
// leaving the app in an undecided state.
const TIMEOUT_MS = 5_000

async function loadPreviewConfig(
  server: { url: string; username?: string; password?: string } | undefined,
  fetcher: typeof globalThis.fetch,
): Promise<PreviewConfig> {
  if (!server?.url) return FALLBACK
  const origin = server.url.replace(/\/+$/, "")
  const headers: Record<string, string> = {}
  if (server.password) {
    headers["Authorization"] =
      `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`
  }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    const response = await fetcher(`${origin}/preview-config`, {
      headers,
      cache: "no-store",
      signal: abort.signal,
    })
    if (!response.ok) return FALLBACK
    const body = (await response.json()) as Partial<PreviewConfig> | null
    return {
      siteMode: body?.siteMode === true,
      root: typeof body?.root === "string" ? body.root : "",
    }
  } catch {
    return FALLBACK
  } finally {
    clearTimeout(timer)
  }
}

export const { use: usePreviewConfig, provider: PreviewConfigProvider } = createSimpleContext({
  name: "PreviewConfig",
  // Never gate the tree on this fetch: a hung request must not blank the app.
  gate: false,
  init: () => {
    const platform = usePlatform()
    const server = useServer()

    // Wrapped in an object so the source is always truthy: a server-less app
    // still needs the resource to resolve (to FALLBACK) instead of staying
    // unresolved forever.
    const [config] = createResource(
      () => ({ http: server.current?.http }),
      (source) => loadPreviewConfig(source.http, platform.fetch ?? globalThis.fetch),
    )

    const value = () => config.latest ?? FALLBACK

    return {
      siteMode: () => value().siteMode,
      root: () => value().root,
      // True once the fetch has settled either way — callers that need to avoid
      // flashing non-site-mode chrome can wait on this.
      loaded: () => config.state === "ready" || config.state === "errored",
    }
  },
})
