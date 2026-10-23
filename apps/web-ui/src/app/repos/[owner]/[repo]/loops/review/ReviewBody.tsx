import { Alert } from "@/components/Alert";
import { getCodeReview } from "@/lib/api/code-review";
import ReviewView from "./ReviewView";

/** The code-review loop's page under its switch: the pull requests under review, the other open ones, and the newest settled reviews. */
export default async function ReviewBody({ fullName }: { fullName: string }) {
  const result = await getCodeReview(fullName);

  if (result.status !== "ok") {
    const reason =
      result.status === "error" ? result.message : "Lore API unconfigured";

    return (
      <Alert variant="secondary">
        Could not load the code-review state ({reason}) — check the Lore API
        connection and reload.
      </Alert>
    );
  }

  return <ReviewView review={result.data} />;
}
