/** The vendor-neutral embedding seam: every embedding call goes through an `EmbeddingProvider` (via the {@link Embeddings} singleton), so a vendor is one adapter and nothing else names it. */
export interface EmbeddingProvider {
  readonly vendor: string;
  readonly model: string;
  /** The stored vector columns are this wide (768 today), so a provider with another width needs a migration and a re-embed of every chunk. */
  readonly dimensions: number;
  /** One vector per text, in input order; null where the provider produced none; a refused call is nulls, not a throw. */
  embed(texts: string[]): Promise<Array<number[] | null>>;
}
