/**
 * @xena/inference-gateway — Xena's inference orchestrator.
 *
 * Replaces direct router9-client usage in apps/packages: callers get the
 * same function names with gateway semantics (Gemini primary, supervisor
 * state, classified errors). router9-client remains the transport layer
 * for the 9Router wire format and shared types.
 */
export { loadInferenceConfig, invalidateConfigCache, refreshInPlace, applyRuntimeOverrides, setEnvDir, type InferenceConfig } from "./config.js";
export { supervisor, resetInference, type ProviderId, type ProviderHealth, type ModelHealth } from "./supervisor.js";
export { NineRouterChild, type NineRouterChildState, type ChildEvents } from "./child9router.js";
export { InferenceError, type InferenceErrorKind } from "./errors.js";
export {
  chatCompleteFailover,
  visionCompleteFailover,
  streamChatFailover,
  describeChain,
  type FailoverOptions,
  type FailoverResult,
  type ChainUsage,
} from "./chain.js";

// Re-export the shared API types + helpers callers already use, so the
// import-line-only migration holds (ChatMessage, imageDataUrl, ...).
export { imageDataUrl, buildImageMessage, askAboutImage } from "./vision.js";
export { type ChatMessage, type ChatRole, type MessageContent, type TextPart, type ImageUrlPart, type ChatCompletionResult } from "@xena/router9-client";
