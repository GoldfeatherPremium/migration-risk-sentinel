/**
 * Configurable project URLs. Set VITE_REPO_URL to your repository; the other
 * links are derived from it. Nothing here is fetched at runtime.
 */
const repo = (import.meta.env.VITE_REPO_URL as string | undefined)?.replace(/\/$/, "") || "https://github.com/OWNER/supabase-migration-guard";

export const SITE = {
  name: "Supabase Migration Guard",
  repoUrl: repo,
  issuesUrl: `${repo}/issues`,
  newIssueUrl: `${repo}/issues/new/choose`,
  releasesUrl: `${repo}/releases`,
  securityUrl: `${repo}/blob/main/SECURITY.md`,
  contributingUrl: `${repo}/blob/main/CONTRIBUTING.md`,
  repoConfigured: !repo.includes("/OWNER/"),
};
