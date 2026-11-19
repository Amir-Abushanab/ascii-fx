# Fixture video

`testsrc.webm` is ffmpeg's own `testsrc2` pattern: 160×96, 30 fps, two seconds, VP8. It exists
so the browser suites can put a real `<video>` in front of the renderer: frames arriving through
`requestVideoFrameCallback`, a pause, a seek. A canvas or a still exercises none of that. VP8
because the Chromium that Playwright installs has no H.264 decoder.

```sh
ffmpeg -f lavfi -i "testsrc2=size=160x96:rate=30" -t 2 -c:v libvpx -b:v 120k -g 10 -an testsrc.webm
```

Generated, so there is no licence to carry.
