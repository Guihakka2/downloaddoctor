# Security Policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting:
**Security tab > Report a vulnerability** on this repository.
You will get a reply within 7 days.

## Design guarantees

- **Read-only**: downloaddoctor never writes, moves, renames, deletes or opens files in other programs. The tests check that files are left in place.
- Zip entries are decompressed in memory only, never written to disk, and decompression stops as soon as an entry produces more than its declared size (zip bomb guard).
- Symlinks are not followed, dot folders are skipped with `-r`, and at most 20,000 files are checked per run.
- File names are stripped of terminal control characters before printing.
- No network access, no telemetry, zero runtime dependencies. npm releases are built by GitHub Actions with provenance; never by hand.
