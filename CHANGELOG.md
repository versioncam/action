# Changelog

What a user of the Action would want to know about each version, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [semantic versioning](https://semver.org/). The tag `v1` always points at the newest 1.x.y release.

## [Unreleased]

### Added

- The `deployment` input records against this commit's deployment: the Action waits for the GitHub deployment of that environment (`Preview`, `Production`) to succeed and gives its address to versioncam as `VERSIONCAM_BASE_URL`. On a pull request it waits for the branch's head commit, which is what your host built. The environment is matched as a prefix, ignoring case, and a hyphen matches Vercel's dash, so `Preview - web` picks one project's preview. On Vercel, the project's deployment_status Events setting must be on; new projects start with it off, and when Vercel deployed a commit without a GitHub deployment, the job fails within a minute and says so (with `statuses: read`). A failed deployment fails the job with its log, and if none is ready in time, the job fails and names the environments GitHub does have. `deployment-timeout` sets the wait, 15 minutes by default. The job needs `deployments: read`. An explicit `url` wins.
- The `status-context` input does the same for a host that reports a commit status instead of a deployment, such as Netlify (`netlify/<site>/deploy-preview`): the Action waits for that status to succeed and records against its `target_url`. The job needs `statuses: read`.

## [1.1.2] - 2026-10-31

The install step survives GitHub's move of `ubuntu-latest` to Ubuntu 26.04. Nothing else changes.

### Fixed

- The browser installs on a runner whose Ubuntu is newer than versioncam's Playwright knows, which GitHub's `ubuntu-latest` has been since it became 26.04 in October 2026. Where Playwright refuses the OS outright, the Action runs the installer again told the host is `ubuntu24.04`, the newest it knows, whose build and libraries record the same, and says so in a notice. versioncam 0.5.3 does this by itself; the Action does it for the versions before.

### Changed

- The README's workflows run on `ubuntu-24.04`, not `ubuntu-latest`: GitHub's latest became Ubuntu 26.04 in late October 2026, where Playwright 1.59 has no list of system libraries and `versioncam install --with-deps` fails. A named image is also part of the pin a recording's bytes depend on. This repository's own CI runs on it too.

## [1.1.1] - 2026-10-29

Nothing the Action does has changed. This is the release that lists it in the GitHub Marketplace.

### Changed

- The Action's description, which the Marketplace listing shows, says what it asserts: the job fails, naming the control, when the app no longer matches a clip.
- The README opens with the badge version.cam draws for this repository's own test app, "demo verified · commit · age", and this repository's CI publishes that app's clip on every push to main, as a customer's would.

## [1.1.0] - 2026-10-07

### Added

- The publish summary says what version.cam says about the project. Each clip that is broken on the default branch gets a line with the version your pages keep playing meanwhile, or that none has passed yet. The summary links the project on app.version.cam, says when a private repository's clips are private and how to show them on a public page, and, on a plan that tells nobody when a clip breaks, what Pro would do. The table says `broken` where it said `stale`. Each line appears only when version.cam's answer, as your versioncam reports it, carries what the line needs, so with an older service or versioncam the summary is what it was.

### Changed

- The artifact uploads run `actions/upload-artifact` pinned to the commit of its v4.6.2 instead of the tag `v4`, which is the same code today: a tag moved upstream can no longer change what runs in your job.
- Each release's notes end with the line that pins its commit, `uses: versioncam/action@<commit> # vX.Y.Z`. The README's "Pin a release" says why you might.

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
