---
'@ascii-fx/react': patch
---

`<AsciiImage draw>`: a second `load` event on the same element (a responsive image choosing another candidate) no longer leaves the first buffer and its animation loop running behind the new one.
