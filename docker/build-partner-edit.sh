#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
git diff --quiet
git diff --cached --quiet
git verify-commit HEAD
git diff --quiet v3.4.1 -- package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs server/package.json packages/plugin-core packages/plugin-sdk
source_commit=$(git rev-parse HEAD)
base_image=${BASE_IMAGE:-ghcr.io/immich-app/immich-server@sha256:7c489add298fc2f92cda4c777de6462aa206877e04087b815f62c7664af0b53b}
if ! docker image inspect "$base_image" >/dev/null 2>&1; then
  docker image pull "$base_image"
fi
expected_id=sha256:4351dd621899ecc8ed317ae87cdcaeb968ec8ba4f9d8053d913a73eb6f6dd7c2
[[ $(docker image inspect --format '{{.Id}}' "$base_image") == "$expected_id" ]]
mise exec -- pnpm install --frozen-lockfile
mise //:plugins
mise //server:build
mise //web:build
DOCKER_BUILDKIT=1 docker build --file docker/Dockerfile.partner-edit \
  --build-arg BASE_IMAGE="$base_image" --build-arg BUILD_SOURCE_COMMIT="$source_commit" \
  --tag ghcr.io/hawkab/immich-server:v3.4.1-partner-edit.1 .
docker image inspect --format '{{.Id}}' ghcr.io/hawkab/immich-server:v3.4.1-partner-edit.1
