import { Button } from "@opencode-ai/ui/button"
import { Splash } from "@opencode-ai/ui/logo"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useNavigate } from "@solidjs/router"
import { type Component, createEffect, createMemo, createSignal, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useLanguage } from "@/context/language"
import { usePreviewConfig } from "@/context/preview-config"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useSettings } from "@/context/settings"
import { normalizeSessionInfo } from "@/utils/session"
import { sessionHref } from "@/utils/session-route"

/**
 * Entry route for site mode: there is exactly one project (the directory the
 * server itself runs in), so the user never picks anything. Resume the most
 * recent root session for that directory, or create one, then go straight to
 * the chat + preview.
 */
export function SiteModeEntry() {
  const language = useLanguage()
  const navigate = useNavigate()
  const previewConfig = usePreviewConfig()
  const server = useServer()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const settings = useSettings()

  // The server reports its own directory once the path query lands. `root` from
  // /preview-config is the fallback for protocols that do not report a path.
  const directory = createMemo(() => serverSync().data.path.directory || previewConfig.root() || "")

  const [failed, setFailed] = createSignal(false)
  const [attempt, setAttempt] = createSignal(0)

  const href = (dir: string, sessionID: string) =>
    settings.general.newLayoutDesigns()
      ? sessionHref(server.key, sessionID)
      : `/${base64Encode(dir)}/session/${sessionID}`

  let running = false

  createEffect(() => {
    attempt()
    const dir = directory()
    if (!dir || running) return
    running = true
    void (async () => {
      try {
        const api = serverSDK().api
        const existing = await api.session
          .list({ directory: dir, parentID: null, limit: 20, order: "desc" })
          .then((result) => result.data)
          .catch(() => [])
        const recent = [...existing].sort(
          (a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created),
        )[0]
        const session = recent ?? (await api.session.create({ location: { directory: dir } }))
        // Seed the sync store so the session route resolves the lineage without
        // waiting for the created/updated event to come back over the stream.
        serverSync().session.remember(normalizeSessionInfo(session))
        navigate(href(dir, session.id), { replace: true })
      } catch (error) {
        console.error("[site-mode] failed to open the workspace session", error)
        running = false
        setFailed(true)
      }
    })()
  })

  return (
    <div class="flex-1 self-stretch flex flex-col items-center justify-center gap-4">
      <Show when={failed()} fallback={<Splash class="w-16 h-20 opacity-50 animate-pulse" />}>
        <p class="text-14-regular text-text-base">{language.t("session.siteMode.openError")}</p>
        <Button
          size="small"
          variant="primary"
          onClick={() => {
            setFailed(false)
            setAttempt((value) => value + 1)
          }}
        >
          {language.t("session.siteMode.retry")}
        </Button>
      </Show>
    </div>
  )
}

/**
 * Renders the site-mode entry when the server is in site mode, otherwise the
 * component that route normally renders. The /preview-config fetch starts above
 * the connection gate, so outside site mode this resolves before the home route
 * ever mounts and the home renders unchanged.
 */
export function SiteModeHome(props: { home: Component }) {
  const previewConfig = usePreviewConfig()
  return (
    <Show when={previewConfig.loaded()} fallback={<Splash class="w-16 h-20 opacity-50 animate-pulse m-auto" />}>
      <Show when={previewConfig.siteMode()} fallback={<Dynamic component={props.home} />}>
        <SiteModeEntry />
      </Show>
    </Show>
  )
}
