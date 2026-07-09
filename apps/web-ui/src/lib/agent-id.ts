export function displayAgentId(id: string): string {
  const compact = id.replace(/-/g, '');
  const isOpaqueHash = compact.length >= 16 && /^[0-9a-f]+$/i.test(compact);
  return isOpaqueHash ? `${id.slice(0, 8)}...` : id;
}
