---
'@ascii-fx/core': patch
---

`frameToSVG` escapes double quotes in `font-family`. The family comes from the profile's metadata (or the `fontFamily` option), and a quote in it closed the attribute, so a crafted `.asciip` could add attributes of its own — an `onmouseover`, say — to an SVG that was later inlined into a page. If you render SVG from profiles you did not build, upgrade.
