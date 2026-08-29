/**
 * IPC handlers: chat streaming relay, vision ask, TTS relay.
 * Renderer never fetches directly — everything goes through here.
 */
import { ipcMain, Notification } from "electron";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Session } from "@xena/xena-core";
import { MemoryStore } from "@xena/xena-core";
import { Diary } from "@xena/xena-core";
import { FactsStore } from "@xena/xena-core";
import { extractEmotion, extractFactTags, buildSystemPrompt } from "@xena/xena-core";
import { askAboutImage, chatCompleteFailover, type InferenceConfig } from "@xena/inference-gateway";
import { bubbleLine, errorKind, guidedTaskLine, notifyLine, rawDetail, barLine } from "../ui/error-lines.js";
import { CHANNELS } from "./channels.js";
import { captureScreenDataUrl } from "../capture/screenshot.js";
import { GuidedTask, looksLikeGuidedTask } from "../pointer/guided-task.js";
import type { PointerWindow } from "../window/pointer-window.js";
import { speakReply } from "../tts/speak.js";
import type { SettingsStore } from "../settings/store.js";
import type { ProactiveScheduler } from "../proactive/scheduler.js";
import type { BarWindow } from "../window/bar-window.js";
import { dataDir } from "../paths.js";

const DATA_DIR = dataDir();

/** Fresh-screen cache: follow-up /look questions reuse the last capture. */
const CAPTURE_TTL_MS = 60_000;
let lastCapture: { dataUrl: string; at: number } | null = null;

async function getScreenCapture(): Promise<string> {
  if (lastCapture && Date.now() - lastCapture.at < CAPTURE_TTL_MS) {
    return lastCapture.dataUrl;
  }
  const dataUrl = await captureScreenDataUrl();
  lastCapture = { dataUrl, at: Date.now() };
  return dataUrl;
}

/** One session per calendar day — history rotates daily. */
function todaySessionId(): string {
  return `default-${new Date().toISOString().slice(0, 10)}`;
}

