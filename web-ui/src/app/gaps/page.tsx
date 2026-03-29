export default function GapsPage() {
  return (
    <div>
      <h1>Gap Detection Drafts</h1>
      <p className="meta">Review auto-drafted context additions from gap detection. Coming soon — will integrate with GitHub API.</p>
      <div className="placeholder">
        <p>This page will allow reviewers to:</p>
        <ul>
          <li>View PRs labelled context-gap-draft</li>
          <li>See the low-confidence queries that triggered each draft</li>
          <li>Approve or reject drafts directly from the UI</li>
        </ul>
      </div>
    </div>
  );
}
