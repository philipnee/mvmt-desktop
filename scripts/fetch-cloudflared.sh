#!/usr/bin/env bash
# Download cloudflared binaries into vendor/cloudflared/<platform-arch>/cloudflared
# so they get bundled by electron-builder via extraResources.
#
# By default fetches the host platform only. Pass `all` to fetch every target
# (darwin-arm64, darwin-amd64, linux-amd64, linux-arm64, win-amd64).

set -euo pipefail

VERSION="${CLOUDFLARED_VERSION:-2025.5.0}"
DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${DESKTOP_DIR}/vendor/cloudflared"

# Map of <platform-arch> => <github-asset-suffix>
declare -a TARGETS

if [ "${1:-}" = "all" ]; then
  TARGETS=(darwin-arm64 darwin-amd64 linux-amd64 linux-arm64 win-amd64)
else
  HOST_OS=""; HOST_ARCH=""
  case "$(uname -s)" in
    Darwin) HOST_OS="darwin" ;;
    Linux) HOST_OS="linux" ;;
    *) echo "Unsupported host OS: $(uname -s). Pass 'all' or run on macOS/Linux." >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) HOST_ARCH="arm64" ;;
    x86_64|amd64) HOST_ARCH="amd64" ;;
    *) echo "Unsupported host arch: $(uname -m)." >&2; exit 1 ;;
  esac
  TARGETS=("${HOST_OS}-${HOST_ARCH}")
fi

asset_url () {
  local target="$1"
  case "$target" in
    darwin-arm64) echo "cloudflared-darwin-arm64.tgz" ;;
    darwin-amd64) echo "cloudflared-darwin-amd64.tgz" ;;
    linux-amd64)  echo "cloudflared-linux-amd64" ;;
    linux-arm64)  echo "cloudflared-linux-arm64" ;;
    win-amd64)    echo "cloudflared-windows-amd64.exe" ;;
    *) echo "" ;;
  esac
}

mkdir -p "${OUT_DIR}"

for target in "${TARGETS[@]}"; do
  asset="$(asset_url "${target}")"
  if [ -z "${asset}" ]; then
    echo "Skipping unknown target ${target}"
    continue
  fi
  dest_dir="${OUT_DIR}/${target}"
  mkdir -p "${dest_dir}"
  url="https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${asset}"
  bin_path="${dest_dir}/cloudflared"
  [ "${target}" = "win-amd64" ] && bin_path="${dest_dir}/cloudflared.exe"

  if [ -x "${bin_path}" ]; then
    echo "${target}: already present, skipping"
    continue
  fi

  echo "Fetching ${asset} (${VERSION}) → ${dest_dir}"
  tmp="$(mktemp -d)"
  case "${asset}" in
    *.tgz)
      curl -fL -o "${tmp}/asset.tgz" "${url}"
      tar -xzf "${tmp}/asset.tgz" -C "${tmp}"
      mv "${tmp}/cloudflared" "${bin_path}"
      ;;
    *.exe)
      curl -fL -o "${bin_path}" "${url}"
      ;;
    *)
      curl -fL -o "${bin_path}" "${url}"
      chmod +x "${bin_path}"
      ;;
  esac
  rm -rf "${tmp}"
  echo "${target}: $(${bin_path} --version 2>/dev/null | head -n1 || echo done)"
done

echo "cloudflared binaries available under ${OUT_DIR}"
