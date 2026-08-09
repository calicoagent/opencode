# Single-page site mode

This fork adds a mode where opencode is not a coding tool you point at a repo,
but a small product you hand to a client: chat on the left, their live
one-page website on the right, and an editable brief the assistant follows.

## What the fork adds

| Piece | Where |
| --- | --- |
| `GET /preview/*` — serves the project directory as a website (`/preview` → `index.html`) | `packages/opencode/src/server/shared/preview.ts` |
| `GET`/`PUT /preview-agents` — read and write the project's `AGENTS.md` | same file |
| `GET`/`PUT`/`POST`/`DELETE /files/*` — flat file API over the site, for external agents | same file |
| Routes mounted ahead of the SPA catch-all | `packages/opencode/src/server/routes/instance/httpapi/server.ts` |
| Preview + brief panes in the web UI | `packages/app` |
| Container that boots straight into this mode | `Dockerfile`, `docker/` |

## File API for external agents

The site directory is editable over plain HTTP, so an agent that is not
opencode can drive the site directly. Every path resolves inside the site
directory; anything escaping it is refused.

```sh
BASE=http://localhost:4096
AUTH='-u opencode:yourpassword'   # any username; the password is OPENCODE_SERVER_PASSWORD

curl $AUTH $BASE/files                               # {"root":"/workspace","files":[...]}
curl $AUTH $BASE/files/index.html                    # raw file
curl $AUTH -X PUT --data-binary @page.html $BASE/files/index.html
curl $AUTH -X DELETE $BASE/files/old.html
curl $AUTH $BASE/preview-agents                      # the brief
curl $AUTH -X PUT --data-binary @brief.md $BASE/preview-agents
```

`PUT` creates parent directories and returns `{"ok":true,"path":…,"bytes":…}`.
`POST` does the same as `PUT`. Bodies are raw file contents — no JSON envelope,
no partial edits. Listing skips `.git`, `node_modules` and `.opencode`.

Anything written this way is served immediately at `/preview/<path>`.

The preview root is the server's working directory, or `OPENCODE_PREVIEW_ROOT`
when set. Paths that escape the root are refused with a 404.

Previewed pages are served **without** the app's `default-src 'self'` CSP —
client sites legitimately load fonts and scripts from elsewhere. They stay
same-origin with the app, so the preview pane can frame them.

`AGENTS.md` is re-read per message by `session/instruction.ts`, so editing the
brief takes effect on the next message with no restart.

## Run it

```sh
docker build -t opencode-site .
docker run --rm -p 4096:4096 \
  -e OPENCODE_SERVER_PASSWORD=changeme \
  -e ANTHROPIC_API_KEY=... \
  -v "$PWD/site:/workspace" \
  opencode-site
```

- Editor: `http://<host>:4096`
- Bare site: `http://<host>:4096/preview`

An empty `/workspace` is seeded from `docker/site-template` so the preview is
never blank on first boot.

Or with compose:

```sh
OPENCODE_SERVER_PASSWORD=changeme ANTHROPIC_API_KEY=... \
  docker compose -f docker/compose.yml up --build
```

## Security

The server binds `0.0.0.0` inside the container. **Set
`OPENCODE_SERVER_PASSWORD`.** Without it, anyone who can reach the port can
edit the site and run shell commands inside the container — the assistant has
the usual tool access. One container per client, and do not share a workspace
volume between clients.

## From source, for development

```sh
bun install
OPENCODE_PREVIEW_ROOT=/path/to/site bun run dev serve --port 4096 --hostname 127.0.0.1
bun run dev:web   # app on :3000
```
