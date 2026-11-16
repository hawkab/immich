#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
git diff --quiet
git diff --cached --quiet
git verify-commit HEAD
source_commit=$(git rev-parse HEAD)
recipe=server/Dockerfile
base_image=${BASE_IMAGE:-ghcr.io/immich-app/immich-server@sha256:7c489add298fc2f92cda4c777de6462aa206877e04087b815f62c7664af0b53b}
if git diff --quiet v3.4.1 -- package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs server/package.json packages/plugin-core packages/plugin-sdk; then
  recipe=docker/Dockerfile.partner-edit
  if ! docker image inspect "$base_image" >/dev/null 2>&1; then
    docker image pull "$base_image"
  fi
  expected=0c994058ddf18432a03544be3c3bf79aa748a30a0a91d6d4f559335cedf13ef8
  actual=$(docker image inspect --format '{{json .}}' "$base_image" | python3 docker/image-identity.py)
  [[ "$actual" == "$expected" ]]
  mise exec -- pnpm install --frozen-lockfile
  mise //:plugins
  mise //server:build
  mise //web:build
fi
DOCKER_BUILDKIT=1 docker build --file "$recipe" \
  --build-arg BASE_IMAGE="$base_image" --build-arg BUILD_SOURCE_COMMIT="$source_commit" \
  --build-arg BUILD_SOURCE_REF=v3.4.1-partner-edit.3 --build-arg BUILD_IMAGE=v3.4.1-partner-edit.3 \
  --tag ghcr.io/hawkab/immich-server:v3.4.1-partner-edit.3 .
docker image inspect --format '{{json .}}' ghcr.io/hawkab/immich-server:v3.4.1-partner-edit.3 | python3 docker/image-identity.py
