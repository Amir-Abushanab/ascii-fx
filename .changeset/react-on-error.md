---
"@ascii-fx/react": minor
---

React: add `onError` to `<AsciiImage>`, `<AsciiVideo>` and `<AsciiCanvas>`.

The components already degrade correctly when the renderer cannot be built — the `<img>`/`<video>` fallback is on screen and stays there — but they discarded the error `useAscii` had already computed, so an app had no way to tell a silent degrade from a success. Hook users could read `error` off `useAscii`; component users had nothing. `onError` fires once per distinct failure, for both a failed renderer init and a GPU device loss that could not be recovered from.
