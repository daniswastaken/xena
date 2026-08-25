/**
 * contextBridge exposure — the ONLY surface the renderer may touch.
 */
import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS } from "../main/ipc/channels.js";

export interface SummonPayload {
  mode: "corner" | "cursor" | "dismiss";
}

export interface XenaApi {
  sendChat(text: string): Promise<void>;
  abortChat(): Promise<void>;
  clearChat(): Promise<void>;
  onChatToken(callback: (fullText: string) => void): () => void;
  onChatDone(callback: () => void): () => void;
  onChatError(callback: (message: string) => void): () => void;
  askVision(question: string): Promise<string>;
  onTtsAudio(callback: (base64Mp3: string) => void): () => void;
  onProactive(callback: (text: string) => void): () => void;
  onSummon(callback: (payload: SummonPayload) => void): () => void;
  noteActivity(): void;
  barDismissed(): void;
  requestBarResize(height: number): void;
  setClickThrough(interactive: boolean): void;
}

const api: XenaApi = {
  sendChat: (text) => ipcRenderer.invoke(CHANNELS.chatSend, text),
  abortChat: () => ipcRenderer.invoke(CHANNELS.chatAbort),
  clearChat: () => ipcRenderer.invoke(CHANNELS.chatClear),
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
    const listener = (_: unknown, message: string): void => callback(message);
    ipcRenderer.on(CHANNELS.chatError, listener);
    return () => ipcRenderer.removeListener(CHANNELS.chatError, listener);
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
};

contextBridge.exposeInMainWorld("xena", api);
