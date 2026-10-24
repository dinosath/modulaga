#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if ! command -v baker >/dev/null 2>&1; then
  printf 'Baker CLI is required. Install it from https://github.com/aliev/baker and run pnpm dev again.\n' >&2
  exit 1
fi

export AUTH_MODE=disabled
export WORKSPACE_STORE="${WORKSPACE_STORE:-sqlite}"
mkdir -p "$repo_root/.data"
export DATABASE_URL="${DATABASE_URL:-sqlite://$repo_root/.data/workspace-config.sqlite?mode=rwc}"
export ALLOWED_ORIGINS="http://127.0.0.1:4300,http://localhost:4300,http://127.0.0.1:4176,http://localhost:4176,http://127.0.0.1:4177,http://localhost:4177"
export RUST_LOG="${RUST_LOG:-info}"
export npm_config_manage_package_manager_versions=false

config_pid=""
catalog_pid=""
demo_pid=""
content_types_pid=""
content_types_app_pid=""
admin_panel_app_pid=""
application_generator_pid=""
application_generator_app_pid=""

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
  if [[ -n "$content_types_pid" ]]; then
    kill "$content_types_pid" 2>/dev/null || true
    wait "$content_types_pid" 2>/dev/null || true
  fi
  if [[ -n "$content_types_app_pid" ]]; then
    kill "$content_types_app_pid" 2>/dev/null || true
    wait "$content_types_app_pid" 2>/dev/null || true
  fi
  if [[ -n "$admin_panel_app_pid" ]]; then
    kill "$admin_panel_app_pid" 2>/dev/null || true
    wait "$admin_panel_app_pid" 2>/dev/null || true
  fi
  if [[ -n "$application_generator_pid" ]]; then
    kill "$application_generator_pid" 2>/dev/null || true
    wait "$application_generator_pid" 2>/dev/null || true
  fi
  if [[ -n "$application_generator_app_pid" ]]; then
    kill "$application_generator_app_pid" 2>/dev/null || true
    wait "$application_generator_app_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

cargo build --manifest-path services/workspace-config/Cargo.toml --bins
cargo build --manifest-path services/content-types/Cargo.toml --bin content-types
cargo build --manifest-path services/application-generator/Cargo.toml --bin application-generator
pnpm --filter @modulaga/demo-react build
CONTENT_TYPES_PUBLIC_URL="http://127.0.0.1:4175/" pnpm --filter @modulaga/content-types build
ADMIN_PANEL_PUBLIC_URL="http://127.0.0.1:4176/" pnpm --filter @modulaga/admin-panel build
APPLICATION_GENERATOR_PUBLIC_URL="http://127.0.0.1:4177/" pnpm --filter @modulaga/application-generator build

./services/workspace-config/target/debug/workspace-config &
config_pid=$!

CONTENT_TYPES_DATABASE_URL="sqlite://$repo_root/.data/content-types.sqlite?mode=rwc" ./services/content-types/target/debug/content-types &
content_types_pid=$!

APPLICATION_GENERATOR_DATABASE_URL="sqlite://$repo_root/.data/application-generator.sqlite?mode=rwc" \
CONTENT_TYPES_API_URL="http://127.0.0.1:4305" \
GENERATED_APPS_DIR="$repo_root/.data/generated-apps" \
ALLOWED_ORIGINS="http://127.0.0.1:4300,http://localhost:4300,http://127.0.0.1:4177,http://localhost:4177" \
./services/application-generator/target/debug/application-generator &
application_generator_pid=$!

CATALOG_PATH="$repo_root/fixtures/catalog.local.json" CATALOG_BIND_ADDRESS=127.0.0.1:4304 ./services/workspace-config/target/debug/app-catalog &
catalog_pid=$!

pnpm --filter @modulaga/demo-react preview &
demo_pid=$!
pnpm --filter @modulaga/content-types preview &
content_types_app_pid=$!
pnpm --filter @modulaga/admin-panel preview &
admin_panel_app_pid=$!
pnpm --filter @modulaga/application-generator preview &
application_generator_app_pid=$!

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
wait_for_health "Content types API" "http://127.0.0.1:4305/health"
wait_for_health "Application generator API" "http://127.0.0.1:4306/health"
wait_for_health "Application catalog API" "http://127.0.0.1:4304/health"
wait_for_health "React microfrontend" "http://127.0.0.1:4174/mf-manifest.json"
wait_for_health "Content types microfrontend" "http://127.0.0.1:4175/mf-manifest.json"
wait_for_health "Admin panel UI" "http://127.0.0.1:4176/"
wait_for_health "Application generator UI" "http://127.0.0.1:4177/"

printf '\nModulaga is starting. Shell: http://127.0.0.1:4300 · Admin panel: http://127.0.0.1:4176 · Content types: http://127.0.0.1:4175 · Application generator: http://127.0.0.1:4177\n\n'
pnpm --filter @modulaga/shell dev
