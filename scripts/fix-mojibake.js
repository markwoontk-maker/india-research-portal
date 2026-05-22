// General repair for double-encoded UTF-8 ("mojibake") in index.html.
// Happens when UTF-8 bytes get interpreted as Windows-1252 and re-saved
// as UTF-8 — e.g. an editor with the wrong default encoding.
//
// This is NOT a hand-listed set of fixes: it scans for UTF-8 lead bytes
// (0xC2-0xF4) that were mis-decoded into Windows-1252 characters, gathers
// the matching continuation bytes, and decodes the original character.
// So it repairs ▲ ▼ ₹ − — … © · etc. without naming them individually.

const fs = require('fs');
const path = process.argv[2] || 'C:/Users/admin/India-Research-Portal/index.html';

// Windows-1252 0x80-0x9F special chars -> Unicode codepoints. The other
// byte ranges (0x00-0x7F, 0xA0-0xFF) are identity-mapped (= Latin-1).
const CP1252_HIGH = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160,
  0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153,
  0x9E: 0x017E, 0x9F: 0x0178,
};

// Unicode codepoint -> Windows-1252 byte (single-byte-encodable chars only).
const toByte = new Map();
for (let b = 0; b <= 0xFF; b++) {
  if (b >= 0x80 && b <= 0x9F) {
    if (CP1252_HIGH[b] !== undefined) toByte.set(CP1252_HIGH[b], b);
  } else {
    toByte.set(b, b);
  }
}

const decoder = new TextDecoder('utf-8', { fatal: true });
const isCont = (b) => b !== undefined && b >= 0x80 && b <= 0xBF;

// One repair pass over a string. Returns { text, count }.
function repair(text) {
  const chars = Array.from(text);
  let out = '', count = 0;
  for (let i = 0; i < chars.length; ) {
    const lead = toByte.get(chars[i].codePointAt(0));
    // A genuine mojibake unit starts with a UTF-8 lead byte (0xC2-0xF4).
    if (lead === undefined || lead < 0xC2 || lead > 0xF4) {
      out += chars[i];
      i++;
      continue;
    }
    const len = lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
    const bytes = [lead];
    let ok = i + len <= chars.length;
    for (let k = 1; ok && k < len; k++) {
      const b = toByte.get(chars[i + k].codePointAt(0));
      if (!isCont(b)) { ok = false; break; }
      bytes.push(b);
    }
    if (ok) {
      try {
        const decoded = decoder.decode(Buffer.from(bytes));
        // Valid mojibake decodes to exactly one non-ASCII codepoint.
        if (Array.from(decoded).length === 1 && decoded.codePointAt(0) > 0x7F) {
          out += decoded;
          count++;
          i += len;
          continue;
        }
      } catch { /* not valid UTF-8 — leave as-is */ }
    }
    out += chars[i];
    i++;
  }
  return { text: out, count };
}

let text = fs.readFileSync(path, 'utf8');
let total = 0, pass = 0;
// Loop in case of triple-encoding; converges quickly.
while (pass < 4) {
  const r = repair(text);
  console.log(`  pass ${++pass}: ${r.count.toString().padStart(4)} sequences repaired`);
  total += r.count;
  text = r.text;
  if (r.count === 0) break;
}

fs.writeFileSync(path, text, 'utf8');
console.log(`Done. ${total} mojibake sequences fixed. Wrote ${Buffer.byteLength(text)} bytes to ${path}`);
