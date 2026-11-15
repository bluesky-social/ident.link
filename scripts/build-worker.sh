#!/bin/sh
set -eu

# Workers Builds does not include Rust or worker-build in its build image.
# Keep local builds using the tools developers have already installed.
if [ "${WORKERS_CI:-}" = "1" ]; then
  export CARGO_HOME="$HOME/.cargo"
  export RUSTUP_HOME="$HOME/.rustup"
  export PATH="$CARGO_HOME/bin:$PATH"

  if ! command -v rustup >/dev/null 2>&1; then
    installer=$(mktemp)
    trap 'rm -f "$installer"' EXIT
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o "$installer"
    sh "$installer" -y --no-modify-path --profile minimal --default-toolchain none
  fi

  rustup toolchain install 1.98.1 --profile minimal --target wasm32-unknown-unknown
  export RUSTUP_TOOLCHAIN=1.98.1
  cargo install worker-build --version 0.9.0 --locked --bin worker-build
fi

cd worker
exec worker-build --release
