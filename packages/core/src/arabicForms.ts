// Arabic Presentation Forms-B (U+FE80..U+FEFC) as the text that shapes to each one: the base
// letter, with ZERO WIDTH JOINER on the side(s) its form connects. Many Arabic fonts — anything
// built for OpenType shaping rather than the legacy encoding — leave this block unmapped, so a
// form is drawn by shaping its context instead (ALGORITHM.md §13), in the compiler and in the
// browser alike: the font's own GSUB picks the form, never a fallback font. Generated
// from the Unicode Character Database's compatibility decompositions (Unicode 16.0.0).
export const ARABIC_PRESENTATION_CONTEXT: ReadonlyMap<number, string> = new Map([
  [0xfe80, '\u0621'], // letter hamza isolated form
  [0xfe81, '\u0622'], // letter alef with madda above isolated form
  [0xfe82, '\u200d\u0622'], // letter alef with madda above final form
  [0xfe83, '\u0623'], // letter alef with hamza above isolated form
  [0xfe84, '\u200d\u0623'], // letter alef with hamza above final form
  [0xfe85, '\u0624'], // letter waw with hamza above isolated form
  [0xfe86, '\u200d\u0624'], // letter waw with hamza above final form
  [0xfe87, '\u0625'], // letter alef with hamza below isolated form
  [0xfe88, '\u200d\u0625'], // letter alef with hamza below final form
  [0xfe89, '\u0626'], // letter yeh with hamza above isolated form
  [0xfe8a, '\u200d\u0626'], // letter yeh with hamza above final form
  [0xfe8b, '\u0626\u200d'], // letter yeh with hamza above initial form
  [0xfe8c, '\u200d\u0626\u200d'], // letter yeh with hamza above medial form
  [0xfe8d, '\u0627'], // letter alef isolated form
  [0xfe8e, '\u200d\u0627'], // letter alef final form
  [0xfe8f, '\u0628'], // letter beh isolated form
  [0xfe90, '\u200d\u0628'], // letter beh final form
  [0xfe91, '\u0628\u200d'], // letter beh initial form
  [0xfe92, '\u200d\u0628\u200d'], // letter beh medial form
  [0xfe93, '\u0629'], // letter teh marbuta isolated form
  [0xfe94, '\u200d\u0629'], // letter teh marbuta final form
  [0xfe95, '\u062a'], // letter teh isolated form
  [0xfe96, '\u200d\u062a'], // letter teh final form
  [0xfe97, '\u062a\u200d'], // letter teh initial form
  [0xfe98, '\u200d\u062a\u200d'], // letter teh medial form
  [0xfe99, '\u062b'], // letter theh isolated form
  [0xfe9a, '\u200d\u062b'], // letter theh final form
  [0xfe9b, '\u062b\u200d'], // letter theh initial form
  [0xfe9c, '\u200d\u062b\u200d'], // letter theh medial form
  [0xfe9d, '\u062c'], // letter jeem isolated form
  [0xfe9e, '\u200d\u062c'], // letter jeem final form
  [0xfe9f, '\u062c\u200d'], // letter jeem initial form
  [0xfea0, '\u200d\u062c\u200d'], // letter jeem medial form
  [0xfea1, '\u062d'], // letter hah isolated form
  [0xfea2, '\u200d\u062d'], // letter hah final form
  [0xfea3, '\u062d\u200d'], // letter hah initial form
  [0xfea4, '\u200d\u062d\u200d'], // letter hah medial form
  [0xfea5, '\u062e'], // letter khah isolated form
  [0xfea6, '\u200d\u062e'], // letter khah final form
  [0xfea7, '\u062e\u200d'], // letter khah initial form
  [0xfea8, '\u200d\u062e\u200d'], // letter khah medial form
  [0xfea9, '\u062f'], // letter dal isolated form
  [0xfeaa, '\u200d\u062f'], // letter dal final form
  [0xfeab, '\u0630'], // letter thal isolated form
  [0xfeac, '\u200d\u0630'], // letter thal final form
  [0xfead, '\u0631'], // letter reh isolated form
  [0xfeae, '\u200d\u0631'], // letter reh final form
  [0xfeaf, '\u0632'], // letter zain isolated form
  [0xfeb0, '\u200d\u0632'], // letter zain final form
  [0xfeb1, '\u0633'], // letter seen isolated form
  [0xfeb2, '\u200d\u0633'], // letter seen final form
  [0xfeb3, '\u0633\u200d'], // letter seen initial form
  [0xfeb4, '\u200d\u0633\u200d'], // letter seen medial form
  [0xfeb5, '\u0634'], // letter sheen isolated form
  [0xfeb6, '\u200d\u0634'], // letter sheen final form
  [0xfeb7, '\u0634\u200d'], // letter sheen initial form
  [0xfeb8, '\u200d\u0634\u200d'], // letter sheen medial form
  [0xfeb9, '\u0635'], // letter sad isolated form
  [0xfeba, '\u200d\u0635'], // letter sad final form
  [0xfebb, '\u0635\u200d'], // letter sad initial form
  [0xfebc, '\u200d\u0635\u200d'], // letter sad medial form
  [0xfebd, '\u0636'], // letter dad isolated form
  [0xfebe, '\u200d\u0636'], // letter dad final form
  [0xfebf, '\u0636\u200d'], // letter dad initial form
  [0xfec0, '\u200d\u0636\u200d'], // letter dad medial form
  [0xfec1, '\u0637'], // letter tah isolated form
  [0xfec2, '\u200d\u0637'], // letter tah final form
  [0xfec3, '\u0637\u200d'], // letter tah initial form
  [0xfec4, '\u200d\u0637\u200d'], // letter tah medial form
  [0xfec5, '\u0638'], // letter zah isolated form
  [0xfec6, '\u200d\u0638'], // letter zah final form
  [0xfec7, '\u0638\u200d'], // letter zah initial form
  [0xfec8, '\u200d\u0638\u200d'], // letter zah medial form
  [0xfec9, '\u0639'], // letter ain isolated form
  [0xfeca, '\u200d\u0639'], // letter ain final form
  [0xfecb, '\u0639\u200d'], // letter ain initial form
  [0xfecc, '\u200d\u0639\u200d'], // letter ain medial form
  [0xfecd, '\u063a'], // letter ghain isolated form
  [0xfece, '\u200d\u063a'], // letter ghain final form
  [0xfecf, '\u063a\u200d'], // letter ghain initial form
  [0xfed0, '\u200d\u063a\u200d'], // letter ghain medial form
  [0xfed1, '\u0641'], // letter feh isolated form
  [0xfed2, '\u200d\u0641'], // letter feh final form
  [0xfed3, '\u0641\u200d'], // letter feh initial form
  [0xfed4, '\u200d\u0641\u200d'], // letter feh medial form
  [0xfed5, '\u0642'], // letter qaf isolated form
  [0xfed6, '\u200d\u0642'], // letter qaf final form
  [0xfed7, '\u0642\u200d'], // letter qaf initial form
  [0xfed8, '\u200d\u0642\u200d'], // letter qaf medial form
  [0xfed9, '\u0643'], // letter kaf isolated form
  [0xfeda, '\u200d\u0643'], // letter kaf final form
  [0xfedb, '\u0643\u200d'], // letter kaf initial form
  [0xfedc, '\u200d\u0643\u200d'], // letter kaf medial form
  [0xfedd, '\u0644'], // letter lam isolated form
  [0xfede, '\u200d\u0644'], // letter lam final form
  [0xfedf, '\u0644\u200d'], // letter lam initial form
  [0xfee0, '\u200d\u0644\u200d'], // letter lam medial form
  [0xfee1, '\u0645'], // letter meem isolated form
  [0xfee2, '\u200d\u0645'], // letter meem final form
  [0xfee3, '\u0645\u200d'], // letter meem initial form
  [0xfee4, '\u200d\u0645\u200d'], // letter meem medial form
  [0xfee5, '\u0646'], // letter noon isolated form
  [0xfee6, '\u200d\u0646'], // letter noon final form
  [0xfee7, '\u0646\u200d'], // letter noon initial form
  [0xfee8, '\u200d\u0646\u200d'], // letter noon medial form
  [0xfee9, '\u0647'], // letter heh isolated form
  [0xfeea, '\u200d\u0647'], // letter heh final form
  [0xfeeb, '\u0647\u200d'], // letter heh initial form
  [0xfeec, '\u200d\u0647\u200d'], // letter heh medial form
  [0xfeed, '\u0648'], // letter waw isolated form
  [0xfeee, '\u200d\u0648'], // letter waw final form
  [0xfeef, '\u0649'], // letter alef maksura isolated form
  [0xfef0, '\u200d\u0649'], // letter alef maksura final form
  [0xfef1, '\u064a'], // letter yeh isolated form
  [0xfef2, '\u200d\u064a'], // letter yeh final form
  [0xfef3, '\u064a\u200d'], // letter yeh initial form
  [0xfef4, '\u200d\u064a\u200d'], // letter yeh medial form
  [0xfef5, '\u0644\u0622'], // ligature lam with alef with madda above isolated form
  [0xfef6, '\u200d\u0644\u0622'], // ligature lam with alef with madda above final form
  [0xfef7, '\u0644\u0623'], // ligature lam with alef with hamza above isolated form
  [0xfef8, '\u200d\u0644\u0623'], // ligature lam with alef with hamza above final form
  [0xfef9, '\u0644\u0625'], // ligature lam with alef with hamza below isolated form
  [0xfefa, '\u200d\u0644\u0625'], // ligature lam with alef with hamza below final form
  [0xfefb, '\u0644\u0627'], // ligature lam with alef isolated form
  [0xfefc, '\u200d\u0644\u0627'], // ligature lam with alef final form
])
