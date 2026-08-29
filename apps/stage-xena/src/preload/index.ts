/**
 * contextBridge exposure — the ONLY surface the renderer may touch.
 */
import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS } from "../main/ipc/channels.js";

export interface Live2dConfig {
  enabled: boolean;
  /** resolved folder name under assets/live2d/ */
  model: string;
}

export interface SummonPayload {
  mode: "corner" | "cursor" | "dismiss";
}

export interface XenaApi {
  sendChat(text: string): Promise<void>;
  abortChat(): Promise<void>;
   clearChat(): Promise<void>;
   remember(text: string): Promise<string>;
   forget(text: string): Promise<string>;
   onChatToken(callback: (fullText: string) => void): () => void;
   onChatDone(callback: () => void): () => void;
    onChatError(callback: (payload: { line: string; kind: string }) => void): () => void;
    onChatThinking(callback: (active: boolean) => void): () => void;
  askVision(question: string): Promise<string>;
   onTtsAudio(callback: (base64Mp3: string) => void): () => void;
   onProactive(callback: (text: string) => void): () => void;
   onEmote(callback: (emotion: string) => void): () => void;
   onLive2d(callback: (config: Live2dConfig) => void): () => void;
   getLive2d(): Promise<Live2dConfig>;
  submitSetup(text: string): void;
  backSetup(): void;
  notifySetupAudioEnd(): void;
  onSetupBegin(callback: () => void): () => void;
  onSetupBubble(callback: (text: string) => void): () => void;
  onSetupMood(callback: (mood: string) => void): () => void;
  onSetupDone(callback: () => void): () => void;
  onSetupStep(callback: (step: string) => void): () => void;
  onSummon(callback: (payload: SummonPayload) => void): () => void;
    onPointerShow(callback: (payload: { x: number; y: number; label: string; dwellMs: number }) => void): () => void;
    onPointerHide(callback: () => void): () => void;
    onGaze(callback: (payload: { dx: number; dy: number; hold?: number }) => void): () => void;
    getStats(): Promise<string>;
   requestChatResize(height: number): void;
   openExternal(url: string): void;
  noteActivity(): void;
  barDismissed(): void;
  requestBarResize(height: number): void;
  setClickThrough(interactive: boolean): void;
}

