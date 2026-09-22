#!/bin/sh
# fast npm setup — Version __FAST_VERSION__
# Run as the user who uses npm; sudo is not required.
set -eu

usage() {
  printf '%s\n' 'Usage: sh npm.sh [--reset | --help]' \
    'Configure the current user npm registry, or restore the official registry with --reset.'
}

if [ "$#" -gt 1 ]; then
  usage >&2
  exit 2
fi

fast_registry=__FAST_NPM_REGISTRY__
case "${1-}" in
  '') ;;
  --reset) fast_registry='https://registry.npmjs.org/' ;;
  --help|-h) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'npm is not installed. Install Node.js and npm, then run this script again.' >&2
  exit 127
fi

# Clear inherited global mode before choosing the user config; allow workspace directories.
npm config set registry "$fast_registry" --global=false --location=user --workspaces=false
printf 'npm registry (user config): %s\n' "$fast_registry"
printf '%s\n' 'Project .npmrc, scoped registries, environment variables and CLI options may override this setting.'
