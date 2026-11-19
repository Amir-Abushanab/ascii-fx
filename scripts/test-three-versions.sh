#!/bin/sh
# Run @ascii-fx/three's browser suites against other three releases.
#
# The package reaches three's GPUDevice through `renderer.backend`, which three does not
# document, and its peer range goes back further than the one version the devDependency
# pins. CI cannot check the rest: the suite needs a real GPU (RELEASING.md). So this is the
# check, run by hand on a machine with an adapter before a release that touches
# packages/three, or before moving the peer range.
#
#   pnpm test:three-versions                 # the floor and the two boundaries
#   pnpm test:three-versions 0.190.0         # anything else
#
# It installs each version into packages/three, runs the suites, and puts package.json and
# the lockfile back however it ends.
set -u

# r170 is the peer floor; r174 is where setOutputRenderTarget appears (unusable until
# r178, see asciiPass.ts); r178 is the first release rendered through the output pass.
versions="${*:-0.170.0 0.174.0 0.178.0}"

if ! git diff --quiet -- packages/three/package.json pnpm-lock.yaml; then
  echo "packages/three/package.json or pnpm-lock.yaml has uncommitted changes; commit or stash them first." >&2
  exit 1
fi

restore() {
  git checkout -q -- packages/three/package.json pnpm-lock.yaml
  pnpm install --silent >/dev/null 2>&1 || pnpm install
}
trap restore EXIT INT TERM

failed=""
for v in $versions; do
  echo "== three@$v"
  if ! pnpm --filter @ascii-fx/three add -D "three@$v" >/dev/null 2>&1; then
    echo "   could not install three@$v"
    failed="$failed $v"
    continue
  fi
  if pnpm exec vitest run --project gpu-conformance packages/three &&
    pnpm exec vitest run --project browser-cpu packages/three; then
    echo "   three@$v passed"
  else
    failed="$failed $v"
  fi
done

if [ -n "$failed" ]; then
  echo "FAILED on:$failed" >&2
  exit 1
fi
echo "all passed: $versions"
