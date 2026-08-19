/**
 * Generates tests/fixtures/cc_wrapped.pdf — a synthetic 2-page credit card
 * statement whose transaction rows WRAP across three physical lines (issuer
 * geometry): description half / date+rewards+amount / description half. All
 * data is synthetic. Run once and commit the fixture:
 *
 *   node tests/fixtures/scripts/generate_wrapped_cc_pdf.mjs
 */
import * as fs from 'fs';
import * as path from 'path';

const ROWS_PER_PAGE = 30; // last row y = 740 - 29*22 - 4 = 98 > 0 (pdfjs drops y<0 items)

function escapePdfText(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** One BT/ET block per positioned string. */
function show(text, x, y) {
  return `BT /F1 9 Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function pageContent(pageIndex) {
  const ops = [
    show('SYNTHETIC CARD STATEMENT (TEST DATA)', 40, 770),
    // The table header — the shape Bug #1 Gate 1 rejected.
    show('DATE & TIME', 40, 760),
    show('TRANSACTION DESCRIPTION', 180, 760),
    show('REWARDS', 400, 760),
    show('AMOUNT (INR)', 480, 760),
  ];
  const start = pageIndex * ROWS_PER_PAGE;
  for (let i = 0; i < ROWS_PER_PAGE; i++) {
    const n = start + i + 1;
    const day = String((n % 28) + 1).padStart(2, '0');
    const amount = (100 + (n % 900) + 0.35).toFixed(2);
    const y = 740 - i * 22;
    // Wrapped row: description half above, date+rewards+amount centered,
    // description half below.
    ops.push(show(`SYNTHETIC MERCHANT ${n} GURUGRAM IN REF ${1000 + n}`, 180, y + 4));
    ops.push(show(`04/${day}/2025 00:00`, 40, y));
    ops.push(show(`+${n}`, 400, y));
    ops.push(show(amount, 480, y));
    ops.push(show(`VT25278007500000000${String(n).padStart(4, '0')})`, 180, y - 4));
  }
  return ops.join('\n');
}

function buildPdf(contentStreams) {
  const objects = [];
  const pageObjNums = contentStreams.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${contentStreams.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  contentStreams.forEach((stream, i) => {
    const pageNum = 4 + i * 2;
    const contentNum = pageNum + 1;
    objects[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`;
    objects[contentNum] = { stream: `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream` };
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = pdf.length;
    const obj = objects[i];
    pdf += `${i} 0 obj\n${typeof obj === 'string' ? obj : obj.stream}\nendobj\n`;
  }
  const xrefPos = pdf.length;
  const count = objects.length;
  pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return pdf;
}

const streams = [pageContent(0), pageContent(1)];
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'cc_wrapped.pdf');
fs.writeFileSync(out, buildPdf(streams), 'latin1');
console.log('wrote', out, fs.statSync(out).size, 'bytes');
