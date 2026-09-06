// Read-aloud for the elder. Prefers the OpenAI voice via the backend; falls back
// to the browser's built-in speech if that fails or there's no network.
import { api, type Lang } from "./api";

const RA_KEY = "her-day-readaloud";

export function readAloudEnabled(): boolean {
  try {
    return sessionStorage.getItem(RA_KEY) === "1";
  } catch {
    return false;
  }
}

export function setReadAloud(on: boolean) {
  try {
    sessionStorage.setItem(RA_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

let current: HTMLAudioElement | null = null;

export function stopSpeaking() {
  if (current) {
    current.pause();
    current = null;
  }
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

const cache = new Map<string, string>(); // text|lang -> objectURL

/** Speak `text`. Safe to call anytime; no-ops on empty text. */
export async function speak(text: string, lang: Lang = "en"): Promise<void> {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return;
  stopSpeaking();

  const key = `${lang}|${clean}`;
  try {
    let url = cache.get(key);
    if (!url) {
      const blob = await api.tts(clean, lang);
      url = URL.createObjectURL(blob);
      cache.set(key, url);
    }
    const a = new Audio(url);
    current = a;
    a.onended = () => {
      if (current === a) current = null;
    };
    await a.play();
    return;
  } catch {
    // fall through to browser speech
  }

  try {
    if (typeof speechSynthesis === "undefined") return;
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = lang === "ar" ? "ar-SA" : lang === "fr" ? "fr-FR" : "en-US";
    u.rate = 0.95;
    const voices = speechSynthesis.getVoices();
    const match = voices.find((v) => v.lang.toLowerCase().startsWith(lang));
    if (match) u.voice = match;
    speechSynthesis.speak(u);
  } catch {
    /* nothing more we can do */
  }
}
