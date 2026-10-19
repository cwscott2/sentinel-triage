/**
 * The one place this app names an OpenAI model.
 *
 * `gpt-4o` and `gpt-4o-mini` shut down on 2027-01-14 (OpenAI deprecations page,
 * entry dated 2026-10-14, re-read 2026-10-19). The recommended replacement for
 * both is `gpt-6-luna`, so the judgment / extraction split in the README
 * collapses to one model. The route and the agent loop import this constant;
 * nothing else may spell a model ID.
 *
 * `gpt-6-luna` is a reasoning model: it rejects `temperature` unless reasoning
 * effort is `none`, and the `ai` SDK (v4) does not recognise the `gpt-6` prefix
 * as a reasoning model, so the effort is passed explicitly on every call.
 *
 * Re-check this file against https://developers.openai.com/api/docs/deprecations
 * at each wrap-up (app-engrg-docs CROSS-APP-ACTIONS §9).
 */
export const OPENAI_MODEL_ID = "gpt-6-luna";

export const OPENAI_REASONING_EFFORT = "none";

/** Pass as `providerOptions` on every `generateText` / `generateObject` call. */
export const OPENAI_PROVIDER_OPTIONS = {
  openai: { reasoningEffort: OPENAI_REASONING_EFFORT },
};

/**
 * Model IDs that are retired or scheduled for shutdown. The guard test fails if
 * any of these appears anywhere in `src/`, `evals/` or `README.md` except here,
 * including inside a comment: a stale ID in a comment is how the next person
 * learns the wrong name.
 */
export const RETIRED_OPENAI_MODEL_IDS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4o-2024-05-13",
  "gpt-4o-2024-08-06",
  "gpt-4o-2024-11-20",
  "gpt-4o-mini-2024-07-18",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-3.5-turbo",
  "o1-mini",
  "o1-preview",
  "o3-mini",
  "o4-mini",
];
