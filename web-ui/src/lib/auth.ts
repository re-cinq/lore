// Auth configuration for the Lore UI
// In production: Google Workspace OIDC via NextAuth
// For now: no auth (internal access only via K8s network policy)

export function isAuthenticated(): boolean {
  // TODO: implement Google Workspace OIDC
  return true;
}

export function getCurrentUser(): string {
  return process.env.LORE_UI_USER || 'platform-engineer';
}
