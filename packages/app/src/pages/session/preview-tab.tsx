import { Show, createEffect, createMemo, createResource, createSignal, on } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { authTokenFromCredentials } from "@/utils/server"

type SaveState = "idle" | "saving" | "saved" | "error"

export function SessionPreviewTab() {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const sync = useSync()
  const { params } = useSessionLayout()

  const [nonce, setNonce] = createSignal(Date.now())
  const [briefOpen, setBriefOpen] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [saveState, setSaveState] = createSignal<SaveState>("idle")

  const connection = createMemo(() => serverSDK().server.http)
  const origin = createMemo(() => connection().url.replace(/\/+$/, ""))
  const src = createMemo(() => `${origin()}/preview/index.html?opencode_preview=${nonce()}`)
  const reload = () => setNonce(Date.now())

  const request = (path: string, init?: { method?: string; body?: string }) => {
    const server = connection()
    const headers: Record<string, string> = {}
    if (server.password) {
      headers["Authorization"] =
        `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`
    }
    const call = platform.fetch ?? globalThis.fetch
    return call(`${origin()}${path}`, { ...init, headers, cache: "no-store" })
  }

  // Reload the iframe whenever the agent goes from working to idle.
  const working = createMemo(() => sync().data.session_working(params.id ?? ""))
  createEffect(
    on(
      working,
      (now, prev) => {
        if (prev && !now) reload()
      },
      { defer: true },
    ),
  )

  const [brief] = createResource(
    () => (briefOpen() ? origin() : undefined),
    async () => {
      const response = await request("/preview-agents")
      if (!response.ok) throw new Error(`status ${response.status}`)
      return response.text()
    },
  )

  createEffect(() => {
    const value = brief()
    if (value === undefined) return
    setDraft(value)
    setSaveState("idle")
  })

  const save = async () => {
    setSaveState("saving")
    try {
      const response = await request("/preview-agents", { method: "PUT", body: draft() })
      if (!response.ok) throw new Error(`status ${response.status}`)
      setSaveState("saved")
    } catch {
      setSaveState("error")
    }
  }

  return (
    <div class="flex flex-col h-full min-h-0 overflow-hidden">
      <div class="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-border-weaker-base">
        <div class="min-w-0 truncate text-12-regular text-text-weak">{language.t("session.preview.title")}</div>
        <div class="shrink-0 flex items-center gap-1">
          <Button
            size="small"
            variant="ghost"
            onClick={() => setBriefOpen((value) => !value)}
            aria-expanded={briefOpen()}
          >
            {language.t("session.preview.brief")}
          </Button>
          <Button size="small" variant="secondary" onClick={reload} aria-label={language.t("session.preview.refresh")}>
            {language.t("session.preview.refresh")}
          </Button>
        </div>
      </div>

      <Show when={briefOpen()}>
        <div class="shrink-0 flex flex-col gap-2 px-3 py-2 border-b border-border-weaker-base">
          <div class="text-12-regular text-text-weak">{language.t("session.preview.brief.description")}</div>
          <textarea
            class="w-full h-40 resize-none rounded-md border border-border-weaker-base bg-background-stronger px-2 py-1.5 text-12-regular text-text-base outline-none"
            spellcheck={false}
            value={draft()}
            disabled={brief.loading}
            onInput={(event) => {
              setDraft(event.currentTarget.value)
              setSaveState("idle")
            }}
          />
          <div class="flex items-center gap-2">
            <Button size="small" variant="primary" disabled={brief.loading || saveState() === "saving"} onClick={save}>
              {language.t("session.preview.brief.save")}
            </Button>
            <div class="text-12-regular text-text-weak">
              <Show when={brief.error}>{language.t("session.preview.brief.loadError")}</Show>
              <Show when={saveState() === "saved"}>{language.t("session.preview.brief.saved")}</Show>
              <Show when={saveState() === "error"}>{language.t("session.preview.brief.saveError")}</Show>
            </div>
          </div>
        </div>
      </Show>

      <div class="relative flex-1 min-h-0">
        <iframe
          class="absolute inset-0 size-full border-0 bg-white"
          src={src()}
          title={language.t("session.preview.title")}
        />
      </div>
    </div>
  )
}
