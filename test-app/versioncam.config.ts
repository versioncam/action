import { defineRecorder } from "versioncam";

/**
 * The test app, described to the recorder.
 *
 * Two environment variables are the Action's way in, and this file decides
 * what they mean, as any app's config does:
 *
 *  - VERSIONCAM_BASE_URL is the Action's `url` input. When it is set, the app
 *    is already running there, so nothing is started. When it is not, the
 *    recorder starts `serve.mjs` itself and stops it afterwards.
 *  - VERSIONCAM_STORAGE_STATE is the path of the file the Action wrote from
 *    its `storage-state` input: a saved browser session. This app has no
 *    sign-in, so the session changes nothing on the page, but reading it here
 *    is how an app that signs in would.
 */
const deployed = process.env.VERSIONCAM_BASE_URL;
const session = process.env.VERSIONCAM_STORAGE_STATE;

export default defineRecorder({
  baseUrl: deployed || "http://localhost:4173",
  webServer: deployed
    ? undefined
    : { command: "node serve.mjs", url: "http://localhost:4173" },
  auth: session ? { storageState: session } : undefined,
  viewport: { width: 1280, height: 720 },
  clips: "demos/clips/**/*.clip.ts",
});
