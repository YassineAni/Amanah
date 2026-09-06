// Upload safety check. NOT a full antivirus — it validates that a file really is
// the (safe) type it claims to be, isn't truncated/corrupt, isn't an executable,
// and doesn't carry the EICAR test signature. A real deployment would call
// ClamAV or a cloud scanner here; this is the seam for that.

const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

const LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG image',
  'image/gif': 'GIF image',
  'image/webp': 'WebP image',
  'text/plain': 'text file',
}

export interface ScanResult {
  ok: boolean
  reason?: string
}

export function scanFile(buf: Buffer, mime: string): ScanResult {
  if (buf.length === 0) return { ok: false, reason: 'The file is empty or did not upload fully.' }

  // known antivirus test signature
  if (buf.includes(Buffer.from(EICAR)))
    return { ok: false, reason: 'This file matched a known malware test signature and was blocked.' }

  const head = buf.subarray(0, 16)
  const b = (i: number) => head[i]

  // executable headers, wherever they appear
  if (b(0) === 0x4d && b(1) === 0x5a)
    return { ok: false, reason: 'This looks like a Windows program, not a document.' }
  if (head.subarray(0, 4).toString('latin1') === '\x7fELF')
    return { ok: false, reason: 'This looks like an executable, not a document.' }

  // magic bytes must match the declared type (catches corruption + type spoofing)
  const magicOk = (() => {
    switch (mime) {
      case 'application/pdf':
        return head.subarray(0, 5).toString('latin1') === '%PDF-'
      case 'image/png':
        return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47
      case 'image/jpeg':
        return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff
      case 'image/gif':
        return head.subarray(0, 3).toString('latin1') === 'GIF'
      case 'image/webp':
        return (
          head.subarray(0, 4).toString('latin1') === 'RIFF' &&
          buf.subarray(8, 12).toString('latin1') === 'WEBP'
        )
      case 'text/plain':
        return true
      default:
        return false
    }
  })()
  if (!magicOk)
    return { ok: false, reason: `This file looks corrupted, or it is not really a ${LABEL[mime] ?? 'document'}.` }

  // a PDF should end with its trailer
  if (
    mime === 'application/pdf' &&
    !buf.subarray(Math.max(0, buf.length - 2048)).toString('latin1').includes('%%EOF')
  )
    return { ok: false, reason: 'This PDF appears to be truncated or corrupted.' }

  // "text" files carrying web/script markup
  if (mime === 'text/plain') {
    const sample = buf.subarray(0, 8192).toString('latin1')
    if (/<\s*script\b|<\?php\b|<!doctype\s+html/i.test(sample))
      return { ok: false, reason: 'This text file contains web or script markup and was blocked.' }
  }

  return { ok: true }
}
