# Security Policy

## Reporting a vulnerability

Report privately through GitHub: **[Security → Report a vulnerability](https://github.com/Amir-Abushanab/ascii-fx/security/advisories/new)**.
That opens a draft advisory only you and the maintainers can see. Please do not open a
public issue for anything you believe is exploitable.

Useful things to include: the package and version, whether the input reaching the
vulnerable code is attacker-controlled in your setup, and a profile, frame, or source
image that reproduces it. A failing snippet is worth more than a description.

Expect an acknowledgement within a few days. Because this is a personal project rather
than a funded one, a fix timeline is best-effort and will be agreed with you in the
advisory thread rather than promised here. Credit is offered by default; say so if you
would rather not be named.

## Supported versions

Pre-1.0, only the latest published `0.x` release gets fixes. Every `@ascii-fx/*` package
releases on one shared version number, so a security release bumps them together.

| Version        | Supported |
| -------------- | --------- |
| latest `0.x`   | ✅        |
| anything older | ❌        |

## What is actually attack surface

Most of this library is arithmetic over pixel buffers, which is not where problems tend
to live. Reports touching these are the ones most likely to be real:

- **The `.asciip` and `.asciif` decoders** (`decodeProfile`, `decodeFrame`, `loadProfile`,
  `loadFrame` in `@ascii-fx/core`). These parse untrusted binary. Length fields, offsets
  and glyph counts read from a file decide how much gets allocated and indexed — a
  malformed input causing an out-of-bounds read, an unbounded allocation, or a hang is a
  vulnerability, not a bug report. `decodeFrame` also refuses a frame whose profile
  fingerprint does not match; a way around that check is in scope.
- **`@ascii-fx/compiler` font rasterization**, which runs `fontkit` over a font file. If
  you build profiles from fonts your users upload, that font is untrusted input.
- **`@ascii-fx/vite`**, which runs at build time and reads paths from config. Path
  traversal out of the project root is in scope.

Out of scope: anything requiring the attacker to already control the page (the renderer
runs entirely client-side with no network or storage access of its own), WebGPU driver
and browser bugs reachable through ordinary shader use — report those upstream — and
denial of service from a source image you deliberately sized to exhaust memory.

## Supply chain

Dependencies are held to a 7-day `minimumReleaseAge` in `pnpm-workspace.yaml`, enforced
at install and re-checked on every `--frozen-lockfile` install in CI, so a compromised
release has a week to be caught and yanked before it can enter the lockfile. Publishing
uses npm Trusted Publishing over OIDC with provenance attached and no long-lived token.
`pnpm audit --audit-level high` runs on every CI push.
