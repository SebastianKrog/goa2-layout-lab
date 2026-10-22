# Release tracking

Version tracking began with **1.0-preview**. The first published stable release
is **1.0** (`1.0.0`), dated 2026-10-22. Earlier Git history remains the record
of development before the preview baseline.

## Version source

`package.json` is the version source. `package-lock.json` must match it at both
the top level and the root package entry.

| Release name | npm version     | Git tag          |
| ------------ | --------------- | ---------------- |
| 1.0-preview  | 1.0.0-preview   | v1.0.0-preview   |
| Next preview | 1.0.0-preview.1 | v1.0.0-preview.1 |
| Stable 1.0   | 1.0.0           | v1.0.0           |

The extra zero keeps the package version valid semantic versioning. The README
uses the shorter release name. Git tags identify committed releases; preparing
version files alone does not create a tag or publish a GitHub release.

## During development

Add user-visible changes under **Unreleased** in [CHANGELOG.md](../CHANGELOG.md).
Record behavior and practical effects rather than every implementation commit.
Keep the current released version until preparing the next release.

## Prepare a release

1. Choose the version and update package metadata without an automatic Git commit:

   ```sh
   npm version 1.0.1 --no-git-tag-version
   ```

2. Move Unreleased entries into a dated release entry and update the README's
   displayed version. Refresh its images when the interface or diagram changes.
3. Run the checks appropriate to the changes; use [testing](testing.md) for
   functional releases. Verify package/lock versions, Markdown links, and images.
4. Commit the release changes, then create the matching annotated Git tag when
   releasing. Push commits and tags only when requested.

The package remains private; this workflow does not publish it to npm.
