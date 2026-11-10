# Versioncam Action

[![demo verified](https://img.shields.io/endpoint?url=https%3A%2F%2Fapi.version.cam%2Fv1%2Fbadge%2Fversioncam%2Faction&cacheSeconds=300)](https://clips.version.cam/versioncam/action)

[Versioncam](https://version.cam) records short product videos of your web app. Each clip is a script in your repository that drives your app in a real browser, so when the app no longer matches a clip, the check fails instead of leaving an out-of-date video in place. This Action runs your repository's own versioncam in GitHub Actions, comments on the pull request when a clip breaks, uploads the videos, and publishes them to version.cam with GitHub's own token.

## Use it

Your app needs versioncam 0.3.0 or later as a dev dependency, and at least one clip: run `npm i -D versioncam`, then `npx versioncam init` for the authoring skill that writes your first clip. Then add this workflow as `.github/workflows/versioncam.yml`:

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
    runs-on: ubuntu-24.04
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
    runs-on: ubuntu-24.04
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

In both jobs the Action first runs in its default mode, `check`. It records every clip at full quality and fails the job when a clip no longer matches the app. `publish` doesn't record anything itself. It sends what the check recorded, failures included, so version.cam knows when a clip broke.

The jobs use `ubuntu-24.04`, not `ubuntu-latest`, on purpose, for two reasons. The exact bytes of a recording depend on the runner image, so naming the image is part of pinning the recorder. And since late October 2026, GitHub's `ubuntu-latest` is Ubuntu 26.04. Playwright 1.59 has no list of system libraries for it, so `versioncam install --with-deps` stops there with "Playwright does not support chromium-headless-shell on ubuntu26.04-x64".

In a monorepo, install the app's dependencies where they live, and point the Action at the app with `working-directory: apps/web`.

### Pin the browser too

versioncam pins its Playwright version, and two runs on the same runner image produce the same bytes. To pin the browser build, the fonts and the system libraries as well, run the job in the Playwright image for the version your versioncam pins (`npm ls playwright` shows it). The image already has the browser, so skip the install:

```yaml
    runs-on: ubuntu-24.04
    container: mcr.microsoft.com/playwright:v1.59.1-noble
    steps:
      # ...
      - uses: versioncam/action@v1
        with:
          install-browser: false
```

### Render without publishing

`render` turns what the check recorded into videos and uploads them as the artifact `versioncam-renders`. For each clip you get an MP4, a WebM, a poster and a contact sheet of eight frames. With `sequence: true`, it also stitches the clips into one video, in the order of the config's `sequence` if it has one. It encodes with ffmpeg, so ffmpeg must be on the runner:

```yaml
      - uses: versioncam/action@v1
      - run: sudo apt-get update && sudo apt-get install -y ffmpeg
      - uses: versioncam/action@v1
        with:
          mode: render
          install-browser: false # the check installed it
```

### Pin a release

`@v1` follows the newest 1.x.y release. A fix reaches your workflow without you changing it, and so does anything else we release under `v1`. To run exactly one release, name its commit instead. Each release's notes give the line to copy:

```yaml
      - uses: versioncam/action@<the release's commit> # v1.0.0
```

Someone can move a tag, but nobody can move a commit, so a pinned workflow keeps running the code you chose even if a tag moves later. Dependabot keeps pins like this current. With `package-ecosystem: github-actions` in `.github/dependabot.yml`, it opens a pull request for each new release that changes the commit and the version beside it, so you can read the change before it runs with your job's tokens. The same applies to every other action in the workflow, including `actions/checkout` and `actions/setup-node`. The Action pins the one action it runs itself, `actions/upload-artifact`, the same way.

## Inputs

| Input | Default | What it does |
|---|---|---|
| `mode` | `check` | `check` records every clip and fails when one no longer matches the app. `render` encodes what the last check recorded and uploads the files. `publish` sends what the last check recorded to version.cam. |
| `working-directory` | `.` | The directory that holds `versioncam.config.ts`, from the repository's root. |
| `clips` | every clip | Clip ids, separated by spaces. |
| `url` | none | The app's address, if it is already running somewhere. The Action passes it to versioncam as `VERSIONCAM_BASE_URL`, for your config to read. |
| `deployment` | none | Record against this commit's deployment: the GitHub deployment environment to wait for, such as `Preview` or `Production`. See *Record a deployed preview*. |
| `status-context` | none | For a host that reports a commit status instead of a deployment, such as Netlify: the status to wait for, such as `netlify/my-site/deploy-preview`. See *Record a deployed preview*. |
| `deployment-timeout` | `15` | How many minutes to wait for that deployment or status before the job fails. |
| `storage-state` | none | A saved browser session from a secret: the JSON that `versioncam login` writes. The Action writes it to a file only the job can read, gives versioncam its path as `VERSIONCAM_STORAGE_STATE`, and deletes it when it finishes. |
| `install-browser` | `true` | Runs `versioncam install --with-deps` first, for the Chromium versioncam records with. `publish` doesn't need a browser and skips this. |
| `comment` | `true` | On a pull request, comments when the check fails, and updates the comment when a later run passes. |
| `sequence` | `false` | In `render` mode, also stitch the clips into one piece. |
| `api` | `https://api.version.cam` | Where `publish` sends the recordings. |
| `github-token` | `github.token` | The token the pull request comment is written with. |

`url` and `storage-state` reach your app only through your config, and your config decides what they mean. The Action sets each variable only when you give its input:

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

## Record a deployed preview

If your app doesn't start in a runner (it needs a database, queues, other services), record it where it already runs: the preview your host deploys for each pull request, and the production deployment of each push. Hosts that report to GitHub's Deployments API, Vercel among them, work with the `deployment` input. The Action waits for this commit's deployment of that environment to succeed, then gives its address to versioncam as `VERSIONCAM_BASE_URL`.

On Vercel, first turn on **deployment_status Events** in the project's Settings, under Git. New projects start with it off, and without it Vercel makes no GitHub deployment for the Action to find.

```yaml
permissions:
  contents: read
  deployments: read # to find the commit's deployment
  statuses: read # to tell you when Vercel deployed but made no GitHub deployment
  pull-requests: write

steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 22
      cache: npm
  - run: npm ci
  - uses: versioncam/action@v1
    with:
      deployment: Preview # Production on a push to your default branch
    env:
      VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}
```

- On a pull request the Action waits for the deployment of the branch's head commit, which is what your host built. On a push it waits for the pushed commit's.
- `deployment` is matched as a prefix and ignores case, because a host may add the project's name. Vercel does: its environments are `Preview` or `Production`, a dash and the project's name. So `Preview` matches any project's preview, and in a repository with several Vercel projects, `Preview - web` matches only web's (a hyphen matches Vercel's dash). If no deployment of that environment is ready in time, the job fails and names the environments GitHub does have for the commit.
- If Vercel says it deployed the commit but no GitHub deployment follows within a minute, the job fails at once and tells you to turn on deployment_status Events, instead of waiting out the timeout. It needs `statuses: read` to see that.
- A failed deployment fails the job with a link to its log.
- `url` wins over `deployment`. Give one or the other.
- Only `check` waits. `render` and `publish` use what the last check recorded.

Netlify doesn't create GitHub deployments. It reports a commit status on each pull request, `netlify/<site>/deploy-preview`, so give `status-context` instead, with `statuses: read` in place of `deployments: read`. The Action waits for that status to succeed and takes its `target_url`, which is then the preview's address. (While the deploy is pending, the status points at Netlify's dashboard, which the Action never uses.)

```yaml
  - uses: versioncam/action@v1
    with:
      status-context: netlify/my-site/deploy-preview
```

Netlify reports no status for a push to your default branch, so record that job against your site's production address with `url:`. That records whatever is deployed when the job runs, which may still be the previous commit's build.

Your config reads the address and sends what the host's protection needs. For a Vercel preview with Deployment Protection, that is the project's automation bypass secret, sent only to the app (versioncam 0.8.0 or newer):

```ts
export default defineRecorder({
  baseUrl: process.env.VERSIONCAM_BASE_URL ?? "http://localhost:3000",
  headers: {
    "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  },
});
```

versioncam's README has the rest under *Record a deployed preview*: the secrets, signing in, replaying data that changes, and the hosts we have tried. `npx versioncam ci --deployed` writes the whole workflow.

## Outputs

| Output | What it holds |
|---|---|
| `result` | `pass` or `fail`. |
| `report` | The path of the JSON report versioncam wrote with `--report`, when it wrote one. |
| `urls` | `publish` only: the permanent link of each published clip, one per line. |

Every mode also writes the job summary: the check's result, the files a render made, or the permanent link of each published clip. After a publish, the summary also lists each clip that is broken on the default branch and the version your pages keep playing until it is fixed. It says when a private repository's clips are private and how to show them on a public page, and it links to the project on app.version.cam.

## The pull request comment

When the check fails on a pull request, the Action posts one comment. It names each clip that failed, the step it stopped at, the recorder's message and the versioncam version that ran the check, with a picture of the page at that moment. If someone renames the button a clip clicks, the comment is this Markdown:

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

The comment counts steps from 1, starting at the clip's first line (`s.open`); the recorder's own files count from 0. The pictures are in the artifact `versioncam-failures`, one `<clip>.png` for each failing clip, and the comment links to it.

The next run updates the same comment instead of adding another, and when a run passes again, the comment says the clips match again. A pull request with no failure gets no comment. The Action finds its comment by a hidden marker, one for each `working-directory`, so two apps checked in one pull request keep one comment each. The same text goes into the job summary on every event. A push has no pull request, so it gets only the summary.

The comment needs `permissions: pull-requests: write`. A pull request from a fork gets a read-only token. There the check still fails the job and writes the summary, and the Action warns that it couldn't comment.

## How publish signs in, with nothing stored

A job with `permissions: id-token: write` can ask GitHub for a signed OpenID Connect token that names the repository, the commit, the branch and the run. In `publish` mode the Action asks for one with the audience `version.cam`, masks it in the log straight away, and passes it to the one `versioncam publish` command as `VERSIONCAM_OIDC_TOKEN`. The Action never prints it, writes it to a file or sets it as an output. version.cam checks GitHub's signature and reads the repository and the commit from the token. So there is no key to create, store or rotate, and a token issued for version.cam is useless anywhere else.

Without the permission, `publish` stops straight away and says, in one sentence, that the job needs it. A pull request from a fork never gets a token, which is why the workflow above publishes on pushes to main. Outside GitHub, `versioncam publish` takes a project token in `VERSIONCAM_TOKEN` instead; the Action never needs one.

## What it runs

The Action runs the versioncam your repository installed, `node_modules/.bin/versioncam`. It looks for it from `working-directory` up to the repository's root, and never downloads one. `npx versioncam` would fetch the latest version from npm when none is installed, and two versions of the recorder in one job is exactly the bug a pinned recorder is there to prevent. The Action needs 0.3.0 or later. If the repository has none, or an older one, it stops and tells you in one sentence to install it with `npm i -D versioncam@latest`. It runs on Linux and macOS runners; versioncam is untested on Windows.

Everything else comes from versioncam itself. The Action adds only what a command line can't: the comment, the artifacts, the summary and GitHub's token. Running `npx versioncam check --report check.json` on your machine does what the check does in CI.

Artifact names must be unique within a workflow run. If a run uploads the same mode's artifact twice, from two jobs or two apps, the second upload fails.

## This repository

`test-app/` is the Action's own customer: a deliberately boring page with a form, a list and a dialog, a forty-line server, and one clip that fills in the form and clicks the button called *Add book*. CI runs the Action on it in `check` and `render` mode on every push to main and every pull request, and checks that `publish` without `id-token: write` stops with its one-sentence error. Two branches are kept open as pull requests to show the Action at work: `acceptance/rename-button` renames the button, and the check fails with a comment naming the step; `acceptance/change-copy` changes the words around the button, and the check passes and the render's contact sheet shows the new words.

`CONTRIBUTING.md` has the rules for changing the Action.

## License

The Action is MIT; see `LICENSE`. versioncam itself is under its own license, FSL-1.1-ALv2.
