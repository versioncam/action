# Changelog

What a user of the Action would want to know about each version, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [semantic versioning](https://semver.org/). The tag `v1` always points at the newest 1.x.y release.

## [1.0.0] - 2026-10-04

The first version.

### Added

- `mode: check` records every clip with the repository's own versioncam and fails the job when one no longer matches the app. On a pull request it comments the clips that failed, the step each stopped at, the recorder's message and its version, and links a picture of each page from the artifact `versioncam-failures`. The next run rewrites the same comment, and a run that passes says the clips match again.
- `mode: render` renders what the check recorded and uploads every file it made as the artifact `versioncam-renders`.
- `sequence: true` also stitches the rendered clips into one piece; off by default, since `render --sequence` stitches every rendered clip when the config names no sequence.
- `mode: publish` sends what the check recorded to version.cam, signed in with GitHub's OpenID Connect token for the audience `version.cam`: nothing is stored, and the token reaches only the one command that needs it. Without `id-token: write` it stops with one sentence.
- A job summary in every mode, and the outputs `result`, `report` and `urls`.
- The inputs `working-directory`, `clips`, `url`, `storage-state`, `install-browser`, `comment`, `api` and `github-token`.
- The Action runs the versioncam the repository installed and never downloads one. It needs 0.3.0 or later, and says so in one sentence when the repository has none or an older one.
