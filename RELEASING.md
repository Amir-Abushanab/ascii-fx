# Releasing

Versioning and publishing are driven by [changesets](https://github.com/changesets/changesets).
Three workflows do the work: `ci.yml` gates every push and deploys the docs, `version.yml` opens
the Version PR, and `release.yml` publishes the packages.

## The normal loop

1. Write a changeset with the change:

   ```sh
   pnpm changeset
   ```

   Pick the packages and bump levels, and describe the change the way you would in a changelog —
   the text lands verbatim in `CHANGELOG.md` and in the GitHub Release.

2. Merge to `main`. `version.yml` opens (or updates) a **"chore: version packages"** PR that bumps
   versions, writes changelogs, and syncs the skill's `metadata.library_version`. It runs on pushes
   that touch `packages/**` or `.changeset/**`, and never publishes.

3. Merge that PR. The merge changes `packages/**/CHANGELOG.md`, which triggers `release.yml`: it
   publishes every package version npm does not already have, tags each one, and cuts the GitHub
   Releases. A changeset that landed after the PR was last versioned is removed from that run's
   checkout so the merged versions go out; `version.yml` versions it into the next PR.

The two workflows have separate concurrency groups (`version` and `release`), and neither cancels
a run in progress. GitHub keeps only the newest pending run per group and cancels the one before
it, so when versioning and publishing shared a group, a feature push carrying changesets could
cancel a waiting publish and then publish nothing itself. Now only Version PR merges queue for
`release`.

Publishing waits for CI on the same commit: `release.yml`'s first job polls the `ci.yml` run for
that commit and goes on only once both check & build jobs and coverage have passed (the audit gates
nothing, here as in CI). A release therefore lands a few minutes after the merge rather than
before CI finishes. If CI fails, nothing is published; if a newer push cancels that CI run, the
release stops and says so — re-run CI on the commit, then re-run the release run. Versioning does
not wait for CI. The release no longer soft-fails, so a failed publish shows as a red run.

The Version PR's own CI is started by `version.yml`. The branch is pushed with the workflow's
`GITHUB_TOKEN`, and GitHub runs no workflow for an event that token makes, so the PR's
`pull_request` run fails straight away with zero jobs. The version job dispatches `ci.yml` on the
branch instead; those checks sit on the branch head and show on the PR. The zero-job failure may
still be listed beside them, and can be ignored.

Nothing publishes without a changeset, and a docs-only or benchmark-only push skips both workflows
via their `paths` filters.

## One-time setup

**GitHub Pages.** Repo Settings → Pages → Source: **GitHub Actions**. The docs deploy is a job in
`ci.yml`, gated on `check`, so a red suite cannot ship the showcase.

**npm, first publish.** npm cannot do a package's _first_ publish over OIDC, so 0.1.0 has to go up
from a laptop:

```sh
npm login
pnpm release          # builds, then publishes only what npm is missing
```

`release.yml`'s preflight job checks whether `@ascii-fx/core` exists on npm and publishes nothing
until it does, so runs before this stay green rather than failing on a missing package.
`version.yml` keeps managing Version PRs meanwhile.

**Trusted Publishing.** On each `@ascii-fx/*` package's npm settings, add a Trusted Publisher
pointing at this repo and the `release.yml` workflow. `release.yml` is still the publisher;
`version.yml` never publishes and needs no Trusted Publisher. After that CI publishes with no
stored token, with provenance attached. If OIDC misbehaves, add an `NPM_TOKEN` secret and uncomment
the `NODE_AUTH_TOKEN` line in the `env` of `release.yml`'s Publish step.

## Scripts

| Script               | What it does                                                                                                                                                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`         | The gate: build, format, lint, typecheck, node tests, browser-cpu tests, knip, depcruise, skill validation + staleness. Also the pre-commit hook.                                                                                                                                                                 |
| `pnpm quality`       | `check` plus `pnpm audit --audit-level low`. Local only — CI audits at `high` in a job that gates nothing, because an advisory lands with no change on our side and should not red-light an unrelated PR.                                                                                                         |
| `pnpm run version`   | `changeset version` + sync the skill version. Needs `run` — bare `pnpm version` is pnpm's own built-in. Needs `GITHUB_TOKEN` too (the changelog plugin resolves commits and authors via the API); `GITHUB_TOKEN=$(gh auth token) pnpm run version` works locally. Normally the version workflow's job, not yours. |
| `pnpm package:check` | publint + are-the-types-wrong + smoke, on every packed tarball (see below). Needs a build first.                                                                                                                                                                                                                  |
| `pnpm release`       | Build, `package:check`, then publish only the versions npm is missing.                                                                                                                                                                                                                                            |

`pnpm package:check` is the published-shape gate, and it is three tools because they check different
things. [publint](https://publint.dev) reads the **manifest**: that every `exports` path lands on a
file the tarball actually contains, that `files[]` is not missing something, that the `type` and the
extensions agree. [are-the-types-wrong](https://arethetypeswrong.github.io) resolves the **types**
the way each consumer's TypeScript would, which is the failure publint cannot see — a `.d.ts` that
exists but does not describe the JS beside it, or an entry point reachable in one module mode and
not another. It runs with `--profile esm-only`: these packages are ESM-only on purpose, so the
node10 and require-from-CJS failures are expected and ignored, while a real types regression in the
modes that matter still fails the run. Neither one executes a line, though, so `scripts/smoke-packages.mjs`
runs last: it packs every package, installs the tarballs into a throwaway **npm** project — no
workspace links, no access to our store, resolving exactly as a stranger's install would — and then
imports each entry point in bare Node and puts the Node-capable ones through real work. Nothing else
in the repo imports `dist/` at all, so this is the only step that would notice a package that packs
perfectly and throws on import. CI runs all three after `pnpm build`; `pnpm release` runs them
before publishing.

`scripts/publish-if-needed.mjs` drives `pnpm publish` per package rather than `changeset publish`,
which cannot be trusted against npm 11: its pre-publish check misreads an already-published package
as missing, tries to republish, and crashes on the E403 before printing the `New tag:` lines
`changesets/action` needs — leaving the packages on npm but the job red with no tags or Releases.
The script publishes only what the registry confirms is absent, and restores tags for any version
that reached npm without one.

## Before a release

`pnpm test:gpu` is not in `pnpm check` and does not run in CI, because a GitHub runner
reports a software adapter that passes every availability guard and then dies partway
through the workload. It is the suite that proves the GPU matcher agrees with the CPU
oracle bit-for-bit, so run it on a machine with a real adapter before cutting a release:

```sh
pnpm test:gpu
```

`.githooks/pre-push` runs it for you on any push that touches `packages/`, so in practice
you only reach for the command above when you want it on its own. The hook cannot gate a
release directly — release.yml publishes from a runner, not from a laptop — but it does
not need to: the changesets "Version Packages" PR only touches `package.json`,
`CHANGELOG.md` and `.changeset/`, so matcher code reaches main only through a push that
went through the hook.

It fails rather than passes when the machine has no real adapter. `describe.runIf` means
an adapterless run executes none of the suite and still exits 0 — 15 passed, 50 skipped,
green and worthless — so the hook reads the `no adapter` placeholder's own state and
treats a _passing_ one as a failure. `SKIP_GPU_TESTS=1 git push` or `--no-verify` overrides
it.

What the hook does not cover is a contributor whose machine has no adapter and who
overrides it. If you want that closed too, point the check job at a self-hosted GPU
runner; nothing else about the workflow has to change.

## Notes

- Every `@ascii-fx/*` package is one `fixed` group in `.changeset/config.json`, so they always
  release together on one version number. Pre-1.0 the major is stuck at 0 and the minor is what
  signals a breaking change, so locking the whole version — not just the major — is what makes a
  set readable at a glance. It also matters that the internal deps are `workspace:*`, which pnpm
  publishes as exact pins: mixed versions put two copies of `@ascii-fx/core` in a consumer's tree,
  and core owns the profile fingerprints and the frame codec, so two instances is a real fault.
  Untouched packages still get a changelog entry naming the dependency bump that carried them.
- `@ascii-fx-internal/*` (docs, benchmarks) are in `ignore` and never publish.
- Run `pnpm changeset status` to see what a release would bump.
