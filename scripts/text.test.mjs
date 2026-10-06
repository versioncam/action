import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  COMMENT_LIMIT,
  block,
  checkText,
  code,
  commentBody,
  dayOf,
  directory,
  headline,
  livingUrls,
  marker,
  MESSAGE_LIMIT,
  pictureName,
  publishText,
  renderText,
  stoppedAt,
} from "./text.mjs";

const report = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const context = {
  workingDirectory: "test-app",
  runUrl: "https://github.com/versioncam/action/actions/runs/42",
  artifactUrl: "https://github.com/versioncam/action/actions/runs/42/artifacts/7",
};

/**
 * A publish's context as the summary step builds it on a push to a private
 * repository's main: what the event says of the repository, and a today in
 * the same year as the fixture's versions.
 */
const pushed = {
  ...context,
  defaultBranch: "main",
  repositoryPrivate: true,
  now: new Date("2026-10-06T09:00:00.000Z"),
};

test("a failing check names the clip, the step, the message and the recorder", () => {
  const text = checkText(report("check-fail.json"), context);
  assert.match(text, /^### Versioncam: 1 of 1 clip no longer matches the app$/m);
  // Index 7 in the timeline's steps is the eighth line of the clip.
  assert.match(text, /\*\*`first`\*\* stopped at step 8, `click`, 5\.6 s in:/);
  assert.ok(text.includes("Nothing matched getByRole('button', { name: 'Add book' })"));
  assert.match(text, /versioncam 0\.3\.0 in `test-app`/);
  assert.ok(
    text.includes(
      "The page when it stopped: `first.png` in [versioncam-failures](https://github.com/versioncam/action/actions/runs/42/artifacts/7).",
    ),
  );
  assert.ok(text.includes("([the run](https://github.com/versioncam/action/actions/runs/42))"));
});

test("the comment is the summary's text behind a marker that finds it again", () => {
  const failing = report("check-fail.json");
  const body = commentBody(failing, context);
  assert.ok(body.startsWith(`${marker("test-app")}\n`));
  assert.ok(body.includes(checkText(failing, context)));
});

test("one marker per working directory, however it is spelled", () => {
  assert.equal(marker("test-app"), marker("./test-app/"));
  assert.equal(marker("."), marker(""));
  assert.notEqual(marker("apps/web"), marker("apps/admin"));
  // An HTML comment may not hold two hyphens in a row.
  assert.ok(!marker("apps/web--next").slice(4, -3).includes("--"));
  assert.equal(directory("./"), ".");
});

test("a check that passes again says so, and names what it checked", () => {
  const text = checkText(report("check-pass.json"), context, { again: true });
  assert.match(text, /^### Versioncam: every clip matches the app again$/m);
  assert.match(text, /1 clip checked: `first`\./);
  assert.doesNotMatch(checkText(report("check-pass.json"), context), /again/);
});

test("a check with no report says it did not finish, and where to look", () => {
  const text = checkText(null, context);
  assert.match(text, /### Versioncam: the check did not finish/);
  assert.match(text, /\[The job log\]\(https:\/\/github\.com\/versioncam\/action\/actions\/runs\/42\) says why\./);
});

test("the step is named for every shape a failure can have", () => {
  assert.equal(stoppedAt({ step: { index: 0, call: "open" }, t: 0 }), "stopped at step 1, `open`, 0.0 s in");
  assert.equal(stoppedAt({ step: null, t: null }), "stopped before its first step");
  assert.equal(stoppedAt({ t: 2.25 }), "stopped, 2.3 s in");
});

test("a picture that was not uploaded is said to be missing, not linked", () => {
  const text = checkText(report("check-fail.json"), { ...context, artifactUrl: "" });
  assert.match(text, /`first\.png` \(not uploaded\)/);
  assert.doesNotMatch(text, /versioncam-failures\]/);
});

test("no message can break out of its code block, and a long one is cut", () => {
  const nasty = "before\n```\n# not a heading\n````\nafter";
  const fenced = block(nasty);
  const fence = fenced.split("\n")[0].replace("text", "");
  assert.ok(fence.length >= 5);
  assert.ok(fenced.endsWith(`\n${fence}`));
  assert.equal(code("a`b"), "``a`b``");

  const long = {
    recorder: "0.3.0",
    clips: [{ id: "first", status: "fail", message: "x".repeat(MESSAGE_LIMIT * 3), step: null, t: 1, picture: null }],
  };
  const text = checkText(long, context);
  assert.ok(text.length < MESSAGE_LIMIT * 2);
  assert.match(text, /\[cut here: the job log has the whole message\]/);
});

test("a comment never grows past GitHub's limit, however many clips fail", () => {
  const many = {
    recorder: "0.3.0",
    clips: Array.from({ length: 200 }, (_, i) => ({
      id: `clip-${i}`,
      status: "fail",
      message: "y".repeat(MESSAGE_LIMIT),
      step: { index: 3, call: "click" },
      t: 1,
      picture: "/x/failure.png",
    })),
  };
  const body = commentBody(many, context);
  assert.ok(body.length <= COMMENT_LIMIT, `${body.length} characters`);
  assert.match(body, /And \d+ more clips failed\. The job log has every one\./);
});

test("the render's summary lists each clip's files and links the artifact", () => {
  const text = renderText(report("render.json"), context);
  assert.match(text, /^### Versioncam: 1 clip rendered$/m);
  assert.ok(text.includes("| `first` | `first.mp4`, `first.webm`, `first-poster.png`, `first-sheet.png` |"));
  assert.ok(text.includes("[versioncam-renders](https://github.com/versioncam/action/actions/runs/42/artifacts/7)"));

  const partly = { ...report("render.json"), sequence: "/o/out/sequence.mp4", failed: [{ id: "second", message: "no ffmpeg" }] };
  const both = renderText(partly, context);
  assert.match(both, /1 clip rendered, 1 failed/);
  assert.match(both, /Stitched into one piece: `sequence\.mp4`\./);
  assert.match(both, /\*\*`second`\*\* did not render:\n\n```text\nno ffmpeg\n```/);
});

test("the publish's summary gives each living URL, and the output lists them", () => {
  const published = report("publish.json");
  const text = publishText(published, context);
  assert.match(text, /^### Versioncam: 2 clips published$/m);
  assert.ok(text.includes("To `versioncam/action` on https://api.version.cam."));
  assert.ok(
    text.includes(
      "| `first` | https://clips.version.cam/versioncam/action/first | [7f3a9c1](https://clips.version.cam/versioncam/action/first@7f3a9c1) | pass |",
    ),
  );
  assert.match(text, /\| fail, stale \|/);
  assert.equal(
    livingUrls(published),
    "https://clips.version.cam/versioncam/action/first\nhttps://clips.version.cam/versioncam/action/second",
  );
  assert.equal(livingUrls(null), "");
});

test("without the service's newer fields, the publish's summary is the one it always was", () => {
  const always = [
    "### Versioncam: 2 clips published",
    "",
    "To `versioncam/action` on https://api.version.cam.",
    "",
    "| Clip | Living URL | This version | Check |",
    "|---|---|---|---|",
    "| `first` | https://clips.version.cam/versioncam/action/first | [7f3a9c1](https://clips.version.cam/versioncam/action/first@7f3a9c1) | pass |",
    "| `second` | https://clips.version.cam/versioncam/action/second | [b21e04d](https://clips.version.cam/versioncam/action/second@b21e04d) | fail, stale |",
    "",
    "<sub>Published from `test-app` ([the run](https://github.com/versioncam/action/actions/runs/42)).</sub>",
  ].join("\n");
  assert.equal(publishText(report("publish.json"), context), always);
  // What the event says of the repository changes none of it.
  assert.equal(publishText(report("publish.json"), pushed), always);
});

test("a broken clip says what the public still sees, and the summary where the project is managed", () => {
  assert.equal(
    publishText(report("publish-broken.json"), pushed),
    [
      "### Versioncam: 3 clips published",
      "",
      "To `acme/shop` on https://api.version.cam.",
      "",
      "| Clip | Living URL | This version | Check |",
      "|---|---|---|---|",
      "| `first` | https://clips.version.cam/acme/shop/first | [ver_2c8h4n6p0r1s3t5v7w9x](https://clips.version.cam/acme/shop/first@9c4e1b7a2d3f) | pass, unchanged |",
      "| `add-a-book` | https://clips.version.cam/acme/shop/add-a-book | [ver_9d1e5f7g3h2j4k6m8n0q](https://clips.version.cam/acme/shop/add-a-book@9c4e1b7a2d3f) | fail, broken |",
      "| `checkout` | https://clips.version.cam/acme/shop/checkout | [ver_5a7b9c1d3e5f7g9h1j3k](https://clips.version.cam/acme/shop/checkout@9c4e1b7a2d3f) | fail, broken |",
      "",
      "**`add-a-book`** is broken on `main`. Your pages keep playing the version from 3 October (`3f2a1c9`).",
      "",
      "**`checkout`** is broken on `main`. No version of it has passed yet, so nothing plays.",
      "",
      "Pro tells your team by email or Slack and keeps track until they are fixed: https://app.version.cam/upgrade?account=acme",
      "",
      "These clips are private, like the repository. To show them on a public page, make them public or unlisted: https://app.version.cam/acme/shop/settings",
      "",
      "Manage this project: https://app.version.cam/acme/shop",
      "",
      "<sub>Published from `test-app` ([the run](https://github.com/versioncam/action/actions/runs/42)).</sub>",
    ].join("\n"),
  );
});

test("a plan that tells people, and public clips, leave only the broken clip and the project's page", () => {
  const paid = { ...report("publish-broken.json"), alerts: true, visibility: "public" };
  const text = publishText(paid, pushed);
  assert.match(text, /\*\*`add-a-book`\*\* is broken on `main`\./);
  assert.match(text, /^Manage this project: https:\/\/app\.version\.cam\/acme\/shop$/m);
  assert.doesNotMatch(text, /Pro tells/);
  assert.doesNotMatch(text, /private/);
});

test("Pro's line is said once, of the clips just named broken, and only when one is", () => {
  const broken = report("publish-broken.json");
  const one = { ...broken, versions: broken.versions.slice(0, 2) };
  const text = publishText(one, pushed);
  assert.equal(text.match(/Pro tells/g).length, 1);
  assert.match(text, /keeps track until it is fixed: https:\/\/app\.version\.cam\/upgrade\?account=acme$/m);

  // Nothing broken, nothing for Pro to do: the private note and the
  // project's page stay.
  const passing = { ...broken, versions: broken.versions.slice(0, 1) };
  const quiet = publishText(passing, pushed);
  assert.doesNotMatch(quiet, /Pro tells|is broken/);
  assert.match(quiet, /^These clips are private, like the repository\./m);
  assert.match(quiet, /^Manage this project: /m);
});

test("a broken clip's line names what the service gave, and only that", () => {
  const broken = report("publish-broken.json");
  const [, clip] = broken.versions;
  const lineOf = (playing, at = pushed) =>
    publishText({ ...broken, versions: [{ ...clip, playing }] }, at).split("\n").find((l) => l.startsWith("**"));

  // A version from another year names its year.
  assert.equal(
    lineOf({ ...clip.playing, recordedAt: "2025-10-03T12:00:00.000Z" }),
    "**`add-a-book`** is broken on `main`. Your pages keep playing the version from 3 October 2025 (`3f2a1c9`).",
  );
  // No time, or no commit: the line says less, never something made up.
  assert.equal(
    lineOf({ ...clip.playing, recordedAt: null }),
    "**`add-a-book`** is broken on `main`. Your pages keep playing the last version that passed (`3f2a1c9`).",
  );
  assert.equal(
    lineOf({ version: "ver_6t8v0w2x4y6z8a0b2c4d", recordedAt: "2026-10-03T12:00:00.000Z" }),
    "**`add-a-book`** is broken on `main`. Your pages keep playing the version from 3 October (`ver_6t8v0w2x4y6z8a0b2c4d`).",
  );
  // An event that names no default branch: the default branch, unnamed.
  assert.equal(
    lineOf(clip.playing, { ...pushed, defaultBranch: null }),
    "**`add-a-book`** is broken on the default branch. Your pages keep playing the version from 3 October (`3f2a1c9`).",
  );
});

test("private clips of a public repository are private, but not like the repository", () => {
  const text = publishText(report("publish-broken.json"), { ...pushed, repositoryPrivate: false });
  assert.match(
    text,
    /^These clips are private\. To show them on a public page, make them public or unlisted: https:\/\/app\.version\.cam\/acme\/shop\/settings$/m,
  );
  assert.doesNotMatch(text, /like the repository/);
});

test("an address the service gave that is not the web's is never printed", () => {
  const odd = { ...report("publish-broken.json"), manage: "javascript:alert(1)" };
  const text = publishText(odd, pushed);
  assert.doesNotMatch(text, /javascript|Manage this project/);
  assert.match(text, /^Pro tells your team by email or Slack and keeps track until they are fixed\.$/m);
  assert.match(text, /make them public or unlisted\.$/m);
});

test("the project's settings are its address and /settings, however the address ends", () => {
  for (const manage of ["https://app.version.cam/acme/shop/", "https://app.version.cam/acme/shop?from=ci#clips"]) {
    const text = publishText({ ...report("publish-broken.json"), manage }, pushed);
    assert.match(text, /make them public or unlisted: https:\/\/app\.version\.cam\/acme\/shop\/settings$/m);
    assert.match(text, /until they are fixed: https:\/\/app\.version\.cam\/upgrade\?account=acme$/m);
  }
});

test("a day is said as a person says it, in UTC, and only of a time", () => {
  const october = new Date("2026-10-06T09:00:00.000Z");
  assert.equal(dayOf("2026-10-03T12:00:00.000Z", october), "3 October");
  assert.equal(dayOf("2026-01-31T23:59:59.999Z", october), "31 January");
  assert.equal(dayOf("2025-12-24T00:00:00.000Z", october), "24 December 2025");
  // Without a today, no year is told.
  assert.equal(dayOf("2025-12-24T00:00:00.000Z"), "24 December");
  for (const notATime of ["3 October", "2026-10-03", "2026-13-45T00:00:00Z", "", null, undefined, 1759492800000]) {
    assert.equal(dayOf(notATime, october), null, String(notATime));
  }
});

test("the line a failing job ends with", () => {
  assert.equal(headline("check", report("check-fail.json"), 1), "1 of 1 clip no longer matches the app: first.");
  assert.equal(headline("check", report("check-pass.json"), 0), "");
  assert.equal(headline("check", null, 1), "versioncam check did not finish; its output above says why.");
  assert.equal(headline("render", { failed: [{ id: "a" }, { id: "b" }] }, 1), "2 clips did not render: a, b.");
  assert.equal(headline("publish", null, 1), "versioncam publish did not finish; its output above says why.");
});

test("a picture is named for its clip, safely", () => {
  assert.equal(pictureName("01-create-a-shipment"), "01-create-a-shipment.png");
  assert.equal(pictureName("../../x y"), "..-..-x-y.png");
});

test("nothing the Action writes has a long dash in it", () => {
  const texts = [
    checkText(report("check-fail.json"), context),
    checkText(report("check-pass.json"), context, { again: true }),
    checkText(null, context),
    renderText(report("render.json"), context),
    renderText(null, context),
    publishText(report("publish.json"), context),
    publishText(report("publish-broken.json"), pushed),
    publishText(report("publish-broken.json"), { ...context, repositoryPrivate: false }),
    publishText(null, context),
  ];
  for (const text of texts) assert.doesNotMatch(text, /[\u2013\u2014]/);
});
