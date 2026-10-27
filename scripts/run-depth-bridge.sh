#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BRIDGE_SOURCE="$ROOT_DIR/native/realsense_depth_bridge.cpp"
BRIDGE_BINARY="$ROOT_DIR/.cache/realsense-depth-bridge"

mkdir -p "$ROOT_DIR/.cache"
if [ ! -x "$BRIDGE_BINARY" ] || [ "$BRIDGE_SOURCE" -nt "$BRIDGE_BINARY" ]; then
  if ! command -v brew >/dev/null 2>&1 || ! brew list --versions librealsense >/dev/null 2>&1; then
    echo "librealsense2 development files are required. Install with: brew install librealsense" >&2
    exit 1
  fi
  SDK_PREFIX=$(brew --prefix librealsense)
  c++ -std=c++17 -O2 -I"$SDK_PREFIX/include" "$BRIDGE_SOURCE" -o "$BRIDGE_BINARY" \
    -L"$SDK_PREFIX/lib" -Wl,-rpath,"$SDK_PREFIX/lib" -lrealsense2 -pthread
fi

echo "macOS may ask for your administrator password so librealsense can access the USB depth sensor."
exec sudo "$BRIDGE_BINARY"
