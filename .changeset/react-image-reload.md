---
'@ascii-fx/react': minor
---

- **Breaking: props the components do not know go to the wrapper element.** `<AsciiImage>`, `<AsciiVideo>` and `<AsciiCanvas>` now pass anything a `<div>` takes — `id`, `data-*`, `aria-*`, `role`, `title`, `tabIndex`, event handlers — to their wrapper. They used to be handed to the renderer as options, where they did nothing. So a prop that was silently ignored now lands on a `<div>`: an `onClick` starts firing, and a misspelt or made-up prop becomes a DOM attribute (React warns about those it does not recognise). `onError` keeps its meaning (the renderer failing).
- **`<AsciiImage draw>`:** a second `load` event on the same element (a responsive image choosing another candidate) no longer leaves the first buffer and its animation loop running behind the new one.
