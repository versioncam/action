import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  COMMENT_LIMIT,
  block,
  checkText,
  code,
  commentBody,
  directory,
  headline,
  marker,
  MESSAGE_LIMIT,
  pictureName,
  renderText,
  stoppedAt,
} from "./text.mjs";

const report = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const context = {
  workingDirectory: "test-app",
  runUrl: "https://github.com/petbul/versioncam-action/actions/runs/42",
  artifactUrl: "https://github.com/petbul/versioncam-action/actions/runs/42/artifacts/7",
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
      "The page when it stopped: `first.png` in [versioncam-failures](https://github.com/petbul/versioncam-action/actions/runs/42/artifacts/7).",
    ),
  );
  assert.ok(text.includes("([the run](https://github.com/petbul/versioncam-action/actions/runs/42))"));
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
  assert.match(text, /\[The job log\]\(https:\/\/github\.com\/petbul\/versioncam-action\/actions\/runs\/42\) says why\./);
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
  assert.ok(text.includes("[versioncam-renders](https://github.com/petbul/versioncam-action/actions/runs/42/artifacts/7)"));

  const partly = { ...report("render.json"), sequence: "/o/out/sequence.mp4", failed: [{ id: "second", message: "no ffmpeg" }] };
  const both = renderText(partly, context);
  assert.match(both, /1 clip rendered, 1 failed/);
  assert.match(both, /Stitched into one piece: `sequence\.mp4`\./);
  assert.match(both, /\*\*`second`\*\* did not render:\n\n```text\nno ffmpeg\n```/);
});

test("the line a failing job ends with", () => {
  assert.equal(headline("check", report("check-fail.json"), 1), "1 of 1 clip no longer matches the app: first.");
  assert.equal(headline("check", report("check-pass.json"), 0), "");
  assert.equal(headline("check", null, 1), "versioncam check did not finish; its output above says why.");
  assert.equal(headline("render", { failed: [{ id: "a" }, { id: "b" }] }, 1), "2 clips did not render: a, b.");
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
  ];
  for (const text of texts) assert.doesNotMatch(text, /[\u2013\u2014]/);
});
