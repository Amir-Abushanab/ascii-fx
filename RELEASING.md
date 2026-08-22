# Releasing

Versioning and publishing are driven by [changesets](https://github.com/changesets/changesets).
Two workflows do the work: `ci.yml` gates every push and deploys the docs, `release.yml` versions
and publishes the packages.

## The normal loop

1. Write a changeset with the change:

   ```sh
   pnpm changeset
   ```

   Pick the packages and bump levels, and describe the change the way you would in a changelog —
   the text lands verbatim in `CHANGELOG.md` and in the GitHub Release.

2. Merge to `main`. `release.yml` opens (or updates) a **"chore: version packages"** PR that bumps
   versions, writes changelogs, and syncs the skill's `metadata.library_version`.

3. Merge that PR. The same workflow publishes every package version npm does not already have,
   tags each one, and cuts the GitHub Releases.

Nothing publishes without a changeset, and a docs-only or benchmark-only push skips `release.yml`
entirely via its `paths` filter.

## One-time setup

**GitHub Pages.** Repo Settings → Pages → Source: **GitHub Actions**. The docs deploy is a job in
`ci.yml`, gated on `check`, so a red suite cannot ship the showcase.

**npm, first publish.** npm cannot do a package's _first_ publish over OIDC, so 0.1.0 has to go up
from a laptop:

```sh
npm login
pnpm release          # builds, then publishes only what npm is missing
```

`release.yml`'s preflight job checks whether `@ascii-fx/core` exists on npm and manages Version PRs
only until it does, so runs before this stay green rather than failing on a missing package.

**Trusted Publishing.** On each `@ascii-fx/*` package's npm settings, add a Trusted Publisher
pointing at this repo and the `release.yml` workflow. After that CI publishes with no stored token,
with provenance attached. If OIDC misbehaves, add an `NPM_TOKEN` secret and uncomment the
`NODE_AUTH_TOKEN` line in `release.yml`.

## Scripts

| Script               | What it does                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`         | The gate: format, lint, typecheck, node tests, GPU browser tests, knip, depcruise, skill validation + staleness. Also the pre-commit hook.                                                                |
| `pnpm quality`       | `check` plus `pnpm audit --audit-level low`. Local only — CI audits at `high` in a job that gates nothing, because an advisory lands with no change on our side and should not red-light an unrelated PR. |
| `pnpm version`       | `changeset version` + sync the skill version. Run by the release workflow, not by hand.                                                                                                                   |
| `pnpm package:check` | publint + are-the-types-wrong + smoke, on every packed tarball (see below). Needs a build first.                                                                                                          |
| `pnpm release`       | Build, `package:check`, then publish only the versions npm is missing.                                                                                                                                    |

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
