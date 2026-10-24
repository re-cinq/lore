export class DeliveryContract {
  getPodCommands(): string[] {
    return [
      "npx prettier --write $(git diff --name-only HEAD)",
      "git add -A",
      "git commit -m 'chore: formatted'",
      "git push origin HEAD",
      "git fetch origin main",
      "git rebase origin/main",
      "git push --force-with-lease origin HEAD",
    ];
  }
}
