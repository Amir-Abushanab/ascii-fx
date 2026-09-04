#!/usr/bin/env node
/**
 * Guarded publish: publishes only the package versions npm doesn't already have, driving
 * `pnpm publish` directly rather than `changeset publish`.
 *
 * @changesets/cli 2.31 is broken against the npm 11 the release workflow installs for OIDC trusted
 * publishing. Its pre-publish check misreads npm 11 and thinks an already-published package (e.g.
 * @ascii-fx/vite holding at 0.1.1 while core/gpu/adapters bump) is unpublished, tries to publish over
 * it, then crashes on npm 11's E403 JSON (`Cannot read properties of undefined (reading 'includes')`)
 * — aborting *before* it prints the `New tag:` lines changesets/action relies on. The packages still
 * reach npm, but the job goes red with no git tags and no GitHub Releases.
 *
 * `changeset publish` is itself only a wrapper around `pnpm publish` (which rewrites workspace: deps
 * and performs npm OIDC trusted publishing) plus a local `git tag` per published package, so we do
 * both directly — but only for versions the registry confirms are missing, so we never provoke the
 * E403.
 *
 * Telling changesets/action what shipped is a separate contract, and the one this script got wrong
 * for three releases. v1 scanned stdout for `New tag:` lines. v2 does not read stdout at all: it
 * creates an ndjson file, hands the path over as CHANGESETS_OUTPUT, and after this script exits
 * reads one `{ packageName, tag }` object per line — that list is what it pushes tags for and cuts
 * GitHub Releases from. Printing `New tag:` and writing nothing to that file is exactly how 0.4.0,
 * 0.4.1 and 0.5.0 reached npm with no tag and no Release while the job stayed green. So every tag
 * we make is recorded there as well as printed; the printing is now only for the log.
 *
 * The tag must also exist in this checkout, because the action runs `git push origin <tag>` for
 * each line rather than creating it.
 *
 * Also self-heals: an already-on-npm version whose git tag never made it to origin (a past run
 * that published, then died before tags were pushed) gets its tag and `New tag:` line restored,
 * so no release stays tagless by accident. Versions listed in NEVER_RESTORE are exempt — see
 * restoreMissingTags.
 *
 * Run via `pnpm release`, which builds the packages first. Pass `--dry-run` to preview.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dryRun = process.argv.includes('--dry-run')
const packagesDir = new URL('../packages/', import.meta.url)

/** Every non-private package under packages/, with its directory. */
function publishablePackages() {
  const out = []
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    let pkg
    try {
      pkg = JSON.parse(readFileSync(new URL(`${entry.name}/package.json`, packagesDir), 'utf8'))
    } catch {
      continue // no readable package.json in this directory
    }
    if (pkg.private || !pkg.name || !pkg.version) continue
    out.push({
      name: pkg.name,
      version: pkg.version,
      dir: fileURLToPath(new URL(`${entry.name}/`, packagesDir)),
    })
  }
  return out
}

