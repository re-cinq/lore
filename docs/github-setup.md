# GitHub setup for a Lore install

Lore needs three things from GitHub before it is installed, and a GitHub organization owner creates two of them. When you finish this page you have every GitHub value the [install tutorial](INSTALL.md#3-install-on-a-client-cluster) asks for.

| What | Who creates it | What Lore uses it for |
| ---- | -------------- | --------------------- |
| [A GitHub App](#1-the-github-app) | an owner of the client's organization | reading and writing repositories, issues and pull requests as Lore |
| [A GitHub OAuth App](#2-the-oauth-app-for-sign-in) | the same owner | signing people in to the web UI |
| [A registry token](#3-the-registry-token) | re:cinq | pulling the images that are not public |

Optional, later: [a second App that approves pull requests](#4-optional-the-reviewer-app).

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
| Webhook → Active | **off**. Lore installs a webhook on each repository itself when the repository is onboarded |
| Where can this GitHub App be installed? | Only on this account |

Repository permissions:

| Permission | Access |
| ---------- | ------ |
| Contents | Read and write |
| Issues | Read and write |
| Pull requests | Read and write |
| Checks | Read-only |
| Metadata | Read-only |
| Webhooks | Read and write |

Subscribe to no events on the App.

Then:

1. **Create the App.** Its settings page shows the **App ID**.
2. **Generate a private key** (on the same page, under "Private keys"). GitHub downloads a `.pem` file. It is shown once.
3. **Install the App** on the organization ("Install App" in the left menu), on all repositories or on the ones Lore should work in.
4. **Read the installation ID.** After installing, the browser is on `https://github.com/organizations/<org>/settings/installations/<number>`. The number is the installation ID.

What you now have, and where it goes in `my-values.yaml`:

| Value | Key in the values file |
| ----- | ---------------------- |
| App ID | `secrets.githubApp.appId` |
| The whole `.pem` file | `secrets.githubApp.privateKey` |
| Installation ID | `secrets.githubApp.installationId` |
| Slug | `lore-platform.lore-ui.env.GITHUB_APP_SLUG` |
| Organization name | `lore-platform.lore-api.env.GITHUB_ORG` |

Quote the two IDs in the values file (`"123456"`), so they are read as text.

## 2. The OAuth App for sign-in

Open **GitHub → Organization settings → Developer settings → OAuth Apps → New OAuth App**.

| Field | Value |
| ----- | ----- |
| Application name | anything, for example `Lore` |
| Homepage URL | `https://<ui host>` |
| Authorization callback URL | `https://<api host>/api/auth/callback` |

The callback is on the **API** host, not the UI host: lore-api runs the sign-in.

Register it, then **Generate a new client secret**. It is shown once.

| Value | Key in the values file |
| ----- | ---------------------- |
| Client ID | `secrets.githubOAuth.clientId` |
| Client secret | `secrets.githubOAuth.clientSecret` |

Only members of the organization named in `GITHUB_ORG` can sign in.

## 3. The registry token

Three images are not public: `ghcr.io/re-cinq/lore-api`, `lore-mcp` and `lore-ui` (and `utopia`, when it is installed). The cluster pulls them with a GitHub token that re:cinq provides.

re:cinq creates it: a member of the re-cinq organization, or a machine user that belongs to it, opens **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token**, and selects the one scope `read:packages`.

| Value | Key in the values file |
| ----- | ---------------------- |
| The GitHub username the token belongs to | `secrets.ghcr.username` |
| The token | `secrets.ghcr.token` |

Check it before installing:

```bash
echo "<token>" | docker login ghcr.io -u "<username>" --password-stdin
docker manifest inspect ghcr.io/re-cinq/lore-api:latest > /dev/null && echo "token works"
```

A token from an account outside the re-cinq organization logs in and then fails on the second command.

## 4. Optional: the reviewer App

Lore's own App cannot approve the pull requests it opened, because GitHub refuses an approval from the author. A second App, `lore-reviewer`, exists only to approve them, for the auto-merge loop. Without it, Lore still approves people's pull requests and leaves its own waiting.

How to create it and which permissions it takes: [The lore-reviewer App](managing-secrets.md#the-lore-reviewer-app-lore-reviewer-app-) in the secrets guide. On a client cluster its three values go into a Secret named `lore-reviewer-app` in the `lore-stations` namespace, with the keys `app-id`, `private-key` and `installation-id`.

## GitHub Enterprise Server

A self-hosted GitHub Enterprise Server (3.11 or newer) works with one change: set `GITHUB_HOST` to its bare host name, for example `ghe.example.com`, in the `lore-api`, `lore-ui` and `lore-stations` `env:` blocks. Everything above then happens on that instance: create the GitHub App and the OAuth App in the Server's own organization settings, not on github.com, and use the Server's URLs in the checks below. Lore reaches its API at `https://<host>/api/v3` and sends sign-in to `https://<host>/login/oauth/authorize`. The full list of what the Server needs (Actions synced or GitHub Connect, egress for agents, runners reaching Lore) is in [section 1.6.1 of the install guide](INSTALL.md#161-github-enterprise).

Enterprise Cloud on github.com is github.com, so nothing changes. Enterprise Cloud with data residency (`<name>.ghe.com`) works the same way with `GITHUB_HOST` set to `<name>.ghe.com`, except that Lore reaches its API at `https://api.<name>.ghe.com` with no `/api/v3`. The 3.11 requirement is for a Server only. Lore has not been run against a real `ghe.com` tenant.

## After the install

Webhooks need no setup. When a repository is onboarded, Lore creates its webhook, pointed at `https://<webhook host>/api/events` and signed with `secrets.webhookSecret`. [Section 5 of the install guide](INSTALL.md#5-configure-webhooks) has the manual version, for the rare case the App may not manage webhooks.

Check that GitHub and Lore agree:

| Check | How | Good result |
| ----- | --- | ----------- |
| Sign-in works | open `https://<ui host>` and sign in | you land in the UI. A person outside `<org>` is refused |
| Lore sees the App | **Settings → GitHub** in the UI | the organization is listed as connected |
| A repository's webhook exists | onboard a repository, then `gh api repos/<org>/<repo>/hooks --jq '.[].config.url'` | the `/api/events` URL |

To let Lore work in more repositories later, change the App's repository access on GitHub (**Organization settings → GitHub Apps → Configure**). Nothing changes in the cluster.
