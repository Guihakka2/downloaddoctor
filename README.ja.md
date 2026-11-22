# downloaddoctor

[English](README.md) · [Português](README.pt-BR.md) · 日本語

開けない PDF の中身は「セッションが切れました」の Web ページ。zip は 70% で止まっている。インストーラーが公開チェックサムと一致しない。**downloaddoctor** はダウンロードフォルダーを調べ、壊れたファイルを教えます。開いたり、移動したり、削除したりは一切しません。

```bash
npx @guihakka2/downloaddoctor                     # ~/Downloads をチェック
npx @guihakka2/downloaddoctor ./releases -r --dupes
npx @guihakka2/downloaddoctor app.zip --sha256 3f1c…
```

**Node.js がなくても使えます：** [最新リリース](https://github.com/Guihakka2/downloaddoctor/releases/latest)から OS（Windows・macOS・Linux）に合ったファイルをダウンロードし、展開してターミナルで実行します（Windows は `downloaddoctor.exe`、macOS/Linux は `./downloaddoctor ~/Downloads`）。プログラムはこのリポジトリのコードから GitHub Actions でビルドされ、`SHA256SUMS.txt` とビルド来歴の証明が付きます。まだ有料の署名はないため、初回は Windows の SmartScreen（「詳細情報」→「実行」）、macOS では `xattr -d com.apple.quarantine downloaddoctor` を一度実行してください。

- **未完了のダウンロード**：`.crdownload`、`.part`、`.partial` などブラウザーの一時ファイル
- **ファイルの代わりに保存された Web ページ**：実は HTML（ログイン画面やエラー画面）の `.pdf`/`.zip`
- **壊れた・途中で切れた zip**：中の各ファイルをメモリ上で展開し CRC-32 を確認（`.docx`、`.xlsx`、`.apk` なども）
- **途中で切れた gzip・PDF・PNG・JPEG**：ファイル末尾のマーカーを確認
- **チェックサム**：同じフォルダーの `SHA256SUMS`、`checksums.txt`、`ファイル名.sha256`、または `--sha256`
- **重複**（`--dupes`）：同じサイズかつ同じ SHA-256。空けられる容量も表示

読み取り専用・ネットワークなし・依存ゼロ。詳細は [SECURITY.md](SECURITY.md)。
