# Versioncam Action

[Versioncam](https://version.cam) records short, true product videos: each clip is a script in your repository that drives your app in a real browser, so a video that no longer matches the app fails instead of quietly lying. This Action runs your repository's own versioncam in GitHub Actions, comments on the pull request when a clip breaks, uploads the videos, and publishes them to version.cam with GitHub's own token.

## Use it

Your app needs versioncam 0.3.0 or later as a dev dependency and at least one clip (`npm i -D versioncam`, then `npx versioncam init` for the authoring skill that writes the first one). Then add this workflow, as `.github/workflows/versioncam.yml`:

```yaml
name: Versioncam

on:
  pull_request:
  push:
    branches: [main]

jobs:
  # On a pull request: record every clip, and fail with a comment if one broke.
  check:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write # to comment when a clip breaks
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - uses: versioncam/action@v1

  # On main: record every clip, then publish the recordings to version.cam.
  publish:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # GitHub's token for version.cam, so no secret is stored
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - uses: versioncam/action@v1
      - uses: versioncam/action@v1
        if: ${{ !cancelled() }} # a clip that broke is published as broken
        with:
          mode: publish
```

In both jobs the Action runs first in its default mode, `check`: it records every clip, at full quality, and fails the job when one no longer matches the app. `publish` records nothing itself. It sends what the check recorded, a failure included, so every page that embeds a broken clip says so.

In a monorepo, install the app's dependencies where they live, and point the Action at the app with `working-directory: apps/web`.

### Pin the browser too

versioncam pins its Playwright, and two runs on one runner image produce the same bytes. To pin the browser build, the fonts and the system libraries as well, run the job in the Playwright image for the version your versioncam pins (`npm ls playwright` names it). The browser is already in the image, so skip the install:

```yaml
    runs-on: ubuntu-latest
    container: mcr.microsoft.com/playwright:v1.59.1-noble
    steps:
      # ...
      - uses: versioncam/action@v1
        with:
          install-browser: false
```

### Render without publishing

`render` turns what the check recorded into videos, and uploads them as the artifact `versioncam-renders`: an MP4, a WebM, a poster and a contact sheet of eight frames for each clip. With `sequence: true`, the clips are also stitched into one piece, in the order of the config's `sequence` when it has one. It encodes with ffmpeg, which it expects on the runner:

```yaml
      - uses: versioncam/action@v1
      - run: sudo apt-get update && sudo apt-get install -y ffmpeg
      - uses: versioncam/action@v1
        with:
          mode: render
          install-browser: false # the check installed it
```

### Pin a release

`@v1` follows the newest 1.x.y release, so a fix reaches your workflow without a change to it, and so does anything else released under `v1`. To run exactly one release, name its commit instead. Each release's notes give the line to copy:

```yaml
      - uses: versioncam/action@<the release's commit> # v1.0.0
```

A tag can be moved and a commit cannot, so a pinned workflow runs the code you chose, whoever moves a tag later. Dependabot keeps pins like this current: with `package-ecosystem: github-actions` in `.github/dependabot.yml`, it proposes each new release as a pull request that changes the commit and the version beside it, for you to read before it runs with your job's tokens. The same holds for every other action in the workflow, `actions/checkout` and `actions/setup-node` included. The Action pins the one action it runs itself, `actions/upload-artifact`, the same way.

## Inputs

| Input | Default | What it does |
|---|---|---|
| `mode` | `check` | `check` records every clip and fails when one no longer matches the app. `render` encodes what the last check recorded and uploads the files. `publish` sends what the last check recorded to version.cam. |
| `working-directory` | `.` | The directory that holds `versioncam.config.ts`, from the repository's root. |
| `clips` | every clip | Clip ids, separated by spaces. |
| `url` | none | Where the app is already running, if it is: given to versioncam as `VERSIONCAM_BASE_URL`, for the config to read. |
| `storage-state` | none | A saved browser session, the JSON that `versioncam login` writes, from a secret. The Action writes it to a file only the job can read, gives versioncam its path as `VERSIONCAM_STORAGE_STATE`, and deletes it when it finishes. |
| `install-browser` | `true` | Runs `versioncam install --with-deps` first, for the Chromium versioncam records with. `publish` needs no browser and skips it. |
| `comment` | `true` | On a pull request, comment when the check fails, and rewrite the comment when a later run passes. |
| `sequence` | `false` | In `render` mode, also stitch the clips into one piece. |
| `api` | `https://api.version.cam` | Where `publish` sends the recordings. |
| `github-token` | `github.token` | The token the pull request comment is written with. |

`url` and `storage-state` reach your app only through your config, which decides what they mean. The Action sets each variable only when its input is given:

```ts
import { defineRecorder } from "versioncam";

const deployed = process.env.VERSIONCAM_BASE_URL;
const session = process.env.VERSIONCAM_STORAGE_STATE;

export default defineRecorder({
  baseUrl: deployed || "http://localhost:5173",
  // Start the app only when it is not already running somewhere.
  webServer: deployed ? undefined : { command: "npm run dev", url: "http://localhost:5173" },
  auth: session ? { storageState: session } : undefined,
});
```

```yaml
      - uses: versioncam/action@v1
        with:
          storage-state: ${{ secrets.VERSIONCAM_STORAGE_STATE }}
```

## Outputs

| Output | What it holds |
|---|---|
| `result` | `pass` or `fail`. |
| `report` | The path of the JSON report versioncam wrote with `--report`, when it wrote one. |
| `urls` | `publish` only: the living URLs, one a line. |

Every mode also writes the job summary: the check's result, the files a render made, or the living URL of each published clip.

## The pull request comment

When the check fails on a pull request, the Action comments once, naming each clip that failed, the step it stopped at, the recorder's message, and the version of versioncam that checked it, with a picture of the page at that moment. For the button a clip clicks, renamed under it, the comment is this Markdown:

````markdown
<!-- versioncam-action check test-app -->
### Versioncam: 1 of 1 clip no longer matches the app

**`first`** stopped at step 8, `click`, 5.6 s in:

```text
Nothing matched getByRole('button', { name: 'Add book' }) within 15000ms at t=5.56s (frame 334). The clip expected it to be on screen by this point.
```

The page when it stopped: `first.png` in [versioncam-failures](https://github.com/OWNER/REPO/actions/runs/RUN/artifacts/ARTIFACT).

<sub>Checked with versioncam 0.3.0 in `test-app` ([the run](https://github.com/OWNER/REPO/actions/runs/RUN)).</sub>
````

The step is counted from 1, from the clip's first line (`s.open`); the recorder's own files count from 0. The pictures are the artifact `versioncam-failures`, one `<clip>.png` for each failing clip, and the comment links it.

The next run rewrites the same comment instead of adding another, and when a run passes again, it says the clips match again. A pull request with no failure gets no comment. The Action finds its comment by a hidden marker, one for each `working-directory`, so two apps checked in one pull request keep a comment each. The same text is the job summary, on every event: a push, which has no pull request, gets the summary only.

The comment needs `permissions: pull-requests: write`. A pull request from a fork gets a read-only token, so there the check still fails the job and writes the summary, and the Action warns that it could not comment.

## How publish signs in, with nothing stored

A job with `permissions: id-token: write` may ask GitHub for a signed OpenID Connect token that names the repository, the commit, the branch and the run. In `publish` mode the Action asks for one whose audience is `version.cam`, masks it in the log at once, and hands it to that one `versioncam publish` command as `VERSIONCAM_OIDC_TOKEN`. It is never printed, never written to a file and never an output. version.cam checks GitHub's signature and takes the repository and the commit from the token, so there is no key to create, store or rotate, and a token minted for version.cam is worth nothing anywhere else.

Without the permission, `publish` stops at once with one sentence that says the job needs it. A pull request from a fork never gets a token, which is why the workflow above publishes from pushes to main. Outside GitHub, `versioncam publish` takes a project token in `VERSIONCAM_TOKEN` instead; the Action never needs one.

## What it runs

The Action runs the versioncam your repository installed, `node_modules/.bin/versioncam`, looked for from `working-directory` up to the repository's root. It never downloads one. `npx versioncam` would fetch the latest from npm when none is installed, and two versions of the recorder in one job is the kind of bug a pinned recorder exists to prevent. It needs 0.3.0 or later, and when the repository has none or an older one it stops with one sentence: install it with `npm i -D versioncam@latest`. It runs on Linux runners, and on macOS; versioncam is untested on Windows.

Everything else is versioncam's own. The Action adds only what a command line cannot: the comment, the artifacts, the summary and GitHub's token. `npx versioncam check --report check.json` on your machine is what the check does in CI.

An artifact's name is unique within a workflow run. A run that uploads the same mode's artifact twice, from two jobs or two apps, fails on the second upload.

## This repository

`test-app/` is the Action's own customer: a deliberately boring page with a form, a list and a dialog, a forty-line server, and one clip that fills in the form and clicks the button called *Add book*. CI runs the Action on it in `check` and `render` mode on every push to main and every pull request, and proves that `publish` without `id-token: write` stops with its sentence. Two branches are kept open as pull requests to show the Action at work: `acceptance/rename-button` renames the button, and the check fails with a comment naming the step; `acceptance/change-copy` changes the words around the button, and the check passes and the render's contact sheet shows the new words.

`CONTRIBUTING.md` has the rules for changing the Action.

## License

The Action is MIT; see `LICENSE`. versioncam itself is under its own license, FSL-1.1-ALv2.
