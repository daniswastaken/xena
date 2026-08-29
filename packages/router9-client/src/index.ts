export * from "./types.js";
export { findRepoRoot, readDotEnv } from "./paths.js";
export { loadConfig, type Router9Config } from "./config.js";
export { chatComplete, streamChat, parseCompletionBody } from "./chat/completions.js";
export {
  chatCompleteFailover,
  visionCompleteFailover,
  streamChatFailover,
  buildProviderChain,
  buildVisionChain,
  type FailoverChatOptions,
  type FailoverResult,
  type ProviderTarget,
} from "./chat/failover.js";
export { askAboutImage, buildImageMessage, imageDataUrl } from "./vision/ask.js";
export { geminiVision } from "./vision/gemini.js";
export { listModels, isVisionCapable } from "./models/registry.js";
