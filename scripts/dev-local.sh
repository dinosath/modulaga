#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

export AUTH_MODE=disabled
export WORKSPACE_STORE="${WORKSPACE_STORE:-sqlite}"
mkdir -p "$repo_root/.data"
export DATABASE_URL="${DATABASE_URL:-sqlite://$repo_root/.data/workspace-config.sqlite?mode=rwc}"
export ALLOWED_ORIGINS="http://127.0.0.1:4300,http://localhost:4300"
export RUST_LOG="${RUST_LOG:-info}"
export npm_config_manage_package_manager_versions=false

config_pid=""
catalog_pid=""
demo_pid=""

cleanup() {
  if [[ -n "$config_pid" ]]; then
    kill "$config_pid" 2>/dev/null || true
    wait "$config_pid" 2>/dev/null || true
  fi
  if [[ -n "$catalog_pid" ]]; then
    kill "$catalog_pid" 2>/dev/null || true
    wait "$catalog_pid" 2>/dev/null || true
  fi
  if [[ -n "$demo_pid" ]]; then
    kill "$demo_pid" 2>/dev/null || true
    wait "$demo_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

cargo build --manifest-path services/workspace-config/Cargo.toml --bins
pnpm --filter @modulaga/demo-react build

./services/workspace-config/target/debug/workspace-config &
config_pid=$!

CATALOG_PATH="$repo_root/fixtures/catalog.local.json" CATALOG_BIND_ADDRESS=127.0.0.1:4304 ./services/workspace-config/target/debug/app-catalog &
catalog_pid=$!

pnpm --filter @modulaga/demo-react preview &
demo_pid=$!

wait_for_health() {
  local service_name="$1"
  local url="$2"
  local attempt
  for attempt in {1..120}; do
    if curl --fail --silent "$url" >/dev/null; then
      printf '%s is ready.\n' "$service_name"
      return 0
    fi
    sleep 1
  done
  printf '%s did not become healthy at %s\n' "$service_name" "$url" >&2
  return 1
}

wait_for_health "Workspace config API" "http://127.0.0.1:4303/health"
wait_for_health "Application catalog API" "http://127.0.0.1:4304/health"
wait_for_health "React microfrontend" "http://127.0.0.1:4174/mf-manifest.json"

printf '\nModulaga is starting. Shell: http://127.0.0.1:4300\n\n'
pnpm --filter @modulaga/shell dev
