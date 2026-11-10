#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BRIDGE_SOURCE="$ROOT_DIR/native/realsense_depth_bridge.cpp"
BRIDGE_BINARY="$ROOT_DIR/.cache/realsense-depth-bridge"

mkdir -p "$ROOT_DIR/.cache"
if command -v brew >/dev/null 2>&1 && brew list --versions librealsense >/dev/null 2>&1; then
  SDK_PREFIX=$(brew --prefix librealsense)
  if [ ! -x "$BRIDGE_BINARY" ] || [ "$BRIDGE_SOURCE" -nt "$BRIDGE_BINARY" ]; then
    c++ -std=c++17 -O2 -I"$SDK_PREFIX/include" "$BRIDGE_SOURCE" -o "$BRIDGE_BINARY" \
      -L"$SDK_PREFIX/lib" -Wl,-rpath,"$SDK_PREFIX/lib" -lrealsense2 -pthread
  fi
  echo "macOS may ask for your administrator password so librealsense can access the USB depth sensor."
  exec sudo "$BRIDGE_BINARY"
elif command -v pkg-config >/dev/null 2>&1 && pkg-config --exists realsense2; then
  if [ ! -x "$BRIDGE_BINARY" ] || [ "$BRIDGE_SOURCE" -nt "$BRIDGE_BINARY" ]; then
    c++ -std=c++17 -O2 "$BRIDGE_SOURCE" -o "$BRIDGE_BINARY" \
      $(pkg-config --cflags --libs realsense2) -pthread
  fi
  exec "$BRIDGE_BINARY"
else
  echo "librealsense2 development files are required. Install them with Homebrew on macOS or your Linux distribution's package manager." >&2
  exit 1
fi