const api: XenaApi = {
  sendChat: (text) => ipcRenderer.invoke(CHANNELS.chatSend, text),
  abortChat: () => ipcRenderer.invoke(CHANNELS.chatAbort),
   clearChat: () => ipcRenderer.invoke(CHANNELS.chatClear),
   remember: (text) => ipcRenderer.invoke(CHANNELS.remember, text),
   forget: (text) => ipcRenderer.invoke(CHANNELS.forget, text),
  askVision: (question) => ipcRenderer.invoke(CHANNELS.visionAsk, question),
  noteActivity: () => ipcRenderer.send(CHANNELS.noteActivity),
  barDismissed: () => ipcRenderer.send(CHANNELS.barDismissed),
  requestBarResize: (height: number) => ipcRenderer.send(CHANNELS.barResize, height),
  setClickThrough: (interactive) => ipcRenderer.send(CHANNELS.setClickThrough, interactive),
  onChatToken: (callback) => {
    const listener = (_: unknown, full: string): void => callback(full);
    ipcRenderer.on(CHANNELS.chatToken, listener);
    return () => ipcRenderer.removeListener(CHANNELS.chatToken, listener);
  },
  onChatDone: (callback) => {
    const listener = (): void => callback();
    ipcRenderer.on(CHANNELS.chatDone, listener);
    return () => ipcRenderer.removeListener(CHANNELS.chatDone, listener);
  },
  onChatError: (callback) => {
    const listener = (_: unknown, payload: { line: string; kind: string }): void => callback(payload);
    ipcRenderer.on(CHANNELS.chatError, listener);
    return () => ipcRenderer.removeListener(CHANNELS.chatError, listener);
  },
  onChatThinking: (callback) => {
    const listener = (_: unknown, active: boolean): void => callback(active);
    ipcRenderer.on(CHANNELS.chatThinking, listener);
    return () => ipcRenderer.removeListener(CHANNELS.chatThinking, listener);
  },
  onTtsAudio: (callback) => {
    const listener = (_: unknown, audio: string): void => callback(audio);
    ipcRenderer.on(CHANNELS.ttsAudio, listener);
    return () => ipcRenderer.removeListener(CHANNELS.ttsAudio, listener);
  },
  onProactive: (callback) => {
    const listener = (_: unknown, text: string): void => callback(text);
    ipcRenderer.on(CHANNELS.chatProactive, listener);
    return () => ipcRenderer.removeListener(CHANNELS.chatProactive, listener);
  },
  onSummon: (callback) => {
    const listener = (_: unknown, payload: SummonPayload): void => callback(payload);
    ipcRenderer.on(CHANNELS.summonAt, listener);
    return () => ipcRenderer.removeListener(CHANNELS.summonAt, listener);
  },
  onPointerShow: (callback) => {
    const listener = (_: unknown, payload: { x: number; y: number; label: string; dwellMs: number }): void => callback(payload);
    ipcRenderer.on(CHANNELS.pointerShow, listener);
    return () => ipcRenderer.removeListener(CHANNELS.pointerShow, listener);
  },
  onPointerHide: (callback) => {
    const listener = (): void => callback();
    ipcRenderer.on(CHANNELS.pointerHide, listener);
    return () => ipcRenderer.removeListener(CHANNELS.pointerHide, listener);
  },
  onGaze: (callback) => {
    const listener = (_: unknown, payload: { dx: number; dy: number; hold?: number }): void => callback(payload);
    ipcRenderer.on(CHANNELS.gazeUpdate, listener);
    return () => ipcRenderer.removeListener(CHANNELS.gazeUpdate, listener);
  },
  getStats: () => ipcRenderer.invoke(CHANNELS.getStats),
  requestChatResize: (height: number) => ipcRenderer.send(CHANNELS.chatResize, height),
  openExternal: (url: string) => ipcRenderer.send(CHANNELS.openExternal, url),
  onEmote: (callback) => {
    const listener = (_: unknown, emotion: string): void => callback(emotion);
    ipcRenderer.on(CHANNELS.avatarEmote, listener);
    return () => ipcRenderer.removeListener(CHANNELS.avatarEmote, listener);
  },
  onLive2d: (callback) => {
    const listener = (_: unknown, config: Live2dConfig): void => callback(config);
    ipcRenderer.on(CHANNELS.live2dSet, listener);
    return () => ipcRenderer.removeListener(CHANNELS.live2dSet, listener);
  },
  getLive2d: () => ipcRenderer.invoke(CHANNELS.live2dGet),
  submitSetup: (text: string) => ipcRenderer.send(CHANNELS.setupSubmit, text),
  backSetup: () => ipcRenderer.send(CHANNELS.setupBack),
  notifySetupAudioEnd: () => ipcRenderer.send(CHANNELS.setupAudioEnd),
  onSetupBegin: (callback) => {
    const listener = (): void => callback();
    ipcRenderer.on(CHANNELS.setupBegin, listener);
    return () => ipcRenderer.removeListener(CHANNELS.setupBegin, listener);
  },
  onSetupBubble: (callback) => {
    const listener = (_: unknown, text: string): void => callback(text);
    ipcRenderer.on(CHANNELS.setupBubble, listener);
    return () => ipcRenderer.removeListener(CHANNELS.setupBubble, listener);
  },
  onSetupMood: (callback) => {
    const listener = (_: unknown, mood: string): void => callback(mood);
    ipcRenderer.on(CHANNELS.setupMood, listener);
    return () => ipcRenderer.removeListener(CHANNELS.setupMood, listener);
  },
  onSetupDone: (callback) => {
    const listener = (): void => callback();
    ipcRenderer.on(CHANNELS.setupDone, listener);
    return () => ipcRenderer.removeListener(CHANNELS.setupDone, listener);
  },
  onSetupStep: (callback) => {
    const listener = (_: unknown, step: string): void => callback(step);
    ipcRenderer.on(CHANNELS.setupStep, listener);
    return () => ipcRenderer.removeListener(CHANNELS.setupStep, listener);
  },
};

contextBridge.exposeInMainWorld("xena", api);
