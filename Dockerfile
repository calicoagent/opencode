# Single-page site mode: opencode serving one project directory as chat + live
# preview, reachable on the network. Build once, run one container per client
# site with the site mounted (or baked in) at /workspace.
#
#   docker build -t opencode-site .
#   docker run --rm -p 4096:4096 \
#     -e OPENCODE_SERVER_PASSWORD=changeme \
#     -e ANTHROPIC_API_KEY=... \
#     -v "$PWD/site:/workspace" opencode-site
#
# Then open http://<host>:4096 for the editor, http://<host>:4096/preview for
# the bare site.

FROM oven/bun:1.3-debian AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .

RUN bun install --frozen-lockfile || bun install
# --single builds a native binary for this platform with the web UI embedded,
# so the runtime image needs neither bun nor node_modules.
# The build derives its release channel from `git branch --show-current`, and
# .git is not in the build context — pin it instead of shipping git history.
ENV OPENCODE_CHANNEL=dev
RUN bun run --cwd packages/opencode build --single \
    && cp "$(find packages/opencode/dist -type f -name opencode -perm -u+x | head -n1)" /opencode

FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git ripgrep \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opencode /usr/local/bin/opencode
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/site-template /opt/site-template
RUN chmod +x /usr/local/bin/entrypoint.sh

COPY docker/opencode.json /opt/opencode-defaults.json

# The site being edited. Also the preview root, so /preview/* serves it.
# OPENCODE_SITE_MODE makes the UI skip project and session pickers and open the
# site straight away.
ENV OPENCODE_PREVIEW_ROOT=/workspace \
    OPENCODE_SITE_MODE=1 \
    OPENCODE_PORT=4096 \
    OPENCODE_HOSTNAME=0.0.0.0 \
    XDG_CONFIG_HOME=/root/.config
WORKDIR /workspace
VOLUME ["/workspace"]
EXPOSE 4096

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
