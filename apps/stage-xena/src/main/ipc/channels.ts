/**
 * Typed IPC channel names + payload shapes shared by main and preload.
 */
export const CHANNELS = {
  chatSend: "chat:send",
  chatToken: "chat:token",
  chatDone: "chat:done",
  chatError: "chat:error",
  chatAbort: "chat:abort",
  chatClear: "chat:clear",
  visionAsk: "vision:ask",
  setClickThrough: "overlay:set-clickthrough",
  ttsAudio: "tts:audio",
  chatProactive: "chat:proactive",
  summonAt: "bar:summon-at",
  barDismissed: "bar:dismissed",
  barResize: "bar:resize",
  noteActivity: "activity:note",
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
