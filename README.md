# downloaddoctor

[![npm](https://img.shields.io/npm/v/@guihakka2/downloaddoctor)](https://www.npmjs.com/package/@guihakka2/downloaddoctor) [![CI](https://github.com/Guihakka2/downloaddoctor/actions/workflows/ci.yml/badge.svg)](https://github.com/Guihakka2/downloaddoctor/actions/workflows/ci.yml)

English · [Português](README.pt-BR.md) · [日本語](README.ja.md)

That PDF that won't open is a "session expired" web page. That zip stopped at 70%. The installer doesn't match its published checksum. **downloaddoctor** checks your downloads folder and tells you which files are broken, without opening, moving or deleting anything.

```bash
npx @guihakka2/downloaddoctor                     # checks ~/Downloads
npx @guihakka2/downloaddoctor ./releases -r --dupes
npx @guihakka2/downloaddoctor app.zip --sha256 3f1c…   # verify one file against a hash
```

```
$ downloaddoctor Downloads --dupes
downloaddoctor  8 files checked · 4 with problems

  ✗ invoice-2026-11.pdf  72 B
      this .pdf is actually an HTML page (error or login page saved instead)
  ✗ manual.pdf  234.4 KB
      PDF is truncated (no %%EOF)
  ✗ tool-v2.1.tar.gz  195.3 KB
      gzip is truncated
  … ubuntu-24.04.iso.crdownload  293.0 KB
      unfinished download (browser temp file)
  ✓ app-setup.exe  SHA-256 matches

  1 sets of duplicates (175.8 KB could be freed)
    photo (1).jpg  =  photo.jpg
```

## What it checks

| Problem | How |
|---|---|
| Unfinished downloads | Browser temp files: `.crdownload`, `.part`, `.partial`, `.download`, `.opdownload`, `.!ut` |
| Empty files | 0 bytes |
| Web page saved instead of the file | A `.pdf`/`.zip`/`.png`… that is really HTML (login or error page) |
| Wrong file type | Content doesn't match the extension |
| Corrupt or truncated zip | Every entry decompressed in memory and its CRC-32 checked (also `.docx`, `.xlsx`, `.jar`, `.apk`, `.epub`) |
| Truncated gzip / `.tgz` | Whole stream decompressed to the end |
| Truncated PDF / PNG / JPEG | End-of-file markers (`%%EOF`, `IEND`, `FFD9`) |
| Checksum mismatch | `SHA256SUMS`, `checksums.txt`, `file.sha256` next to the file (GNU and BSD formats), or `--sha256` |
| Duplicates (`--dupes`) | Same size, then same SHA-256 |

## Options

| Option | |
|---|---|
| `--sha256 HASH` | Verify a single file against this SHA-256 |
| `--dupes` | Also list duplicate files |
| `-r, --recursive` | Include subfolders (dot folders and symlinks are skipped) |
| `--json` | Machine-readable output |

Exit codes: `0` all fine, `1` problems found, `2` usage error.

## Security

See [SECURITY.md](SECURITY.md). Read-only: nothing is opened in other apps, extracted to disk, moved or deleted. Zip entries are checked in memory with a size limit (zip bombs stop at the declared size). No network, no telemetry, zero dependencies.

## License

MIT · Part of [Guihakka Tools](https://github.com/Guihakka2/guihakka-tools)
