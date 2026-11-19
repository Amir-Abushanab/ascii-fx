---
'@ascii-fx/react': patch
---

- **DOM attributes reach the wrapper.** `<AsciiImage>`, `<AsciiVideo>` and `<AsciiCanvas>` now pass anything a `<div>` takes — `id`, `data-*`, `aria-*`, `role`, `title`, `tabIndex`, event handlers — to their wrapper element. They used to be handed to the renderer as options, where they did nothing. `onError` keeps its meaning (the renderer failing).
- **`<AsciiImage draw>`:** a second `load` event on the same element (a responsive image choosing another candidate) no longer leaves the first buffer and its animation loop running behind the new one.
