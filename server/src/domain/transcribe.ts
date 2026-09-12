import { env } from "../config.js";
import { utterances } from "./utterances.js";

export function resolveSpokenLang(bodyLang: unknown, elderLang: string): string {
  const b = typeof bodyLang === "string" ? bodyLang.trim() : "";
  if (b) return b;
  if (elderLang.trim()) return elderLang.trim();
  return "ar";
}

export function demoTranscribe(utteranceId: string) {
  const u = utterances.find((x) => x.id === utteranceId) ?? utterances[0];
  return { transcript: u.transcript, translation: u.translation, spoken_lang: u.spoken_lang };
}

export async function liveTranscribe(
  audio: Buffer, filename: string, mimetype: string, spokenLang: string,
) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  const mkForm = () => {
    const f = new FormData();
    f.append("file", new Blob([new Uint8Array(audio)], { type: mimetype || "audio/webm" }), filename);
    f.append("model", "whisper-1");
    return f;
  };
  const tForm = mkForm();
  tForm.append("language", spokenLang);
  const tr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: tForm,
  });
  if (!tr.ok) throw new Error(`transcription failed (${tr.status})`);
  const transcript = ((await tr.json()) as { text: string }).text.trim();

  let translation = transcript;
  if (spokenLang !== "en") {
    const tl = await fetch("https://api.openai.com/v1/audio/translations", {
      method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: mkForm(),
    });
    if (tl.ok) translation = ((await tl.json()) as { text: string }).text.trim();
  }
  return { transcript, translation, spoken_lang: spokenLang };
}
