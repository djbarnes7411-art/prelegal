/* Generated file. Edit definitions/*.toml or templates/*.md instead. */

/**
 * One dynamic import per document, so the browser downloads the agreement it is
 * drafting and not the other ten. Written out rather than built from the slug
 * because a bundler cannot follow an import path it only learns at runtime.
 *
 * Typed as `unknown` on purpose: TypeScript infers a JSON module's string
 * fields as `string`, not as the literal unions `ClauseFile` declares, so the
 * narrowing happens once in `loadClauses` rather than eleven times here.
 */
export const CLAUSE_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  "ai-addendum": () => import("./clauses/ai-addendum.json"),
  "business-associate-agreement": () => import("./clauses/business-associate-agreement.json"),
  "cloud-service-agreement": () => import("./clauses/cloud-service-agreement.json"),
  "data-processing-agreement": () => import("./clauses/data-processing-agreement.json"),
  "design-partner-agreement": () => import("./clauses/design-partner-agreement.json"),
  "partnership-agreement": () => import("./clauses/partnership-agreement.json"),
  "pilot-agreement": () => import("./clauses/pilot-agreement.json"),
  "professional-services-agreement": () => import("./clauses/professional-services-agreement.json"),
  "service-level-agreement": () => import("./clauses/service-level-agreement.json"),
  "software-license-agreement": () => import("./clauses/software-license-agreement.json"),
};
