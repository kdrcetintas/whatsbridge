#!/bin/bash
set -e

REPO="kdrcetintas/whatsbridge"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  darwin) OS="macos" ;;
  linux)  OS="linux" ;;
  *) echo "Unsupported OS: $OS" && exit 1 ;;
esac

case "$ARCH" in
  x86_64)        ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" && exit 1 ;;
esac

# Get latest version
VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep '"tag_name"' | sed 's/.*"tag_name": "\(.*\)".*/\1/')

if [ -z "$VERSION" ]; then
  echo "Could not fetch latest version." && exit 1
fi

FILENAME="whatsbridge-${VERSION}-${OS}-${ARCH}"
URL="https://github.com/$REPO/releases/download/$VERSION/$FILENAME"

echo "Downloading WhatsBridge $VERSION..."
curl -fL "$URL" -o whatsbridge
chmod +x whatsbridge
echo "Done. Run ./whatsbridge init to get started."
