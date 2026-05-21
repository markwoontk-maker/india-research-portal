// One-shot repair for double-encoded UTF-8 ("mojibake") in index.html.
// Happens when something interpreted UTF-8 bytes as Windows-1252 then
// re-saved as UTF-8 — e.g. an editor with the wrong default encoding.
//
// Each fix maps the 7-8 corrupted UTF-8 bytes back to the 3-byte
// original UTF-8 character. Done via Buffer.indexOf so visually-
// identical sequences (e.g. "â€"" for em-dash vs en-dash) don't
// collide.

const fs = require('fs');
const path = process.argv[2] || 'C:/Users/admin/India-Research-Portal/index.html';
let buf = fs.readFileSync(path);

// Common prefix bytes for "â€" = C3 A2 E2 82 AC
const PFX = [0xC3, 0xA2, 0xE2, 0x82, 0xAC];

const fixes = [
  // tail E2 80 9D ("”")  → em dash  (UTF-8 E2 80 94)
  { from: [...PFX, 0xE2, 0x80, 0x9D],  to: [0xE2, 0x80, 0x94], label: '— em dash' },
  // tail E2 80 9C ("“")  → en dash  (UTF-8 E2 80 93)
  { from: [...PFX, 0xE2, 0x80, 0x9C],  to: [0xE2, 0x80, 0x93], label: '– en dash' },
  // tail E2 84 A2 (™)         → right single quote (UTF-8 E2 80 99)
  { from: [...PFX, 0xE2, 0x84, 0xA2],  to: [0xE2, 0x80, 0x99], label: "' right single quote" },
  // tail C2 A6 (¦)            → ellipsis (UTF-8 E2 80 A6)
  { from: [...PFX, 0xC2, 0xA6],        to: [0xE2, 0x80, 0xA6], label: '… ellipsis' },
  // tail C2 A2 (¢)            → bullet   (UTF-8 E2 80 A2)
  { from: [...PFX, 0xC2, 0xA2],        to: [0xE2, 0x80, 0xA2], label: '• bullet' },
  // tail C2 B9 (¹)            → ‹        (UTF-8 E2 80 B9)
  { from: [...PFX, 0xC2, 0xB9],        to: [0xE2, 0x80, 0xB9], label: '‹ single angle quote' },
];

for (const f of fixes) {
  const from = Buffer.from(f.from), to = Buffer.from(f.to);
  let count = 0, pos = 0;
  const out = [];
  while (true) {
    const idx = buf.indexOf(from, pos);
    if (idx === -1) { out.push(buf.slice(pos)); break; }
    out.push(buf.slice(pos, idx), to);
    pos = idx + from.length;
    count++;
  }
  buf = Buffer.concat(out);
  console.log(`  ${f.label.padEnd(28)} ${count.toString().padStart(4)} replaced`);
}

// Second pass: drop spurious leading Â (C3 82) before any Latin-1
// supplement char (C2 XX). Mojibake for "·" is "Â·" (= C3 82 C2 B7),
// for "©" is "Â©", etc. The fix is just to strip the leading C3 82.
{
  const out = [];
  let i = 0, stripped = 0;
  while (i < buf.length) {
    if (i + 2 < buf.length && buf[i] === 0xC3 && buf[i+1] === 0x82 && buf[i+2] === 0xC2) {
      i += 2;  // skip the spurious Â
      stripped++;
      continue;
    }
    out.push(buf[i]);
    i++;
  }
  buf = Buffer.from(out);
  console.log(`  Â stripped before Latin-1   ${stripped.toString().padStart(4)} times`);
}

fs.writeFileSync(path, buf);
console.log(`Done. Wrote ${buf.length} bytes to ${path}`);