export function registerIpcHandlers(
  config: InferenceConfig,
  settings: SettingsStore,
  scheduler: ProactiveScheduler,
  bar: BarWindow,
  avatarWin: () => Electron.BrowserWindow,
  pointer?: PointerWindow,
  gaze?: { lookAtPoint: (x: number, y: number, holdMs?: number) => void },
): void {
  let currentSessionId = todaySessionId();
  let guidedTask: GuidedTask | null = null;

  function openSession(): Promise<Session> {
    return settings.get().then(({ textModel }) => {
      return Session.open(
        {
          sessionId: currentSessionId,
          storeDir: DATA_DIR,
          model: textModel || undefined,
          diaryDir: join(DATA_DIR, "diary"),
          factsPath: join(DATA_DIR, "facts.json"),
        },
        config,
      ).then((r) => r.session);
    });
  }

  /** Reopens the session when the calendar day or model changed. */
  async function getSession(): Promise<Session> {
    if (currentSessionId !== todaySessionId()) {
      const previous = currentSessionId;
      currentSessionId = todaySessionId();
      sessionReady = openSession();
      // Nightly diary for yesterday's transcript — fire and forget.
      void new Diary(new MemoryStore(DATA_DIR), join(DATA_DIR, "diary"))
        .writeForSession(previous, config)
        .catch(() => undefined);
    }
    return sessionReady;
  }

  let sessionReady: Promise<Session> = openSession();

  // Hygiene: drop transcripts older than 30 days, fire-and-forget.
  void new MemoryStore(DATA_DIR).pruneOlderThan(30).catch(() => undefined);

  /** One-time friendly intro when Xena has never met this user. */
  async function maybeFirstRunGreeting(): Promise<void> {
    try {
      const store = new MemoryStore(DATA_DIR);
      if ((await store.listAll()).length > 0) return;
      const greeted = join(DATA_DIR, ".greeted");
      try {
        await access(greeted);
        return;
      } catch {
        /* not greeted yet */
      }
      await writeFile(greeted, new Date().toISOString(), "utf8");
      const result = await chatCompleteFailover(
        [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content:
              "This is the very first time we meet. Say ONE short friendly intro (max 12 words) — you just woke up as a witch sprite in Father's screen corner.",
          },
        ],
        { maxTokens: 70, temperature: 1.0 },
        config,
      );
      const { clean, emotion } = extractEmotion(result.content.trim());
      if (clean === "") return;
      avatarWin().webContents.send(CHANNELS.avatarEmote, emotion ?? "");
            avatarWin().webContents.send(CHANNELS.chatProactive, clean);
      await maybeSpeak(clean);
    } catch {
      // greeting is best-effort
    }
  }
  setTimeout(() => void maybeFirstRunGreeting(), 90_000);

  async function maybeSpeak(text: string, mood?: string): Promise<void> {
    const { voiceEnabled } = await settings.get();
    if (!voiceEnabled || text.trim() === "") return;
    try {
      const audio = await speakReply(text, mood);
      avatarWin().webContents.send(CHANNELS.ttsAudio, audio);
    } catch (err) {
      console.error(`[tts] maybeSpeak failed: ${(err as Error).message ?? err}`);
    }
  }

  let lastFailToastAt = 0;

  function notifyBrainDown(error: unknown): void {
    // Only when every rung failed; throttle to one toast per 5 minutes.
    const body = notifyLine(error);
    if (body === "") return;
    if (Date.now() - lastFailToastAt < 5 * 60_000) return;
    lastFailToastAt = Date.now();
    console.error(`[inference] chain failure — ${rawDetail(error)}`);
    try {
      new Notification({
        title: "Xena can't reach her brain",
        body,
        silent: true,
      }).show();
    } catch {
      // notifications are best-effort
    }
  }

  /** Persona-voice error to the bubble; never raw provider detail. */
  function presentReplyError(error: unknown): void {
    const kind = errorKind(error);
    if (kind === "aborted") return; // user's own stop — silence
    const surface = bubbleLine(error);
    if (!surface) return;
    avatarWin().webContents.send(CHANNELS.chatError, { line: surface.line, kind });
    avatarWin().webContents.send(CHANNELS.avatarEmote, surface.mood);
    notifyBrainDown(error);
  }

  ipcMain.handle(CHANNELS.chatSend, async (_event, text: unknown) => {
    if (typeof text !== "string" || text.trim() === "") throw new Error("empty message");
    const trimmed = text.trim();
    scheduler.noteActivity();
    // Instant perk-up when her name is spoken — no waiting on the model.
    if (/\bxena\b/i.test(trimmed)) {
      avatarWin().webContents.send(CHANNELS.avatarEmote, "happy");
    }
    // Command interception for non-bar entry paths (hotkey/CDP sendChat).
    if (trimmed.startsWith("/remember ")) {
      const confirmation = await handleRemember(trimmed.slice(10));
      avatarWin().webContents.send(CHANNELS.chatToken, confirmation);
      avatarWin().webContents.send(CHANNELS.chatDone, true);
      return;
    }
    if (trimmed.startsWith("/forget ")) {
      const confirmation = await handleForget(trimmed.slice(8));
      avatarWin().webContents.send(CHANNELS.chatToken, confirmation);
      avatarWin().webContents.send(CHANNELS.chatDone, true);
      return;
    }
    if (trimmed === "/help") {
      avatarWin().webContents.send(CHANNELS.chatToken, HELP_TEXT);
      avatarWin().webContents.send(CHANNELS.chatDone, true);
      return;
    }
    if (looksLikeGuidedTask(trimmed)) {
      const task = new GuidedTask(config, pointer ?? (() => { throw new Error("pointer unavailable"); })() as PointerWindow, {
        send: (reply) => avatarWin().webContents.send(CHANNELS.chatToken, reply),
        sendDone: () => avatarWin().webContents.send(CHANNELS.chatDone, true),
        emote: (mood) => avatarWin().webContents.send(CHANNELS.avatarEmote, mood),
        speak: (reply, mood) => maybeSpeak(reply, mood),
        append: async (role, content) => {
          const session = await getSession();
          await session.append({ role, content });
        },
      });
      if (!pointer) throw new Error("pointer unavailable");
      guidedTask = task;
      scheduler.setBusy(true);
      avatarWin().webContents.send(CHANNELS.chatThinking, true);
      void task.run(trimmed).catch((error: unknown) => {
        avatarWin().webContents.send(CHANNELS.chatThinking, false);
        const surface = guidedTaskLine();
        avatarWin().webContents.send(CHANNELS.chatError, { line: surface.line, kind: errorKind(error) });
        avatarWin().webContents.send(CHANNELS.avatarEmote, surface.mood);
        console.error(`[inference] guided task failed — ${rawDetail(error)}`);
        avatarWin().webContents.send(CHANNELS.chatDone, true);
      }).finally(() => {
        if (guidedTask === task) guidedTask = null;
        scheduler.setBusy(false);
        avatarWin().webContents.send(CHANNELS.chatThinking, false);
      });
      return;
    }
    if (trimmed === "/stats") {      const session = await getSession();
      const msgs = session.history().filter((m) => m.role !== "system").length;
      const facts = await new FactsStore(join(DATA_DIR, "facts.json")).listAll();
      const diaries = (await new Diary(new MemoryStore(DATA_DIR), join(DATA_DIR, "diary")).listAll()).length;
      bar.win.webContents.send(
        CHANNELS.chatToken,
        `Today: ${msgs} messages. Long-term: ${facts.length} fact${facts.length === 1 ? "" : "s"}, ${diaries} diary entr${diaries === 1 ? "y" : "ies"}.`,
      );
      avatarWin().webContents.send(CHANNELS.chatDone, true);
      return;
    }
    const wasBusyAtSubmit = scheduler.isBusy();
    scheduler.setBusy(true);
    let thinkingShown = false;
    // Loading indicator lives in the bubble from submit until the first
    // token — the bar is dismissed on Enter, so the dots ARE the feedback.
    if (!wasBusyAtSubmit) {
      thinkingShown = true;
      avatarWin().webContents.send(CHANNELS.chatThinking, true);
    }
    try {
      const session = await getSession();
      // Stream error surfaces only when nothing reached the bubble;
      // a partial reply stands as-is (ADR-001 no-restart invariant).
      let streamError: unknown = null;
      const reply = await session.send(text.trim(), {
        onToken: (full) => {
                      if (thinkingShown) {
            thinkingShown = false;
            avatarWin().webContents.send(CHANNELS.chatThinking, false);
          }
          avatarWin().webContents.send(CHANNELS.chatToken, full);
        },
        onError: (error) => {
          streamError = error;
          console.error(`[inference] reply failed — ${rawDetail(error)}`);
        },
        onReasoning: () => {
          if (!thinkingShown) {
            thinkingShown = true;
            avatarWin().webContents.send(CHANNELS.chatThinking, true);
          }
        },
      });
      if (streamError !== null && reply.trim() === "") {
        presentReplyError(streamError);
        return;
      }
      avatarWin().webContents.send(CHANNELS.chatDone, true);
      // Reading time scales with the answer: 8s base + 20ms/char (max +20s).
      const { clean, emotion } = extractEmotion(reply);
      const { clean: speakable, facts } = extractFactTags(clean);
      avatarWin().webContents.send(CHANNELS.avatarEmote, emotion ?? "");
      // Model-curated memory: [fact: ...] tags persist to the facts store.
      if (facts.length > 0) {
        const factsStore = new FactsStore(join(DATA_DIR, "facts.json"));
        void factsStore.add(facts[0]!).catch(() => undefined);
      }
      await maybeSpeak(speakable, emotion ?? undefined);
    } finally {
      scheduler.setBusy(false);
    }
  });

  ipcMain.handle(CHANNELS.chatAbort, async () => {
    guidedTask?.cancel();
    const session = await sessionReady;
    session.abort();
  });

  ipcMain.handle(CHANNELS.chatClear, async () => {
    const session = await getSession();
    await session.reset();
  });

  async function handleRemember(fact: string): Promise<string> {
    await new FactsStore(join(DATA_DIR, "facts.json")).add(fact.slice(0, 500));
    return `Noted — I'll remember that.`;
  }

  async function handleForget(keyword: string): Promise<string> {
    const path = join(DATA_DIR, "facts.json");
    const store = new FactsStore(path);
    const all = await store.listAll();
    const needle = keyword.trim().toLowerCase();
    const kept = all.filter((f) => !f.text.toLowerCase().includes(needle));
    const removed = all.length - kept.length;
    if (removed === 0) return `Nothing in my facts matches "${keyword.trim()}".`;
    await store.rewrite(kept);
    return `Forgot ${removed} fact${removed === 1 ? "" : "s"} matching "${keyword.trim()}".`;
  }

  const HELP_TEXT = [
    "Commands:",
    "/look <question> — share your screen and ask about it",
    "/remember <fact> — I'll keep this permanently",
    "/forget <keyword> — drop matching facts",
    "/clear — wipe today's conversation",
    "/help — this list",
  ].join("\n");

  ipcMain.handle(CHANNELS.remember, async (_event, text: unknown) => {
    if (typeof text !== "string" || text.trim() === "") throw new Error("empty fact");
    return handleRemember(text.trim());
  });

  ipcMain.handle(CHANNELS.forget, async (_event, text: unknown) => {
    if (typeof text !== "string" || text.trim() === "") throw new Error("empty keyword");
    return handleForget(text.trim());
  });

  ipcMain.handle(CHANNELS.live2dGet, async () => {
    const { avatarEnabled } = await settings.get();
    return { enabled: avatarEnabled, model: "mao" };
  });

  ipcMain.handle(CHANNELS.getStats, async () => {
    const session = await getSession();
    const msgs = session.history().filter((m) => m.role !== "system").length;
    const facts = await new FactsStore(join(DATA_DIR, "facts.json")).listAll();
    const diaries = (await new Diary(new MemoryStore(DATA_DIR), join(DATA_DIR, "diary")).listAll()).length;
    return `Today: ${msgs} messages. Long-term: ${facts.length} fact${facts.length === 1 ? "" : "s"}, ${diaries} diary entr${diaries === 1 ? "y" : "ies"}.`;
  });

  ipcMain.on(CHANNELS.noteActivity, () => {
    scheduler.noteActivity();
  });

  ipcMain.on(CHANNELS.barDismissed, () => {
    bar.hide();
  });

  ipcMain.handle(CHANNELS.visionAsk, async (_event, question: unknown) => {
    const q =
      typeof question === "string" && question.trim() !== ""
        ? question.trim()
        : "What am I looking at?";
    scheduler.noteActivity();
    const free = !scheduler.isBusy();
    if (free) avatarWin().webContents.send(CHANNELS.chatThinking, true);
    const dataUrl = await getScreenCapture();
    let answer: string;
    try {
      answer = await askAboutImage(q, dataUrl, config, buildSystemPrompt());
    } catch (error) {
      if (free) avatarWin().webContents.send(CHANNELS.chatThinking, false);
      console.error(`[inference] /look failed — ${rawDetail(error)}`);
      throw new Error(barLine(error));
    }
    const { clean, emotion } = extractEmotion(answer.trim());
    const { clean: speakable, facts } = extractFactTags(clean);
    // Vision Q&A joins the transcript — "what did you see earlier?" works.
    // Keep mood metadata for conversational continuity.
    try {
      const session = await getSession();
      await session.append({ role: "user", content: `[shared screen] ${q}` });
      await session.append({
        role: "assistant",
        content: emotion ? `[${emotion}] ${speakable}` : speakable,
      });
    } catch {
      // memory persistence is best-effort
    }
    avatarWin().webContents.send(CHANNELS.avatarEmote, emotion ?? "");
    if (facts.length > 0) {
      void new FactsStore(join(DATA_DIR, "facts.json")).add(facts[0]!).catch(() => undefined);
    }
    if (!scheduler.isBusy()) {
      avatarWin().webContents.send(CHANNELS.chatToken, speakable);
      avatarWin().webContents.send(CHANNELS.chatDone, true);
    }
    await maybeSpeak(speakable, emotion ?? undefined);
    return speakable;
  });
}





