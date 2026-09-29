/**
 * The pull request comment, through GitHub's REST API and fetch.
 *
 * Two calls a run at most: find this Action's comment by its marker, then
 * edit it or write a new one. The comment is found again rather than
 * remembered, because a re-run of a job remembers nothing.
 */

/** An answer from GitHub that was not a success, with its status. */
export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * A client for the one API this Action calls. `api` is GITHUB_API_URL, which
 * is not api.github.com on GitHub Enterprise Server.
 */
export function client({ api, token, fetch = globalThis.fetch }) {
  const base = String(api || "https://api.github.com").replace(/\/+$/, "");
  return {
    async call(method, path, body) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "versioncam-action",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!response.ok) {
        const said = typeof json?.message === "string" ? `: ${json.message}` : "";
        throw new GitHubError(
          response.status,
          `${method} ${path.split("?")[0]} answered ${response.status}${said}`,
        );
      }
      return json;
    },
  };
}

/** Pages of a hundred; a pull request with more comments than this is rare. */
const MAX_PAGES = 30;

/** The first comment on the pull request that carries `marker`, or null. */
export async function findComment(github, { repo, issue, marker }) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const comments = await github.call(
      "GET",
      `/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`,
    );
    if (!Array.isArray(comments)) return null;
    const found = comments.find(
      (c) => typeof c?.body === "string" && c.body.includes(marker),
    );
    if (found) return found;
    if (comments.length < 100) return null;
  }
  return null;
}

/**
 * Rewrite the comment that carries `marker`, or write one. With `create:
 * false`, for a check that passed, only a comment already there is
 * rewritten: nobody needs telling that nothing broke.
 */
export async function upsertComment(github, { repo, issue, marker, body, create }) {
  const existing = await findComment(github, { repo, issue, marker });
  if (existing) {
    const edited = await github.call(
      "PATCH",
      `/repos/${repo}/issues/comments/${existing.id}`,
      { body },
    );
    return { action: "edited", url: edited?.html_url ?? existing.html_url ?? null };
  }
  if (!create) return { action: "none", url: null };
  const created = await github.call(
    "POST",
    `/repos/${repo}/issues/${issue}/comments`,
    { body },
  );
  return { action: "created", url: created?.html_url ?? null };
}
