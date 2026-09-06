import type { Lang } from './types.js'
import { utterances } from './seed.js'

export interface TranscribeResult {
  transcript: string
  translation: string
  spokenLang: Lang
}

/** demo path — a seeded utterance, zero network. */
export function demoTranscribe(utteranceId: string): TranscribeResult {
  const u = utterances.find((x) => x.id === utteranceId) ?? utterances[0]
  return { transcript: u.transcript, translation: u.translation, spokenLang: u.spokenLang }
}

/** live path — OpenAI Whisper. Key stays on the server. */
export async function liveTranscribe(
  audio: Buffer,
  filename: string,
  mimetype: string,
  spokenLang: Lang,
): Promise<TranscribeResult> {
  const KEY = process.env.OPENAI_API_KEY
  if (!KEY) throw new Error('OPENAI_API_KEY not set — use demo mode')

  const mkForm = () => {
    const f = new FormData()
    f.append('file', new Blob([new Uint8Array(audio)], { type: mimetype || 'audio/webm' }), filename)
    f.append('model', 'whisper-1')
    return f
  }

  const tForm = mkForm()
  tForm.append('language', spokenLang)
  const tr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}` },
    body: tForm,
  })
  if (!tr.ok) throw new Error(`transcription failed (${tr.status})`)
  const transcript = ((await tr.json()) as { text: string }).text.trim()

  let translation = transcript
  if (spokenLang !== 'en') {
    const tl = await fetch('https://api.openai.com/v1/audio/translations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}` },
      body: mkForm(),
    })
    if (tl.ok) translation = ((await tl.json()) as { text: string }).text.trim()
  }
  return { transcript, translation, spokenLang }
}
