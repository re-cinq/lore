import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { configuredTokens } from "../transport/routes/floor/git-credential.js";

const MIN_FLOOR_GIT_CREDENTIAL_TOKEN_LENGTH = 32;

/** What lore-api refuses to boot with: a floor git-credential bearer, which the public route trusts to mint GitHub tokens, too short to resist guessing. Unset is allowed, the route then answers 503. */
export function enforceBootEnv(env: NodeJS.ProcessEnv): void {
  enforceTrue(
    configuredTokens(env.FLOOR_GIT_CREDENTIAL_TOKEN).every(
      (token) => token.length >= MIN_FLOOR_GIT_CREDENTIAL_TOKEN_LENGTH,
    ),
    Error,
    `FLOOR_GIT_CREDENTIAL_TOKEN must be at least ${MIN_FLOOR_GIT_CREDENTIAL_TOKEN_LENGTH} characters`,
  );
}
