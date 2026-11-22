# GitHub setup for a Lore install

Lore needs a GitHub App before it is installed, and a GitHub organization owner creates it. When you finish this page you have every GitHub value the [install tutorials](install/README.md) ask for.

| What | Who creates it | What Lore uses it for |
| ---- | -------------- | --------------------- |
| [A GitHub App](#1-the-github-app) | an owner of your GitHub organization | reading and writing repositories, issues and pull requests as Lore, and [signing people in to the web UI](#2-sign-in-through-the-app) |

Optional, later: [a second App that approves pull requests](#3-optional-the-reviewer-app).

You need the hostnames of the install first. This page writes them as:

| Placeholder | Meaning | Example |
| ----------- | ------- | ------- |
| `<ui host>` | the web UI | `lore.example.com` |
| `<api host>` | the Lore API | `lore-api.example.com` |
| `<org>` | the GitHub organization | `acme` |

## 1. The GitHub App

Open **GitHub → Organization settings → Developer settings → GitHub Apps → New GitHub App**.

| Field | Value |
| ----- | ----- |
| GitHub App name | anything unique on GitHub, for example `lore-<org>`. GitHub derives the App's **slug** from it; note the slug |
| Homepage URL | `https://<ui host>` |
| Setup URL | `https://<ui host>/settings/github/callback` |
| Callback URL | `https://<api host>/api/auth/callback`. On the **API** host: lore-api runs the sign-in |
| Expire user authorization tokens | **on** |
| Request user authorization (OAuth) during installation | off |
| Webhook → Active | **off**. Lore installs a webhook on each repository itself when the repository is onboarded |
| Where can this GitHub App be installed? | Only on this account |

### Permissions

On the same form, under **Permissions**, open **Repository permissions** and set these ten. After the App exists they are under **Organization settings → Developer settings → GitHub Apps → Edit → Permissions & events**.

| Permission | Access | What Lore does with it |
| ---------- | ------ | ---------------------- |
| Actions | Read and write | reads a failed CI job and its log, so an agent fixes what CI reported. At onboarding, the last station (`onboard-start-ingest`) enables `lore-ingest.yml` and `lore-tests.yml` when they are disabled and dispatches them on the default branch to start the first ingestion; merge-check does the same when an onboarding pull request merges. Without the write access the station reports a gap and does not fail |
| Checks | Read and write | reads CI results on a pull request, and posts its own review as the `lore/code-review` check |
| Contents | Read and write | reads code, specs and ADRs; pushes branches and commits; merges pull requests |
| Issues | Read and write | reads the backlog; files, labels, comments on and closes tickets |
| Metadata | Read-only | GitHub selects it for every App |
| Pull requests | Read and write | opens, reviews, comments on, updates and merges pull requests |
| Secrets | Read and write | onboarding sets the repository secret `LORE_INGEST_TOKEN` on every run; the repository's CI uses it to post to Lore. Nobody sets it by hand |
| Variables | Read and write | onboarding sets the repository variable `LORE_INGEST_URL` on every run. Nobody sets it by hand. Its value is the stations deployment's `LORE_INGEST_URL`, the public lore-api URL (for example `https://<api host>`), set from the chart value `lore-stations.ingestUrl` (the stations subchart value in the umbrella chart; the install chart sets it under `lore-platform.lore-stations.ingestUrl`) |
| Webhooks | Read and write | creates the repository's webhook at onboarding |
| Workflows | Read and write | the onboarding pull request adds files under `.github/workflows/`. GitHub refuses any push that changes a workflow file without it |

One more, only in one case:

| Permission | Access | When |
| ---------- | ------ | ---- |
| Administration | Read-only | the auto-merge loop is switched on for a repository whose default branch has no ruleset that asks for an approval. Lore then has to read the classic branch protection before it merges, and refuses to merge when it cannot |

Under **Organization permissions**, set one:

| Permission | Access | What Lore does with it |
| ---------- | ------ | ---------------------- |
| Members | Read-only | at sign-in, asks GitHub whether the person is a member of `<org>`. Without it GitHub answers 403 and nobody can sign in: the error page says the App cannot ask GitHub about membership |

Leave the other organization permissions and every **Account permission** at "No access". Under **Subscribe to events**, tick nothing: the events reach Lore through the webhook it creates on each repository.

Agents get no credential of their own. For each run Lore gives the agent a short-lived token of this App's installation, for the one repository it works in and narrowed to Contents, Issues, Pull requests and Workflows. An agent never holds the Secrets, Webhooks or Checks permission.

To change a permission later, edit it on the App and save. GitHub then asks the organization to accept the change: an owner opens **Organization settings → GitHub Apps → Configure** on the App and approves the request. Until then the installation keeps the old permissions. An installation made before Actions became Read and write must accept that change the same way; until it does, onboarding cannot start the first ingestion and says so.

Re-onboarding (`POST /api/onboard` with `reonboard: true`, or "Update setup" in the web UI) rewrites the secret and the variable and starts the ingestion again.

Then:

1. **Create the App.** Its settings page shows the **App ID**.
2. **Generate a private key** (on the same page, under "Private keys"). GitHub downloads a `.pem` file. It is shown once.
3. **Install the App** on the organization ("Install App" in the left menu), on all repositories or on the ones Lore should work in.
4. **Read the installation ID.** After installing, GitHub sends the browser to the Setup URL with `?installation_id=<number>` in the address. Before Lore is installed that page does not load, which is expected; the number is the installation ID. You can also read it later: **Organization settings → GitHub Apps → Configure** on the App opens `…/settings/installations/<number>`.

What you now have, and where it goes in `my-values.yaml`:

| Value | Key in the values file |
| ----- | ---------------------- |
| App ID | `secrets.githubApp.appId` |
| The whole `.pem` file | `secrets.githubApp.privateKey` |
| Installation ID | `secrets.githubApp.installationId` |
| Slug | `lore-platform.lore-ui.env.GITHUB_APP_SLUG` |
| Organization name | `lore-platform.lore-api.env.GITHUB_ORG` |

The two IDs are numbers. Write them with or without quotes.

## 2. Sign in through the App

People sign in to the web UI through the App's own OAuth client, not through a separate OAuth App. On the App's settings page, under **Client secrets**, **Generate a new client secret**. It is shown once.

| Value | Key in the values file |
| ----- | ---------------------- |
| Client ID (starts with `Iv`, not the App ID) | `secrets.githubApp.clientId` |
| Client secret | `secrets.githubApp.clientSecret` |
| A 64-hex-character key (`openssl rand -hex 32`) | `secrets.userTokenEncryptionKey`. Left empty, the chart generates one. It encrypts the GitHub token kept per session; changing it signs everybody out |

Only members of the organization named in `GITHUB_ORG` can sign in. A person signs in with the App's permissions on the repositories they can open themselves; GitHub, not Lore, decides which those are.

The install chart still asks for `secrets.githubOAuth` (Secret `lore-github-oauth`), left from the OAuth App sign-in used before. lore-api no longer reads it.

## 3. Optional: the reviewer App

Lore's own App cannot approve the pull requests it opened, because GitHub refuses an approval from the author. A second App, `lore-reviewer`, exists only to approve them, for the auto-merge loop. Without it, Lore still approves people's pull requests and leaves its own waiting.

Create it like the App in section 1, named `lore-reviewer`, with the webhook off, no events, and these repository permissions:

| Permission | Access |
| ---------- | ------ |
| Checks | Read-only |
| Contents | Read-only |
| Metadata | Read-only |
| Pull requests | Read and write |

Install it on the same repositories. Its three values go into a Secret named `lore-reviewer-app` in the `lore-stations` namespace, with the keys `app-id`, `private-key` and `installation-id`.

## GitHub Enterprise Server

A self-hosted GitHub Enterprise Server (3.11 or newer) works with one change: set `GITHUB_HOST` to its bare host name, for example `ghe.example.com`, in the `lore-api`, `lore-ui` and `lore-stations` `env:` blocks. Everything above then happens on that instance: create the GitHub App and the OAuth App in the Server's own organization settings, not on github.com, and use the Server's URLs in the checks below. Lore reaches its API at `https://<host>/api/v3` and sends sign-in to `https://<host>/login/oauth/authorize`. What else the Server needs:

- The instance must be GitHub Enterprise Server 3.11 or newer, because Lore reads branch rules through `rules/branches`. No Server instance has run it yet.
- Agents must reach the Server. When it has a private address, allow it in `floor.agentNetworkPolicy.extraEgress` (the commented example in `deploy/install/values.yaml`).
- The onboarded workflows use `actions/checkout@v4` and `actions/github-script@v7`, so the instance needs GitHub Connect enabled or those actions synced to it.
- The Actions runners must reach the Lore API URL, and the Server must reach the API host to deliver webhooks.

Enterprise Cloud on github.com is github.com, so nothing changes. Enterprise Cloud with data residency (`<name>.ghe.com`) works the same way with `GITHUB_HOST` set to `<name>.ghe.com`, except that Lore reaches its API at `https://api.<name>.ghe.com` with no `/api/v3`. Lore has not been run against a real `ghe.com` tenant.

## After the install

Webhooks need no setup. When a repository is onboarded, Lore creates its webhook, pointed at `https://<api host>/api/webhook/github` and signed with the Secret `lore-webhook-secret`. GitHub must be able to reach the API host. If the App may not manage webhooks, create the hook by hand:

```bash
gh api repos/<org>/<repo>/hooks --method POST --input - <<'JSON'
{
  "name": "web",
  "active": true,
  "events": ["issues", "pull_request", "pull_request_review", "pull_request_review_comment",
             "issue_comment", "repository", "push", "release", "create", "check_suite"],
  "config": { "url": "https://<api host>/api/webhook/github", "content_type": "json", "secret": "<webhook secret>" }
}
JSON
```

The secret must equal the value of `lore-webhook-secret` in the `lore-api` namespace, or every delivery is refused with `401`. Read it with `kubectl -n lore-api get secret lore-webhook-secret -o jsonpath='{.data.secret}' | base64 -d` and paste it in without echoing it.

Check that GitHub and Lore agree:

| Check | How | Good result |
| ----- | --- | ----------- |
| Sign-in works | open `https://<ui host>` and sign in | you land in the UI. A person outside `<org>` is refused |
| Lore sees the App | **Settings → GitHub** in the UI | the organization is listed as connected |
| A repository's webhook exists | onboard a repository, then `gh api repos/<org>/<repo>/hooks --jq '.[].config.url'` | the `/api/webhook/github` URL |

To let Lore work in more repositories later, change the App's repository access on GitHub (**Organization settings → GitHub Apps → Configure**). Nothing changes in the cluster.
