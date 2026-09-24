# SLOPE WRITER

T.OF... のアプリ。https://t-of.github.io/slope-writer/

- ルールは本部の `~/GitHub/tof/t-of.github.io/RULES.md` に従う（全アプリ共通）。ブランドは `docs/BRAND.md`。
- 直したら本部で `npm run audit:browser -- slope-writer` を通す。
- 公開は本部の `docs/RELEASE.md` の手順。大きな作業は本部で Claude を起動すると、役割を分けて進められる。
- localStorage のキーは `slope-writer.` で始める。SW のキャッシュ名は `slope-writer-` で始める。
- 遊ぶ部分（parser.js・physics.js・stages.js）を変えたら `node test.mjs` を通す。ステージを足したらテストも回す。
