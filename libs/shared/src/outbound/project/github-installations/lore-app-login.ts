// Lore's own GitHub App login (`<slug>[bot]`), read from GitHub once per process so no login is hardcoded (specs/protected-branch-merge).
import { appSlug } from "./github-app-octokit.js";

export type AppLogin = () => Promise<string | undefined>;

/** Remembers the first successful read; a failed read is forgotten so the next caller asks again. */
export function appLoginReader(readSlug: () => Promise<string>): AppLogin {
  let login: Promise<string> | undefined;

  return () => {
    login ??= readSlug().then(
      (slug) => `${slug}[bot]`,
      (err: unknown) => {
        login = undefined;
        throw err;
      },
    );

    return login;
  };
}

function productionLogin(env: NodeJS.ProcessEnv): AppLogin {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKey) {
    return async () => undefined;
  }

  return appLoginReader(() => appSlug({ appId, privateKey }));
}

/** Undefined where Lore runs on a plain token rather than as an App: then no bot author is Lore's. */
export const loreAppLogin: AppLogin = productionLogin(process.env);
