---
'@ascii-fx/core': patch
---

`decodeProfile` rejects a profile whose `fontFamily` or `fontWeight` metadata is the wrong type, and `frameToSVG` falls back to `monospace` for one built in memory. A non-string `fontFamily` made `frameToSVG` throw.
