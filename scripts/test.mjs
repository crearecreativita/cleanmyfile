// Test della logica (JPEG, PNG, WebP e PDF): node scripts/test.mjs
// Per i test sui PDF serve pdf-lib (npm i --no-save pdf-lib@1.17.1); se manca, quei test vengono saltati.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const core = require(join(dirname(fileURLToPath(import.meta.url)), '../frontend/ac-cleanmyfile.js'));
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok -', name); };
const bytes = (...p) => Uint8Array.from(p.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : Array.from(x))));
const has = (b, s) => Buffer.from(b).includes(Buffer.from(s, 'latin1'));
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const le32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];

// --- JPEG sintetico ---
const seg = (marker, payload) => bytes([0xFF, marker], [(payload.length + 2) >> 8, (payload.length + 2) & 255], payload);
// APP1 Exif minimo con Orientation = 6, little endian (come fanno gli smartphone)
const exifOrient6 = seg(0xE1, bytes('Exif\0\0', 'II', [0x2A, 0], le32(8), [1, 0], [0x12, 0x01, 3, 0], le32(1), [6, 0, 0, 0], le32(0), 'GPSSECRET'));
const jpeg = bytes(
  [0xFF, 0xD8],
  seg(0xE0, bytes('JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0])),
  exifOrient6,
  seg(0xE1, bytes('http://ns.adobe.com/xap/1.0/\0', '<x:xmpmeta>AUTORE-XMP</x:xmpmeta>')),
  seg(0xE2, bytes('ICC_PROFILE\0', [1, 1], 'profilo')),
  seg(0xE2, bytes('MPF\0', 'multipicture')),
  seg(0xED, bytes('Photoshop 3.0\0', '8BIM IPTC-NOME')),
  seg(0xEB, bytes('JP\0\0', 'c2pa-manifest')),
  seg(0xFE, bytes('commento privato')),
  seg(0xDB, bytes([0, 1, 2, 3])),
  seg(0xDA, bytes([1, 1, 0, 0, 63, 0])),
  [0x12, 0x34, 0xFF, 0x00, 0x56], // dati compressi (con byte stuffing)
  [0xFF, 0xD9],
);

await t('JPEG: detectFormat e jpegInfo leggono i segmenti e l’orientamento', () => {
  assert.equal(core.detectFormat(jpeg), 'jpeg');
  const i = core.jpegInfo(jpeg);
  assert.equal(i.complete, true);
  assert.equal(i.orientation, 6);
  for (const k of ['jfif', 'exif', 'xmp', 'icc', 'mpf', 'iptc', 'jumbf', 'comment']) assert.ok(i.kinds[k], k);
  assert.deepEqual(i.comments, ['commento privato']);
});

await t('JPEG: stripJpeg toglie EXIF, XMP, IPTC, commenti, JUMBF e MPF', () => {
  const o = core.stripJpeg(jpeg);
  for (const s of ['GPSSECRET', 'AUTORE-XMP', 'IPTC-NOME', 'commento privato', 'c2pa-manifest', 'multipicture']) assert.ok(!has(o, s), s);
});

await t('JPEG: tiene JFIF, profilo ICC, tabelle e dati compressi', () => {
  const o = core.stripJpeg(jpeg);
  assert.ok(has(o, 'JFIF') && has(o, 'profilo'));
  assert.deepEqual([...o.slice(-7, -2)], [0x12, 0x34, 0xFF, 0x00, 0x56]);
  assert.deepEqual([...o.slice(-2)], [0xFF, 0xD9]);
});

await t('JPEG: l’orientamento sopravvive (altrimenti la foto verticale si vede ruotata) e il risultato è rileggibile', () => {
  const o = core.stripJpeg(jpeg), i = core.jpegInfo(o);
  assert.equal(i.complete, true);
  assert.equal(i.orientation, 6);
  assert.deepEqual(Object.keys(i.kinds).sort(), ['exif', 'icc', 'jfif']);
  assert.ok(o.length < jpeg.length);
});

await t('JPEG: senza orientamento non resta alcun EXIF', () => {
  const plain = bytes([0xFF, 0xD8], seg(0xE0, bytes('JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0])), seg(0xE1, bytes('Exif\0\0', 'MM', [0, 42], u32(8), [0, 0], u32(0))), seg(0xDA, bytes([1, 1, 0, 0, 63, 0])), [9, 9], [0xFF, 0xD9]);
  assert.equal(core.jpegInfo(core.stripJpeg(plain)).kinds.exif, undefined);
});

await t('JPEG: file troncato → errore (la UI passa al ripiego canvas)', () => {
  assert.throws(() => core.stripJpeg(jpeg.slice(0, 40)));
});

// --- PNG sintetico ---
const chunk = (type, data) => bytes(u32(data.length), type, data, [0, 0, 0, 0]);
const png = bytes([137, 80, 78, 71, 13, 10, 26, 10],
  chunk('IHDR', bytes(u32(1), u32(1), [8, 2, 0, 0, 0])),
  chunk('tEXt', bytes('Author\0', 'Mario Rossi')),
  chunk('iTXt', bytes('parameters\0', [0, 0], 'it\0', '\0', 'prompt segreto')),
  chunk('eXIf', bytes('Exif\0\0', 'GPS-PNG')),
  chunk('tIME', bytes([0x07, 0xE9, 5, 17, 14, 30, 0])),
  chunk('caBX', bytes('c2pa')),
  chunk('iCCP', bytes('sRGB\0', [0], 'profilo')),
  chunk('pHYs', bytes(u32(2835), u32(2835), [1])),
  chunk('IDAT', bytes([1, 2, 3, 4])),
  chunk('IEND', bytes()));

await t('PNG: pngInfo elenca testo, EXIF, data e il profilo mantenuto', () => {
  const r = core.pngInfo(png), by = (l) => r.find((x) => x.label === l);
  assert.equal(by('Author').value, 'Mario Rossi');
  assert.equal(by('parameters').value, 'prompt segreto');
  assert.ok(by('Dati EXIF') && by('Ultima modifica').value === '17/05/2025 14:30');
  assert.ok(by('Profilo colore ICC').kept);
});

await t('PNG: stripPng toglie testo, EXIF, data e chunk ignoti; tiene pixel e colore', () => {
  const o = core.stripPng(png);
  for (const s of ['Mario Rossi', 'prompt segreto', 'GPS-PNG', 'c2pa', 'tIME', 'eXIf', 'tEXt', 'iTXt', 'caBX']) assert.ok(!has(o, s), s);
  for (const s of ['IHDR', 'IDAT', 'IEND', 'iCCP', 'pHYs']) assert.ok(has(o, s), s);
  assert.equal(core.pngInfo(o).filter((r) => !r.kept).length, 0);
});

await t('PNG: file senza IEND → errore', () => {
  assert.throws(() => core.stripPng(png.slice(0, png.length - 12)));
});

// --- WebP sintetico ---
const wchunk = (type, data) => bytes(type, le32(data.length), data, data.length & 1 ? [0] : []);
const body = bytes('WEBP', wchunk('VP8X', bytes([0x1C, 0, 0, 0], [0, 0, 0, 0, 0, 0])), wchunk('VP8 ', bytes([1, 2, 3])), wchunk('EXIF', bytes('Exif\0\0', 'GPS-WEBP')), wchunk('XMP ', bytes('autore-xmp')));
const webp = bytes('RIFF', le32(body.length), body);

await t('WebP: webpInfo e stripWebp tolgono EXIF e XMP, aggiornano flag e dimensione', () => {
  assert.equal(core.detectFormat(webp), 'webp');
  assert.equal(core.webpInfo(webp).length, 2);
  const o = core.stripWebp(webp);
  assert.ok(!has(o, 'GPS-WEBP') && !has(o, 'autore-xmp') && has(o, 'VP8X') && has(o, 'VP8 '));
  assert.equal(o[20], 0x10); // restano solo i flag di alpha: erano 0x1C (alpha + EXIF + XMP)
  assert.equal(o[4] | (o[5] << 8) | (o[6] << 16) | (o[7] << 24), o.length - 8);
  assert.equal(core.webpInfo(o).length, 0);
});

// --- Utilità ---
await t('uniqueName evita collisioni nello zip', () => {
  const used = {};
  assert.deepEqual(['a.jpg', 'a.jpg', 'a.jpg', 'b.jpg'].map((x) => core.uniqueName(x, used)), ['a.jpg', 'a (2).jpg', 'a (3).jpg', 'b.jpg']);
});

await t('outName tiene l’estensione originale, o la cambia se il formato cambia', () => {
  assert.equal(core.outName('Foto.JPEG', 'senza-metadati', 'jpg'), 'Foto-senza-metadati.jpeg');
  assert.equal(core.outName('scatto.heic', 'senza-metadati', 'png', true), 'scatto-senza-metadati.png');
  assert.equal(core.outName('senzaestensione', 'x', 'jpg'), 'senzaestensione-x.jpg');
});

await t('GPS: gradi/minuti/secondi ↔ decimali e segno per S e W', () => {
  const d = core.decToDms(45.408), back = core.dmsToDecimal(d, 'N');
  assert.ok(Math.abs(back - 45.408) < 1e-4);
  assert.ok(core.dmsToDecimal(d, 'S') < 0 && core.dmsToDecimal(d, 'W') < 0);
});

await t('date EXIF ↔ campo datetime-local', () => {
  assert.equal(core.exifDateToInput('2025:05:17 14:30:09'), '2025-05-17T14:30');
  assert.equal(core.inputToExifDate('2025-05-17T14:30'), '2025:05:17 14:30:00');
  assert.equal(core.formatExifDate('2025:05:17 14:30:09'), '17/05/2025 14:30:09');
});

await t('stringhe EXIF: UTF-8 (accenti, apostrofo tipografico) senza perdite', () => {
  for (const s of ['Perché è così', 'Creare Creatività’s']) assert.equal(core.fromExifString(core.toExifString(s)), s);
});

await t('formatBytes', () => {
  assert.equal(core.formatBytes(500), '500 B');
  assert.equal(core.formatBytes(1536), '1,5 KB');
  assert.equal(core.formatBytes(5 * 1048576), '5,00 MB');
});

// --- PDF (richiede pdf-lib) ---
let L = null;
try { L = require('pdf-lib'); } catch { /* non installato */ }
if (!L) console.log('salto - test PDF (pdf-lib non installato)');
else {
  const make = async () => {
    const d = await L.PDFDocument.create();
    d.addPage();
    d.setTitle('Contratto riservato'); d.setAuthor('Mario Rossi'); d.setSubject('Oggetto'); d.setKeywords(['a', 'b']);
    d.setCreator('Word'); d.setProducer('Acrobat'); d.setCreationDate(new Date('2024-01-02T03:04:00Z')); d.setModificationDate(new Date('2024-02-03T04:05:00Z'));
    // XMP con lo stesso autore, come fanno Word e Acrobat
    const xmp = d.context.stream('<x:xmpmeta>Mario Rossi XMP</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' });
    d.catalog.set(L.PDFName.of('Metadata'), d.context.register(xmp));
    return new Uint8Array(await d.save());
  };
  const reload = (b) => L.PDFDocument.load(b, { updateMetadata: false });

  await t('PDF: i campi letti sono quelli veri (non quelli scritti da pdf-lib al caricamento)', async () => {
    const doc = await reload(await make());
    const rows = Object.fromEntries(core.pdfRows(L, doc).map((r) => [r.label, r.value]));
    assert.equal(rows['Autore'], 'Mario Rossi');
    assert.equal(rows['Software di produzione'], 'Acrobat');
    assert.equal(rows['Applicazione di creazione'], 'Word');
    assert.equal(rows['Metadati XMP'], 'presenti');
  });

  await t('PDF: cancella tutto, XMP compreso (nel file non ne resta traccia)', async () => {
    const doc = await reload(await make());
    core.pdfApply(L, doc, null);
    const out = new Uint8Array(await doc.save({ updateFieldAppearances: false }));
    for (const s of ['Mario Rossi', 'Contratto', 'Acrobat', 'Word', 'xmpmeta']) assert.ok(!has(out, s), s);
    const again = await reload(out);
    assert.equal(core.pdfRows(L, again).length, 0);
    assert.equal(again.getCreationDate(), undefined); // niente date finte del 1970
    assert.equal(again.getPageCount(), 1);
  });

  await t('PDF: modifica solo i campi cambiati, toglie quelli svuotati e le vecchie XMP', async () => {
    const doc = await reload(await make()), form = core.pdfForm(L, doc), init = { ...form };
    form.author = 'Alessandro Minotto'; form.title = ''; form.keywords = 'logo, web';
    core.pdfApply(L, doc, form, init);
    const out = new Uint8Array(await doc.save({ updateFieldAppearances: false }));
    assert.ok(!has(out, 'xmpmeta'));
    const r = Object.fromEntries(core.pdfRows(L, await reload(out)).map((x) => [x.label, x.value]));
    assert.equal(r['Autore'], 'Alessandro Minotto');
    assert.equal(r['Parole chiave'], 'logo, web');
    assert.equal(r['Titolo'], undefined);
    assert.equal(r['Software di produzione'], 'Acrobat');
    assert.equal(r['Data di creazione'], core.formatDate(new Date('2024-01-02T03:04:00Z'))); // data non toccata
  });
}

console.log(`\n${n} test passati`);
