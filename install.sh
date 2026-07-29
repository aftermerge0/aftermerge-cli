#!/bin/sh
# Installs the aftermerge CLI as a standalone binary — no Bun runtime
# required. Downloads the latest GitHub release asset matching this
# machine's OS/arch.
#
#   curl -fsSL https://raw.githubusercontent.com/aftermerge0/aftermerge-cli/main/install.sh | sh
set -eu

REPO="aftermerge0/aftermerge-cli"
INSTALL_DIR="${AFTERMERGE_INSTALL_DIR:-$HOME/.aftermerge/bin}"

os() {
  case "$(uname -s)" in
    Darwin) echo darwin ;;
    Linux) echo linux ;;
    *)
      echo "error: unsupported OS '$(uname -s)' — no prebuilt binary. See SETUP.md to run from source with Bun instead." >&2
      exit 1
      ;;
  esac
}

arch() {
  case "$(uname -m)" in
    x86_64 | amd64) echo x64 ;;
    arm64 | aarch64) echo arm64 ;;
    *)
      echo "error: unsupported architecture '$(uname -m)' — no prebuilt binary. See SETUP.md to run from source with Bun instead." >&2
      exit 1
      ;;
  esac
}

OS="$(os)"
ARCH="$(arch)"

if [ "$OS" = "darwin" ] && [ "$ARCH" = "x64" ]; then
  echo "error: no prebuilt binary for Intel Macs (GitHub's Intel-Mac Actions runners aren't reliably available). Use 'bun link' or run from source instead — see SETUP.md." >&2
  exit 1
fi

ASSET="aftermerge-$OS-$ARCH"
URL="https://github.com/$REPO/releases/latest/download/$ASSET"

echo "Downloading $ASSET..."
mkdir -p "$INSTALL_DIR"
curl -fsSL "$URL" -o "$INSTALL_DIR/aftermerge"
chmod +x "$INSTALL_DIR/aftermerge"

echo "Installed to $INSTALL_DIR/aftermerge"

case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    echo "Run 'aftermerge --version' to verify."
    ;;
  *)
    echo
    echo "$INSTALL_DIR is not on your PATH yet. Add this to your shell profile" \
      "(~/.zshrc, ~/.bashrc, etc.), then restart your shell:"
    echo
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac
