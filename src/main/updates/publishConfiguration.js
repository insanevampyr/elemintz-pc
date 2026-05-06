export const RUNTIME_PUBLISH_CONFIGURATION = Object.freeze({
  provider: "github",
  owner: "insanevampyr",
  repo: "elemintz-pc",
  releaseType: "release"
});

export function hasRuntimePublishConfiguration(config = RUNTIME_PUBLISH_CONFIGURATION) {
  return Boolean(
    config &&
      typeof config === "object" &&
      typeof config.provider === "string" &&
      config.provider.trim() &&
      typeof config.owner === "string" &&
      config.owner.trim() &&
      typeof config.repo === "string" &&
      config.repo.trim()
  );
}