/** Is this exact name@version already on the npm registry? */
function isPublished(name, version) {
  try {
    // --prefer-online revalidates npm's HTTP cache instead of trusting a possibly-stale local
    // packument, so a version published moments ago is still seen.
    const raw = execFileSync('npm', ['view', name, 'versions', '--json', '--prefer-online'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let versions = JSON.parse(raw)
    if (!Array.isArray(versions)) versions = [versions] // single-version packages come back as a bare string
    return versions.includes(version)
  } catch (err) {
    const stderr = String(err?.stderr ?? '')
    if (stderr.includes('E404') || stderr.includes('404')) return false // genuinely not on npm
    // Network / registry / auth hiccup is not evidence the version is unpublished — fail loudly
    // rather than trigger a bogus publish.
    throw err
  }
}

/**
 * Tell changesets/action about a tag we made, on the channel it actually reads.
 *
 * Appended rather than rewritten: publish and tag-restore both call this, and the action reads the
 * file once after we exit. Absent when the script is run by hand (`pnpm release` locally, or
 * --dry-run), where there is no action to tell.
 */
function recordTag(packageName, tag) {
  const out = process.env.CHANGESETS_OUTPUT
  if (!out) return
  try {
    appendFileSync(out, `${JSON.stringify({ packageName, tag })}\n`)
  } catch (err) {
    // Loud, but not fatal: the packages are already on npm by this point, and failing the run
    // would not un-publish them. A missing tag is recoverable on the next run; a red job that
    // published anyway is the state this whole script exists to avoid.
    console.error(`warning: could not record ${tag} in CHANGESETS_OUTPUT: ${String(err)}`)
  }
}

/** Annotated tag at HEAD, like `changeset publish` makes; a pre-existing tag only warns. */
function ensureLocalTag(tag) {
  try {
    execFileSync('git', ['tag', tag, '-m', tag], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (err) {
    console.error(`warning: could not create git tag ${tag}: ${String(err?.stderr ?? err)}`)
  }
}

/**
 * Versions deliberately left untagged. Restoring a tag pins it to whatever commit the run happens
 * to check out, not the commit the version was cut from — so for a version whose release commit is
 * no longer identifiable, a restore would put seven tags and seven GitHub Releases on the wrong
 * one. An inaccurate tag is worse than no tag, so these stay absent by choice rather than by
 * accident. Every package shares one version (the `fixed` group in .changeset/config.json), so one
 * entry covers all seven.
 *
 * - 0.2.0 — published from a laptop before this pipeline worked.
 * - 0.4.0, 0.4.1 — lost their tags to the CHANGESETS_OUTPUT mismatch above. They are far enough
 *   back that the restore would land them on a commit that has nothing to do with either release.
 *   0.5.0 hit the same bug but was tagged by hand at its real release commit, so it needs no
 *   restore and is not listed.
 */
const NEVER_RESTORE = new Set(['0.2.0', '0.4.0', '0.4.1'])

/**
 * A version can be live on npm yet have no git tag or GitHub Release: a previous run published,
 * then died before changesets/action pushed the tags (0.3.0 lost its tags to the changesets↔npm 11
 * crash, 0.4.x and 0.5.0 to the CHANGESETS_OUTPUT mismatch), or the first publish ran from a
 * laptop. Such a version never re-enters `pending`, so without this pass its tag would stay lost on
 * every future run. Re-create it here (at this run's commit — the original release commit isn't
 * knowable) and record it, so changesets/action pushes it and cuts the Release. Never fails the
 * run.
 */
function restoreMissingTags(onNpm) {
  if (onNpm.length === 0) return
  let remote
  try {
    const raw = execFileSync('git', ['ls-remote', '--tags', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    remote = new Set(
      raw
        .split('\n')
        .map((line) => line.split('\t')[1])
        .filter(Boolean)
        .map((ref) => ref.replace('refs/tags/', '').replace(/\^\{\}$/, '')),
    )
  } catch (err) {
    console.error(
      `warning: could not list origin tags, skipping tag restore: ${String(err?.stderr ?? err)}`,
    )
    return
  }
  for (const p of onNpm) {
    const tag = `${p.name}@${p.version}`
    if (remote.has(tag) || NEVER_RESTORE.has(p.version)) continue
    if (dryRun) {
      console.log(`(dry run) would restore missing tag ${tag}`)
      continue
    }
    console.log(`Restoring missing tag for already-published ${tag}`)
    ensureLocalTag(tag)
    recordTag(p.name, tag)
    console.log(`New tag: ${tag}`)
  }
}

const pkgs = publishablePackages()
const label = (list) => list.map((p) => `${p.name}@${p.version}`).join(', ')
const pending = pkgs.filter((p) => !isPublished(p.name, p.version))

restoreMissingTags(pkgs.filter((p) => !pending.includes(p)))

if (pending.length === 0) {
  console.log(`Nothing to publish. Already on npm: ${label(pkgs)}`)
  process.exit(0)
}

console.log(`Publishing: ${label(pending)}`)
if (dryRun) {
  console.log('(dry run) skipping publish')
  process.exit(0)
}

const published = []
const failed = []
for (const p of pending) {
  try {
    // The same call `changeset publish` makes for a pnpm workspace: from the package dir (so
    // workspace: deps get rewritten), --access public per .changeset/config.json, and
    // --no-git-checks so pnpm doesn't balk at CI's git state. Provenance + npm OIDC trusted
    // publishing come from the workflow env (NPM_CONFIG_PROVENANCE, id-token).
    execFileSync('pnpm', ['publish', '--access', 'public', '--no-git-checks'], {
      cwd: p.dir,
      stdio: 'inherit',
    })
    // changesets/action will `git push origin <tag>`, so the tag must exist locally.
    const tag = `${p.name}@${p.version}`
    ensureLocalTag(tag)
    recordTag(p.name, tag)
    console.log(`New tag: ${tag}`)
    published.push(p)
  } catch {
    // A non-zero exit is benign only if the version is already on npm (our pre-check raced a
    // concurrent publish, or misfired); anything else is a real publish failure.
    if (isPublished(p.name, p.version)) {
      console.error(`${p.name}@${p.version} is already on npm — skipping.`)
    } else {
      failed.push(p)
    }
  }
}

if (failed.length > 0) {
  console.error(`Failed to publish: ${label(failed)}`)
  process.exit(1)
}
console.log(`Published: ${label(published)}`)
