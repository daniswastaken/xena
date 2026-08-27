/**
 * Typed IPC channel names + payload shapes shared by main and preload.
 */
export const CHANNELS = {
  chatSend: "chat:send",
  chatToken: "chat:token",
  chatDone: "chat:done",
  chatError: "chat:error",
  chatProvider: "chat:provider",
  chatThinking: "chat:thinking",
  chatAbort: "chat:abort",
  chatClear: "chat:clear",
  remember: "chat:remember",
  forget: "chat:forget",
  pointerShow: "pointer:show",
  pointerHide: "pointer:hide",
  gazeUpdate: "avatar:gaze",
  voiceRecordSet: "voice:record-set",
  voiceTranscribe: "voice:transcribe",
  getStats: "chat:stats",
  chatResize: "chat:resize",
  openExternal: "shell:open-external",
  visionAsk: "vision:ask",
  setClickThrough: "overlay:set-clickthrough",
  ttsAudio: "tts:audio",
  chatProactive: "chat:proactive",
  avatarEmote: "avatar:emote",
  live2dSet: "avatar:live2d",
  live2dGet: "avatar:live2d-get",
  summonAt: "bar:summon-at",
  barDismissed: "bar:dismissed",
  barResize: "bar:resize",
  noteActivity: "activity:note",
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
