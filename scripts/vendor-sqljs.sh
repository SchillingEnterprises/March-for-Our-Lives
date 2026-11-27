#!/usr/bin/env bash
set -euo pipefail

readonly SQL_JS_VERSION="1.17.0"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly OUTPUT_DIR="$REPO_ROOT/vendor/sql.js"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

archive_name="$(npm pack --silent --ignore-scripts --pack-destination "$temporary_directory" "sql.js@${SQL_JS_VERSION}")"
archive_path="$temporary_directory/$archive_name"
package_directory="$temporary_directory/package"

if [[ ! -f "$archive_path" ]]; then
  echo "npm pack did not produce the expected sql.js archive." >&2
  exit 1
fi

tar -xzf "$archive_path" -C "$temporary_directory"
runtime_source="$package_directory/dist/sql-wasm-inline.js"
license_source="$package_directory/LICENSE"

if [[ ! -s "$runtime_source" || ! -s "$license_source" ]]; then
  echo "The pinned sql.js package is missing its inline runtime or license." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
install -m 0644 "$runtime_source" "$OUTPUT_DIR/sql-wasm-inline.js"
install -m 0644 "$license_source" "$OUTPUT_DIR/LICENSE"

echo "Vendored sql.js ${SQL_JS_VERSION} inline WebAssembly runtime and MIT license."
