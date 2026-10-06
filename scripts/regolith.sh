#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT/.env" ]]; then
  # Inherited environment wins over .env, mirroring loadEnv() in scripts/lib/env.mjs,
  # so a one-off BETAFIED_SFTP_PASSWORD=... npm run push overrides the file.
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    while [[ "$value" == [\"']* || "$value" == *[\"'] ]]; do
      value="${value#[\"']}"
      value="${value%[\"']}"
    done
    if [[ -z "${!key+x}" ]]; then
      printf -v "$key" '%s' "$value"
      export "$key"
    fi
  done < "$ROOT/.env"
fi

# The development export target resolves com.mojang from COM_MOJANG, and a .env checked
# in from another machine points at a directory that does not exist here. Rather than
# exporting a path that builds into a quoted folder inside the repo, fall back to the
# macOS Bedrock Launcher location under the current user's home.
if [[ -z "${COM_MOJANG:-}" || ! -d "${COM_MOJANG:-}" ]]; then
  export COM_MOJANG="$HOME/Library/Application Support/Minecraft Bedrock Launcher/MinecraftData/games/com.mojang"
fi

exec regolith "$@"
