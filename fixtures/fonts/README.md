# Fixture fonts

| file                                    | source                                                                                      | license                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------- |
| `GeistMono-Regular.ttf`                 | [Geist](https://vercel.com/font)                                                            | [OFL 1.1](OFL.txt)      |
| `NotoSansArabic-Regular.subset.ttf`     | [notofonts/arabic](https://github.com/notofonts/arabic) `NotoSansArabic-v2.013`             | [OFL 1.1](OFL-Noto.txt) |
| `NotoSansDevanagari-Regular.subset.ttf` | [notofonts/devanagari](https://github.com/notofonts/devanagari) `NotoSansDevanagari-v2.007` | [OFL 1.1](OFL-Noto.txt) |
| `NotoSansThai-Regular.subset.ttf`       | [notofonts/thai](https://github.com/notofonts/thai) `NotoSansThai-v2.002`                   | [OFL 1.1](OFL-Noto.txt) |

The Noto files are subsets of each release's `unhinted/ttf/*-Regular.ttf`, cut down to what
`packages/compiler/test/golden-shaped.test.ts` draws, with every layout feature kept so shaping
is unchanged. The Noto licenses name no Reserved Font Name, so subsets keep their names.
The Arabic subset leaves Presentation Forms-B out on purpose: every positional form is then
shaped from its base letter, which is the path the golden test exists to pin.

```sh
pyftsubset NotoSansArabic-Regular.ttf --unicodes="U+0020,U+0621-064A,U+0640,U+200C-200D,U+25CC" \
  --layout-features='*' --name-IDs='*' --name-languages='*' --notdef-outline --no-hinting \
  --output-file=NotoSansArabic-Regular.subset.ttf
pyftsubset NotoSansDevanagari-Regular.ttf \
  --text=" अआइईउऊऋएऐओऔकखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसह्ािीुूृेैोौंः" \
  --unicodes="U+200C-200D,U+25CC" --layout-features='*' --name-IDs='*' --name-languages='*' \
  --notdef-outline --no-hinting --output-file=NotoSansDevanagari-Regular.subset.ttf
pyftsubset NotoSansThai-Regular.ttf --unicodes="U+0020,U+0E00-0E7F,U+200C-200D,U+25CC" \
  --layout-features='*' --name-IDs='*' --name-languages='*' --notdef-outline --no-hinting \
  --output-file=NotoSansThai-Regular.subset.ttf
```
