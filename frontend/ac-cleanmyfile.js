/* Rimuovi metadati da immagini e PDF — Creare Creatività
   JavaScript autonomo. Tutto vive dentro #ac-clean. Le librerie (piexifjs, pdf-lib, JSZip) si caricano solo quando servono. */
(function () {
  'use strict';

  // ---------- Logica pura (testata da scripts/test.mjs) ----------

  var core = {};

  function ascii(b, s, e) { var r = ''; for (var i = s; i < e && i < b.length; i++) r += String.fromCharCode(b[i]); return r; }
  function concat(parts) {
    var n = 0, i, o, p = 0;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    o = new Uint8Array(n);
    for (i = 0; i < parts.length; i++) { o.set(parts[i], p); p += parts[i].length; }
    return o;
  }
  function be16(b, p) { return (b[p] << 8) | b[p + 1]; }
  function be32(b, p) { return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0; }
  function le32(b, p) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; }
  function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; }

  core.formatBytes = function (n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1).replace('.', ',') + ' KB';
    return (n / 1048576).toFixed(2).replace('.', ',') + ' MB';
  };

  // Nome file senza collisioni (nello zip due file con lo stesso nome si sovrascriverebbero)
  core.uniqueName = function (name, used) {
    if (!used[name]) { used[name] = 1; return name; }
    var dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '', n = 2, cand;
    do { cand = base + ' (' + n + ')' + ext; n++; } while (used[cand]);
    used[cand] = 1;
    return cand;
  };
  // Nome del file risultante: tiene l'estensione originale, a meno che il formato non sia cambiato (force)
  core.outName = function (name, suffix, ext, force) {
    var dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name;
    return base + '-' + suffix + '.' + (force || dot <= 0 ? ext : name.slice(dot + 1).toLowerCase());
  };

  core.detectFormat = function (b) {
    if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
    if (b.length > 8 && b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'png';
    if (b.length > 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
    return null;
  };

  // --- JPEG ---
  function jpegSegments(b) {
    var segs = [], p = 2, complete = false, m, len, e;
    while (p + 1 < b.length) {
      if (b[p] !== 0xFF) break;
      m = b[p + 1];
      while (m === 0xFF) { p++; m = b[p + 1]; }
      if (m === undefined) break;
      if (m === 0xD9) { segs.push({ m: m, s: p, e: p + 2 }); p += 2; complete = true; break; }
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { segs.push({ m: m, s: p, e: p + 2 }); p += 2; continue; }
      len = be16(b, p + 2); e = p + 2 + len;
      if (len < 2 || e > b.length) break;
      segs.push({ m: m, s: p, e: e });
      if (m === 0xDA) { segs.push({ m: -1, s: e, e: b.length }); complete = true; break; } // dati compressi fino alla fine
      p = e;
    }
    return { segs: segs, complete: complete };
  }
  // Tipo di un segmento APP/COM; null per i segmenti che servono a decodificare l'immagine
  function segKind(b, seg) {
    var m = seg.m, d = seg.s + 4, id;
    if (m === 0xFE) return 'comment';
    if (m < 0xE0 || m > 0xEF) return null;
    id = ascii(b, d, Math.min(d + 30, seg.e));
    if (m === 0xE0) return id.indexOf('JFIF\0') === 0 ? 'jfif' : 'app0';
    if (m === 0xE1) return id.indexOf('Exif\0\0') === 0 ? 'exif' : (id.indexOf('http://ns.adobe.com/xap') === 0 ? 'xmp' : 'app1');
    if (m === 0xE2) return id.indexOf('ICC_PROFILE\0') === 0 ? 'icc' : (id.indexOf('MPF') === 0 ? 'mpf' : 'app2');
    if (m === 0xEB) return 'jumbf';
    if (m === 0xED) return id.indexOf('Photoshop 3.0') === 0 ? 'iptc' : 'app13';
    if (m === 0xEE) return id.indexOf('Adobe') === 0 ? 'adobe' : 'app14';
    return 'app' + (m - 0xE0);
  }
  var JPEG_KEEP = { jfif: 1, icc: 1, adobe: 1 }; // JFIF e Adobe servono a leggere i colori; l'ICC evita che i colori cambino
  function exifOrientation(b, seg) {
    var t = seg.s + 10, le = ascii(b, t, t + 2) === 'II', i, n, e, ifd;
    function r16(p) { return le ? (b[p] | (b[p + 1] << 8)) : be16(b, p); }
    function r32(p) { return le ? le32(b, p) : be32(b, p); }
    if (t + 8 > seg.e) return 1;
    ifd = t + r32(t + 4);
    if (ifd + 2 > seg.e) return 1;
    n = r16(ifd);
    for (i = 0; i < n; i++) {
      e = ifd + 2 + 12 * i;
      if (e + 12 > seg.e) break;
      if (r16(e) === 0x0112 && r16(e + 2) === 3) { var v = r16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
    }
    return 1;
  }
  core.jpegInfo = function (b) {
    var j = jpegSegments(b), kinds = {}, orientation = 1, comments = [];
    j.segs.forEach(function (s) {
      var k = segKind(b, s);
      if (!k) return;
      kinds[k] = (kinds[k] || 0) + 1;
      if (k === 'exif') orientation = exifOrientation(b, s);
      if (k === 'comment') comments.push(ascii(b, s.s + 4, s.e));
    });
    return { complete: j.complete, kinds: kinds, orientation: orientation, comments: comments };
  };
  function exifOrientationSegment(o) {
    // APP1 minimo: solo il tag Orientamento. Senza, le foto scattate in verticale si vedrebbero ruotate.
    return new Uint8Array([0xFF, 0xE1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4D, 0x4D, 0x00, 0x2A, 0, 0, 0, 8,
      0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]);
  }
  core.stripJpeg = function (b) {
    var j = jpegSegments(b), parts = [b.subarray(0, 2)], insertAt = 1, orientation = 1;
    if (!j.complete) throw new Error('jpeg-corrotto');
    j.segs.forEach(function (s) {
      var k = segKind(b, s);
      if (k === 'exif') orientation = exifOrientation(b, s);
      if (k && !JPEG_KEEP[k]) return;
      parts.push(b.subarray(s.s, s.e));
      if (k === 'jfif') insertAt = parts.length;
    });
    if (orientation > 1) parts.splice(insertAt, 0, exifOrientationSegment(orientation));
    return concat(parts);
  };

  // --- PNG ---
  var PNG_KEEP = { IHDR: 1, PLTE: 1, IDAT: 1, IEND: 1, tRNS: 1, gAMA: 1, cHRM: 1, sRGB: 1, iCCP: 1, sBIT: 1, pHYs: 1, bKGD: 1, hIST: 1, cICP: 1, mDCV: 1, cLLI: 1, acTL: 1, fcTL: 1, fdAT: 1 };
  function pngChunks(b) {
    var out = [], p = 8, len, t, end;
    while (p + 12 <= b.length) {
      len = be32(b, p); t = ascii(b, p + 4, p + 8); end = p + 12 + len;
      if (end > b.length) throw new Error('png-corrotto');
      out.push({ t: t, s: p, e: end });
      p = end;
      if (t === 'IEND') break;
    }
    return out;
  }
  core.stripPng = function (b) {
    var chunks = pngChunks(b), parts = [b.subarray(0, 8)], hasEnd = false;
    chunks.forEach(function (c) {
      if (c.t === 'IEND') hasEnd = true;
      // i chunk il cui nome inizia con maiuscola sono obbligatori: si tengono sempre
      if (PNG_KEEP[c.t] || (c.t.charCodeAt(0) >= 65 && c.t.charCodeAt(0) <= 90)) parts.push(b.subarray(c.s, c.e));
    });
    if (!hasEnd) throw new Error('png-corrotto');
    return concat(parts);
  };
  var PNG_NAMES = { tIME: 'Ultima modifica', eXIf: 'Dati EXIF', caBX: 'Dati C2PA / Content Credentials', iCCP: 'Profilo colore ICC' };
  core.pngInfo = function (b) {
    var rows = [], decUtf8 = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
    pngChunks(b).forEach(function (c) {
      var d = c.s + 8, e = c.e - 4, z, kw, text, rest;
      if (c.t === 'tEXt') {
        z = d; while (z < e && b[z] !== 0) z++;
        rows.push({ label: ascii(b, d, z), value: trunc(ascii(b, z + 1, e), 300) });
      } else if (c.t === 'zTXt') {
        z = d; while (z < e && b[z] !== 0) z++;
        rows.push({ label: ascii(b, d, z), value: 'testo compresso' });
      } else if (c.t === 'iTXt') {
        z = d; while (z < e && b[z] !== 0) z++;
        kw = ascii(b, d, z);
        if (b[z + 1] === 0 && decUtf8) { // non compresso: salto flag, metodo, lingua e titolo tradotto
          rest = z + 3; while (rest < e && b[rest] !== 0) rest++; rest++;
          while (rest < e && b[rest] !== 0) rest++; rest++;
          text = decUtf8.decode(b.subarray(rest, e));
        } else text = 'testo compresso';
        rows.push(kw === 'XML:com.adobe.xmp' ? { label: 'Dati XMP', value: 'presenti' } : { label: kw, value: trunc(text, 300) });
      } else if (c.t === 'tIME') {
        rows.push({ label: PNG_NAMES.tIME, value: pad2(b[d + 3]) + '/' + pad2(b[d + 2]) + '/' + be16(b, d) + ' ' + pad2(b[d + 4]) + ':' + pad2(b[d + 5]) });
      } else if (c.t === 'iCCP') {
        rows.push({ label: PNG_NAMES.iCCP, value: 'mantenuto per non alterare i colori', kept: true });
      } else if (!PNG_KEEP[c.t] && !(c.t.charCodeAt(0) >= 65 && c.t.charCodeAt(0) <= 90)) {
        rows.push({ label: PNG_NAMES[c.t] || 'Dati incorporati (' + c.t + ')', value: 'presenti' });
      }
    });
    return rows;
  };

  // --- WebP ---
  function webpChunks(b) {
    var out = [], p = 12, size, end;
    while (p + 8 <= b.length) {
      size = le32(b, p + 4); end = p + 8 + size + (size & 1);
      if (end > b.length) end = b.length;
      out.push({ t: ascii(b, p, p + 4), s: p, e: end });
      p = end;
    }
    return out;
  }
  core.stripWebp = function (b) {
    var parts = [], total = 4, head, i, c, chunk;
    webpChunks(b).forEach(function (ch) {
      if (ch.t === 'EXIF' || ch.t === 'XMP ') return;
      chunk = b.slice(ch.s, ch.e);
      if (ch.t === 'VP8X') chunk[8] &= ~0x0C; // spegne i flag EXIF e XMP
      parts.push(chunk); total += chunk.length;
    });
    head = new Uint8Array(12);
    for (i = 0; i < 4; i++) head[i] = 'RIFF'.charCodeAt(i);
    for (i = 0; i < 4; i++) head[8 + i] = 'WEBP'.charCodeAt(i);
    head[4] = total & 255; head[5] = (total >> 8) & 255; head[6] = (total >> 16) & 255; head[7] = (total >> 24) & 255;
    parts.unshift(head);
    return concat(parts);
  };
  core.webpInfo = function (b) {
    var rows = [];
    webpChunks(b).forEach(function (c) {
      if (c.t === 'EXIF') rows.push({ label: 'Dati EXIF', value: 'presenti' });
      if (c.t === 'XMP ') rows.push({ label: 'Dati XMP', value: 'presenti' });
      if (c.t === 'ICCP') rows.push({ label: 'Profilo colore ICC', value: 'mantenuto per non alterare i colori', kept: true });
    });
    return rows;
  };

  // Dati che restano nel file dopo la pulizia (si mostrano, per trasparenza)
  core.keptRows = function (b, fmt) {
    var rows = [], i;
    if (fmt === 'jpeg') {
      i = core.jpegInfo(b);
      if (i.orientation > 1) rows.push({ label: 'Orientamento', value: 'mantenuto, altrimenti la foto si vedrebbe ruotata', kept: true });
      if (i.kinds.icc) rows.push({ label: 'Profilo colore ICC', value: 'mantenuto per non alterare i colori', kept: true });
    } else if (fmt === 'png') rows = core.pngInfo(b).filter(function (r) { return r.kept; });
    else if (fmt === 'webp') rows = core.webpInfo(b).filter(function (r) { return r.kept; });
    return rows;
  };

  // --- EXIF: conversioni ---
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  core.rationalToNum = function (v) { return Array.isArray(v) ? (v[1] ? v[0] / v[1] : 0) : v; };
  core.dmsToDecimal = function (dms, ref) {
    var d = core.rationalToNum(dms[0]) + core.rationalToNum(dms[1]) / 60 + core.rationalToNum(dms[2]) / 3600;
    return ref === 'S' || ref === 'W' ? -d : d;
  };
  core.decToDms = function (dec) {
    var abs = Math.abs(dec), deg = Math.floor(abs), minF = (abs - deg) * 60, min = Math.floor(minF), sec = (minF - min) * 60;
    return [[deg, 1], [min, 1], [Math.round(sec * 1000), 1000]];
  };
  core.formatExifDate = function (s) { var m = String(s).match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}:\d{2}:\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] : s; };
  core.exifDateToInput = function (s) { var m = String(s).match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/); return m ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] : ''; };
  core.inputToExifDate = function (v) { if (!v) return ''; var p = v.split('T'), d = p[0].split('-'); return d[0] + ':' + d[1] + ':' + d[2] + ' ' + (p[1] || '00:00') + ':00'; };
  core.dateToInput = function (d) { return d && !isNaN(d) ? d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : ''; };
  core.formatDate = function (d) { return d && !isNaN(d) ? pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : ''; };
  // Le stringhe EXIF si scrivono in UTF-8 (lettere accentate e apostrofi tipografici non sono ASCII)
  core.toExifString = function (s) { return unescape(encodeURIComponent(s)); };
  core.fromExifString = function (s) {
    s = String(s).replace(/\u0000+$/, '').trim();
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  };

  // --- PDF (la libreria arriva da fuori: in Node nei test, nel browser da CDN) ---
  var PDF_TEXT = { Title: 'title', Author: 'author', Subject: 'subject', Keywords: 'keywords', Creator: 'creator', Producer: 'producer' };
  core.pdfRows = function (L, doc) {
    var rows = [], info = doc.getInfoDict(), N = L.PDFName;
    function txt(key, label) {
      var v = info.get(N.of(key));
      if (v && v.decodeText) { v = v.decodeText(); if (v) rows.push({ label: label, value: v }); }
    }
    txt('Title', 'Titolo'); txt('Author', 'Autore'); txt('Subject', 'Oggetto'); txt('Keywords', 'Parole chiave');
    txt('Creator', 'Applicazione di creazione'); txt('Producer', 'Software di produzione');
    var c = core.formatDate(doc.getCreationDate()), m = core.formatDate(doc.getModificationDate());
    if (c) rows.push({ label: 'Data di creazione', value: c });
    if (m) rows.push({ label: 'Data di modifica', value: m });
    if (doc.catalog.get(N.of('Metadata'))) rows.push({ label: 'Metadati XMP', value: 'presenti' });
    return rows;
  };
  core.pdfForm = function (L, doc) {
    var info = doc.getInfoDict(), N = L.PDFName, f = {};
    Object.keys(PDF_TEXT).forEach(function (k) { var v = info.get(N.of(k)); f[PDF_TEXT[k]] = v && v.decodeText ? v.decodeText() : ''; });
    f.creationDate = core.dateToInput(doc.getCreationDate());
    f.modDate = core.dateToInput(doc.getModificationDate());
    return f;
  };
  // vals = null: cancella tutto. Altrimenti scrive solo i campi compilati e toglie quelli vuoti.
  core.pdfApply = function (L, doc, vals, init) {
    var info = doc.getInfoDict(), N = L.PDFName;
    if (!vals) {
      info.keys().forEach(function (k) { info.delete(k); });
    } else {
      Object.keys(PDF_TEXT).forEach(function (k) {
        var v = (vals[PDF_TEXT[k]] || '').trim();
        if (v) info.set(N.of(k), L.PDFHexString.fromText(v)); else info.delete(N.of(k));
      });
      // le date si toccano solo se l'utente le ha cambiate (il campo non ha secondi né fuso orario)
      if (!init || vals.creationDate !== init.creationDate) { if (vals.creationDate) doc.setCreationDate(new Date(vals.creationDate)); else info.delete(N.of('CreationDate')); }
      if (!init || vals.modDate !== init.modDate) { if (vals.modDate) doc.setModificationDate(new Date(vals.modDate)); else info.delete(N.of('ModDate')); }
    }
    // Lo stream XMP ripeterebbe i vecchi valori: va tolto dal catalogo e dal file
    function dropXmp(dict) {
      var ref = dict.get(N.of('Metadata'));
      if (ref === undefined) return;
      dict.delete(N.of('Metadata'));
      if (ref instanceof L.PDFRef) doc.context.delete(ref);
    }
    dropXmp(doc.catalog);
    doc.getPages().forEach(function (p) { dropXmp(p.node); });
  };

  core.PDF_TEXT = PDF_TEXT;

  // In Node (test) ci si ferma qui
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined') module.exports = core;
    return;
  }
  var root = document.getElementById('ac-clean');
  if (!root) return;

  // ---------- Interfaccia ----------

  var MAX_SIZE = 15 * 1024 * 1024;
  var LIBS = {
    piexif: { url: 'https://cdn.jsdelivr.net/npm/piexifjs@1.0.6/piexif.js', sri: 'sha384-yk/k1j9hKtYh4LJRX0d6o3pO9c8h4lp2IMnWdamQhThRA2Z9B0YNDeGKyDmPXnnJ', ok: function () { return window.piexif; } },
    pdf: { url: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js', sri: 'sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI', ok: function () { return window.PDFLib; } },
    zip: { url: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', sri: 'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG', ok: function () { return window.JSZip; } }
  };
  var libP = {};
  function lib(k) {
    var L = LIBS[k];
    if (L.ok()) return Promise.resolve(L.ok());
    if (libP[k]) return libP[k];
    libP[k] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = L.url; s.integrity = L.sri; s.crossOrigin = 'anonymous';
      s.onload = function () { L.ok() ? res(L.ok()) : rej(new Error('lib')); };
      s.onerror = function () { delete libP[k]; rej(new Error('lib')); };
      document.head.appendChild(s);
    });
    return libP[k];
  }
  var LIB_ERR = 'Non riesco a caricare una libreria necessaria. Controlla la connessione e riprova.';

  var MODES = {
    img: {
      max: 10, noun: 'immagini', one: 'immagine', ext: /\.(jpe?g|png|webp|tiff?|heic|heif)$/i,
      accepts: function (f) { return /^image\//.test(f.type) || this.ext.test(f.name); },
      zip: 'immagini-senza-metadati.zip', clear: 'Cancella tutte le immagini caricate'
    },
    pdf: {
      max: 5, noun: 'PDF', one: 'PDF', ext: /\.pdf$/i,
      accepts: function (f) { return f.type === 'application/pdf' || this.ext.test(f.name); },
      zip: 'pdf-senza-metadati.zip', clear: 'Cancella tutti i PDF caricati'
    }
  };
  var state = { tab: 'img', img: [], pdf: [] };
  var panels = {};
  var uid = 0;

  var ICON = {
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
    alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>'
  };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function q(el, sel) { return el.querySelector(sel); }

  ['img', 'pdf'].forEach(function (m) {
    var el = q(root, '[data-ac-panel="' + m + '"]');
    panels[m] = { el: el, input: q(el, '[data-ac="input"]'), drop: q(el, '[data-ac="drop"]'), msg: q(el, '[data-ac="msg"]'), bar: q(el, '[data-ac="bar"]'), list: q(el, '[data-ac="list"]') };
  });
  var toastEl = q(root, '[data-ac="toast"]'), toastT;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.hidden = true; }, 2200);
  }

  // ---------- Schede ----------
  function setTab(t, focus) {
    state.tab = t;
    root.querySelectorAll('[data-ac-tab]').forEach(function (b) {
      var on = b.getAttribute('data-ac-tab') === t;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    Object.keys(panels).forEach(function (m) { panels[m].el.hidden = m !== t; });
  }
  root.querySelector('.ac-tabs').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); setTab(state.tab === 'img' ? 'pdf' : 'img', true);
  });
  if (/^#pdf\b/.test(location.hash)) setTab('pdf'); else setTab('img');

  // ---------- Elenco file ----------
  function getFile(id) {
    for (var m in MODES) for (var i = 0; i < state[m].length; i++) if (state[m][i].id === id) return state[m][i];
    return null;
  }
  function summary(f) {
    if (f.status === 'stripped') return f.kept && f.kept.length ? 'Rimossi tutti i metadati. ' + (f.kept.length === 1 ? 'Resta 1 dato tecnico' : 'Restano ' + f.kept.length + ' dati tecnici') + ' (vedi dettagli).' : 'Rimossi tutti i metadati.';
    var n = f.rows.filter(function (r) { return !r.kept; }).length;
    if (f.analyzing) return 'Analisi in corso…';
    if (f.noDetail) return 'Dettaglio non disponibile per questo formato: puoi comunque cancellare tutti i metadati.';
    return n ? n + (n === 1 ? ' campo rilevato' : ' campi rilevati') : 'Nessun metadato rilevato in questo file.';
  }
  var STATUS = { ready: 'Pronto', processing: 'Elaborazione…', stripped: 'Metadati rimossi', edited: 'Metadati aggiornati', error: 'Errore' };
  var RISK_LABEL = { gps: 'Posizione GPS', device: 'Dati del dispositivo', author: 'Autore' };

  function field(f, key, label, type, extra) {
    return '<div class="ac-field"><label for="ac-clean-' + f.id + '-' + key + '">' + label + '</label><input id="ac-clean-' + f.id + '-' + key + '" type="' + (type || 'text') + '" value="' + esc(f.form[key] || '') + '" data-ac-field="' + key + '" data-id="' + f.id + '"' + (extra || '') + ' autocomplete="off"></div>';
  }
  function editForm(f) {
    var h = '<div class="ac-edit">';
    if (f.mode === 'pdf') {
      h += field(f, 'title', 'Titolo') + field(f, 'author', 'Autore') + field(f, 'subject', 'Oggetto') + field(f, 'keywords', 'Parole chiave (separate da virgola)') +
        field(f, 'creator', 'Applicazione di creazione') + field(f, 'producer', 'Software di produzione') +
        field(f, 'creationDate', 'Data di creazione', 'datetime-local') + field(f, 'modDate', 'Data di modifica', 'datetime-local');
    } else {
      h += field(f, 'artist', 'Autore') + field(f, 'copyright', 'Copyright') + field(f, 'description', 'Descrizione') + field(f, 'software', 'Software') +
        field(f, 'dateTime', 'Data e ora scatto', 'datetime-local');
      h += '<div class="ac-field"><label for="ac-clean-' + f.id + '-gps">Coordinate GPS</label><select id="ac-clean-' + f.id + '-gps" data-ac-field="gps" data-id="' + f.id + '">' +
        '<option value="keep"' + (f.form.gps === 'keep' ? ' selected' : '') + '>' + (f.form.hasGps ? 'Mantieni' : 'Nessuna') + '</option>' +
        '<option value="remove"' + (f.form.gps === 'remove' ? ' selected' : '') + '>Rimuovi</option>' +
        '<option value="set"' + (f.form.gps === 'set' ? ' selected' : '') + '>Imposta manualmente</option></select></div>';
      if (f.form.gps === 'set') h += field(f, 'lat', 'Latitudine', 'text', ' placeholder="45.40800" inputmode="decimal"') + field(f, 'lon', 'Longitudine', 'text', ' placeholder="11.87860" inputmode="decimal"');
    }
    h += '<div class="ac-edit-actions"><button type="button" class="ac-pill ac-pill--brand" data-ac-act="save" data-id="' + f.id + '">Salva modifiche</button>' +
      '<button type="button" class="ac-pill" data-ac-act="edit" data-id="' + f.id + '">Annulla</button></div></div>';
    return h;
  }
  function cardHtml(f) {
    var isImg = f.mode === 'img', busy = f.status === 'processing' || f.analyzing, h;
    var thumb = isImg
      ? (f.previewOk ? '<img class="ac-thumb" src="' + f.previewUrl + '" alt="" data-ac-act="details" data-id="' + f.id + '">' : '<div class="ac-thumb ac-thumb--none" aria-hidden="true">n/d</div>')
      : '<div class="ac-thumb ac-thumb--pdf" aria-hidden="true">PDF</div>';
    var badge = isImg ? (f.fmt ? f.fmt.toUpperCase() : (f.file.type.split('/')[1] || 'file').toUpperCase()) : (f.pages != null ? f.pages + ' pag.' : '');
    var showRows = f.expanded || (state[f.mode].length === 1 && f.rows.length);
    h = '<li class="ac-file" id="ac-clean-' + f.id + '" data-id="' + f.id + '" data-status="' + f.status + '">' +
      '<div class="ac-file-head">' + thumb +
      '<div class="ac-file-main"><div class="ac-file-title"><span class="ac-file-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span>' + (badge ? '<span class="ac-badge">' + esc(badge) + '</span>' : '') + '</div>' +
      '<div class="ac-file-sub">' + core.formatBytes(f.size) + ' · <span class="ac-status" data-s="' + f.status + '">' + (busy ? '<span class="ac-spin" aria-hidden="true"></span>' : (f.status === 'stripped' || f.status === 'edited' ? ICON.check : '')) + (f.analyzing ? 'Analisi…' : STATUS[f.status]) + '</span></div>' +
      '<div class="ac-file-sum">' + esc(summary(f)) + '</div>';
    if (f.risks.length && f.status !== 'stripped') h += '<div class="ac-risks">' + f.risks.map(function (r) { return '<span class="ac-risk">' + ICON.alert + RISK_LABEL[r] + '</span>'; }).join('') + '</div>';
    if (f.error) h += '<div class="ac-file-err" role="alert">' + esc(f.error) + '</div>';
    if (f.result) h += '<div class="ac-file-ok">Pronto per il download · ' + core.formatBytes(f.result.blob.size) + '</div>';
    h += '</div><button type="button" class="ac-x" data-ac-act="remove" data-id="' + f.id + '" aria-label="Rimuovi ' + esc(f.name) + '">' + ICON.x + '</button></div>';
    h += '<div class="ac-file-actions">';
    if (f.rows.length && state[f.mode].length > 1) h += '<button type="button" class="ac-pill" data-ac-act="details" data-id="' + f.id + '" aria-expanded="' + (f.expanded ? 'true' : 'false') + '">' + (f.expanded ? 'Nascondi dettagli' : 'Mostra dettagli') + '</button>';
    h += '<button type="button" class="ac-pill" data-ac-act="strip" data-id="' + f.id + '"' + (busy || f.error && !f.canStrip ? ' disabled' : '') + '>Cancella tutti i metadati</button>';
    if (f.canEdit) h += '<button type="button" class="ac-pill" data-ac-act="edit" data-id="' + f.id + '" aria-expanded="' + (f.editing ? 'true' : 'false') + '"' + (busy ? ' disabled' : '') + '>' + (f.editing ? 'Chiudi modifica' : 'Modifica metadati') + '</button>';
    if (f.result) h += '<button type="button" class="ac-pill ac-pill--brand" data-ac-act="download" data-id="' + f.id + '">' + ICON.down + 'Scarica</button>';
    h += '</div>';
    if (f.editing && f.form) h += editForm(f);
    if (showRows && f.rows.length) {
      h += '<dl class="ac-meta">' + f.rows.map(function (r) { return '<div' + (r.warn ? ' class="ac-meta-warn"' : '') + '><dt>' + esc(r.label) + '</dt><dd>' + esc(r.value) + '</dd></div>'; }).join('') + '</dl>';
    }
    return h + '</li>';
  }
  function renderCard(f) {
    var old = document.getElementById('ac-clean-' + f.id), act = document.activeElement, keep = null, tmp, n;
    if (!old) return;
    if (act && old.contains(act)) keep = act.getAttribute('data-ac-act') ? '[data-ac-act="' + act.getAttribute('data-ac-act') + '"]' : (act.getAttribute('data-ac-field') ? '[data-ac-field="' + act.getAttribute('data-ac-field') + '"]' : null);
    tmp = document.createElement('ul'); tmp.innerHTML = cardHtml(f);
    old.parentNode.replaceChild(tmp.firstChild, old);
    if (keep) { n = q(document.getElementById('ac-clean-' + f.id), keep); if (n && !n.disabled) n.focus(); }
    renderBar(f.mode);
  }
  function renderList(m) {
    var P = panels[m];
    P.list.innerHTML = state[m].slice().reverse().map(cardHtml).join('');
    renderBar(m);
  }
  function renderBar(m) {
    var files = state[m], P = panels[m], ready = files.filter(function (f) { return f.result; }).length, editable = files.some(function (f) { return f.canEdit; });
    if (!files.length) { P.bar.hidden = true; P.bar.innerHTML = ''; return; }
    var busy = files.some(function (f) { return f.status === 'processing' || f.analyzing; });
    P.bar.hidden = false;
    P.bar.innerHTML = '<button type="button" class="ac-pill ac-pill--brand ac-pill--lg" data-ac-act="strip-all" data-m="' + m + '"' + (busy ? ' disabled' : '') + '>Cancella tutti i metadati (' + files.length + ')</button>' +
      (editable ? '<button type="button" class="ac-pill ac-pill--lg" data-ac-act="edit-all" data-m="' + m + '">Modifica metadati</button>' : '') +
      (ready ? '<button type="button" class="ac-pill ac-pill--lg" data-ac-act="zip" data-m="' + m + '">' + ICON.down + 'Scarica tutto (.zip) — ' + ready + '</button>' : '') +
      '<button type="button" class="ac-link" data-ac-act="clear" data-m="' + m + '">' + MODES[m].clear + '</button>' +
      (ready && files.length > 1 ? '<span class="ac-progress">' + ready + ' di ' + files.length + ' completat' + (m === 'pdf' ? 'i' : 'e') + '</span>' : '');
  }
  function patch(f, p) { for (var k in p) f[k] = p[k]; renderCard(f); }

  // ---------- Lettura dei metadati ----------
  var IT = { Make: 'Marca fotocamera', Model: 'Modello', Software: 'Software', Artist: 'Autore', Copyright: 'Copyright', ImageDescription: 'Descrizione',
    DateTime: 'Data di modifica', DateTimeOriginal: 'Data scatto', DateTimeDigitized: 'Data digitalizzazione', LensModel: 'Obiettivo', LensMake: 'Marca obiettivo',
    ExposureTime: 'Tempo di esposizione', FNumber: 'Diaframma (f)', ISOSpeedRatings: 'ISO', FocalLength: 'Lunghezza focale (mm)', Orientation: 'Orientamento',
    PixelXDimension: 'Larghezza (px)', PixelYDimension: 'Altezza (px)', HostComputer: 'Dispositivo', BodySerialNumber: 'Numero di serie', CameraOwnerName: 'Proprietario fotocamera' };
  var SKIP = { ExifTag: 1, GPSTag: 1, InteroperabilityTag: 1, MakerNote: 1, UserComment: 1, PrintImageMatching: 1, ComponentsConfiguration: 1, ExifVersion: 1, FlashpixVersion: 1, ColorSpace: 1, SceneType: 1, FileSource: 1 };
  var ORIENT = { 1: 'Normale', 3: 'Ruotata di 180°', 6: 'Ruotata di 90° in senso orario', 8: 'Ruotata di 90° in senso antiorario' };
  function fmtVal(v) {
    if (Array.isArray(v)) {
      if (v.length > 16) return '';
      if (v.length && Array.isArray(v[0])) return v.map(core.rationalToNum).join(', ');
      if (v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') { var n = core.rationalToNum(v); return String(Math.round(n * 1000) / 1000); }
      return v.join(', ');
    }
    if (typeof v === 'string') return core.fromExifString(v);
    return v === undefined || v === null ? '' : String(v);
  }
  function exifRows(exif) {
    var rows = [], dict = window.piexif.TAGS, gps = exif.GPS || {}, g0 = exif['0th'] || {}, risks = [];
    ['0th', 'Exif', '1st'].forEach(function (ifd) {
      if (ifd === '1st') return; // miniatura: non è un dato da mostrare
      var d = exif[ifd]; if (!d) return;
      Object.keys(d).forEach(function (t) {
        var meta = dict[ifd === '0th' ? 'Image' : ifd][t], name = meta && meta.name, v;
        if (!name || SKIP[name]) return;
        v = fmtVal(d[t]); if (!v) return;
        if (/^DateTime/.test(name)) v = core.formatExifDate(v);
        if (name === 'Orientation') v = ORIENT[v] || 'Specchiata (' + v + ')';
        rows.push({ label: IT[name] || name, value: v });
      });
    });
    if (gps[2] && gps[4]) {
      rows.unshift({ label: 'Posizione GPS', value: core.dmsToDecimal(gps[2], gps[1]).toFixed(5) + ', ' + core.dmsToDecimal(gps[4], gps[3]).toFixed(5), warn: true });
      risks.push('gps');
    }
    if (g0[271] || g0[272]) risks.push('device');
    if (g0[315] && core.fromExifString(g0[315])) risks.push('author');
    return { rows: rows, risks: risks };
  }
  function imgForm(exif) {
    var g0 = (exif && exif['0th']) || {}, ex = (exif && exif.Exif) || {}, gps = (exif && exif.GPS) || {}, has = !!(gps[2] && gps[4]);
    return {
      artist: g0[315] ? core.fromExifString(g0[315]) : '', copyright: g0[33432] ? core.fromExifString(g0[33432]) : '',
      description: g0[270] ? core.fromExifString(g0[270]) : '', software: g0[305] ? core.fromExifString(g0[305]) : '',
      dateTime: ex[36867] ? core.exifDateToInput(core.fromExifString(ex[36867])) : '',
      gps: 'keep', hasGps: has,
      lat: has ? core.dmsToDecimal(gps[2], gps[1]).toFixed(5) : '', lon: has ? core.dmsToDecimal(gps[4], gps[3]).toFixed(5) : ''
    };
  }
  function toBin(b) {
    var s = '', i;
    for (i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return s;
  }
  function fromBin(s) { var o = new Uint8Array(s.length), i; for (i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
  function readBytes(file) { return file.arrayBuffer().then(function (ab) { return new Uint8Array(ab); }); }

  async function analyzeImage(f) {
    var b = await readBytes(f.file), fmt = core.detectFormat(b), rows = [], extra = [];
    f.fmt = fmt;
    try {
      if (fmt === 'jpeg') {
        var info = core.jpegInfo(b);
        if (info.kinds.xmp) extra.push({ label: 'Dati XMP', value: 'presenti' });
        if (info.kinds.iptc) extra.push({ label: 'Dati IPTC', value: 'presenti' });
        if (info.kinds.jumbf) extra.push({ label: 'Dati C2PA / Content Credentials', value: 'presenti' });
        info.comments.forEach(function (c) { extra.push({ label: 'Commento', value: trunc(c, 300) }); });
        if (info.kinds.icc) extra.push({ label: 'Profilo colore ICC', value: 'mantenuto per non alterare i colori', kept: true });
        try {
          await lib('piexif');
          var exif = window.piexif.load(toBin(b)), r = exifRows(exif);
          f.exif = exif; f.form = imgForm(exif); f.risks = r.risks; rows = r.rows;
          f.canEdit = true;
        } catch (e) { f.form = null; }
        rows = rows.concat(extra);
      } else if (fmt === 'png') rows = core.pngInfo(b);
      else if (fmt === 'webp') rows = core.webpInfo(b);
      else f.noDetail = true;
    } catch (e) { f.noDetail = true; }
    f.rows = rows;
    f.canStrip = true;
    f.analyzing = false;
    renderCard(f);
  }
  async function analyzePdf(f) {
    try {
      var L = await lib('pdf'), b = await readBytes(f.file);
      var doc = await L.PDFDocument.load(b, { updateMetadata: false });
      f.rows = core.pdfRows(L, doc); f.form = core.pdfForm(L, doc); f.formInit = Object.assign({}, f.form);
      f.pages = doc.getPageCount(); f.canEdit = true; f.canStrip = true;
      if (f.form.author) f.risks.push('author');
    } catch (e) {
      f.status = 'error';
      f.error = e && e.message === 'lib' ? LIB_ERR : (/encrypt/i.test(String(e && (e.name + e.message))) ? 'Questo PDF è protetto da password: non posso modificarlo.' : 'Non riesco a leggere questo PDF (potrebbe essere danneggiato).');
    }
    f.analyzing = false;
    renderCard(f);
  }

  // ---------- Aggiunta file ----------
  function setMsg(m, text) { var P = panels[m]; P.msg.hidden = !text; P.msg.textContent = text || ''; }
  function addFiles(m, list) {
    var cfg = MODES[m], all = Array.from(list || []), msgs = [], ok, big, wrong, room, take, f, i;
    wrong = all.filter(function (x) { return !cfg.accepts(x); });
    ok = all.filter(function (x) { return cfg.accepts(x); });
    big = ok.filter(function (x) { return x.size > MAX_SIZE; });
    ok = ok.filter(function (x) { return x.size <= MAX_SIZE; });
    room = Math.max(cfg.max - state[m].length, 0);
    take = ok.slice(0, room);
    if (wrong.length) msgs.push(wrong.length === 1 ? 'Un file è stato ignorato perché non è ' + (m === 'pdf' ? 'un PDF' : 'un’immagine') + '.' : wrong.length + ' file sono stati ignorati perché non sono ' + (m === 'pdf' ? 'PDF' : 'immagini') + '.');
    if (big.length) msgs.push(big.length === 1 ? 'Un file supera il limite di 15 MB e non è stato caricato.' : big.length + ' file superano il limite di 15 MB e non sono stati caricati.');
    if (ok.length > take.length) msgs.push(room === 0 ? 'Hai già raggiunto il massimo di ' + cfg.max + ' ' + cfg.noun + '. Cancella la lista per caricarne altri.' : 'Il massimo è ' + cfg.max + ' ' + cfg.noun + ' alla volta: ne ho caricati ' + take.length + ', gli altri no.');
    setMsg(m, msgs.join(' '));
    (async function () {
      for (i = 0; i < take.length; i++) {
        f = { id: 'f' + (uid++), mode: m, file: take[i], name: take[i].name, size: take[i].size, status: 'ready', analyzing: true, rows: [], risks: [], form: null,
          editing: false, expanded: false, canEdit: false, canStrip: false, previewUrl: m === 'img' ? URL.createObjectURL(take[i]) : '', previewOk: m === 'img', result: null, error: '' };
        state[m].push(f);
        renderList(m);
        await (m === 'pdf' ? analyzePdf(f) : analyzeImage(f));
      }
    })();
  }

  // ---------- Pulizia e modifica ----------
  function setResult(f, blob, name, status, kept) {
    if (f.result) URL.revokeObjectURL(f.result.url);
    f.result = { blob: blob, url: URL.createObjectURL(blob), name: name };
    f.status = status; f.error = ''; f.kept = kept || [];
  }
  function canvasStrip(f) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(f.file), img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        var type = f.fmt === 'jpeg' ? 'image/jpeg' : 'image/png';
        c.toBlob(function (blob) { blob ? res({ blob: blob, type: type }) : rej(new Error('canvas')); }, type, 0.95);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('decode')); };
      img.src = url;
    });
  }
  async function stripImage(f) {
    patch(f, { status: 'processing', error: '' });
    var b = await readBytes(f.file), fmt = core.detectFormat(b), out = null, kept = [];
    try {
      out = fmt === 'jpeg' ? core.stripJpeg(b) : fmt === 'png' ? core.stripPng(b) : fmt === 'webp' ? core.stripWebp(b) : null;
    } catch (e) { out = null; }
    if (out) {
      kept = core.keptRows(out, fmt);
      setResult(f, new Blob([out], { type: f.file.type || 'application/octet-stream' }), core.outName(f.name, 'senza-metadati', fmt === 'jpeg' ? 'jpg' : fmt), 'stripped', kept);
    } else {
      try {
        var r = await canvasStrip(f);
        setResult(f, r.blob, core.outName(f.name, 'senza-metadati', r.type === 'image/jpeg' ? 'jpg' : 'png', true), 'stripped', []);
      } catch (e) {
        f.status = 'error'; f.error = 'Il browser non riesce a leggere questo formato. Prova a convertirlo in JPEG o PNG.';
        renderCard(f); return;
      }
    }
    f.rows = kept; f.risks = []; f.editing = false;
    if (f.canEdit) { f.exif = null; f.form = imgForm(null); } // modificare dopo la pulizia = partire da zero
    renderCard(f);
  }
  async function stripPdf(f) {
    patch(f, { status: 'processing', error: '' });
    try {
      var L = await lib('pdf'), doc = await L.PDFDocument.load(await readBytes(f.file), { updateMetadata: false });
      core.pdfApply(L, doc, null);
      var out = await doc.save({ updateFieldAppearances: false });
      setResult(f, new Blob([out], { type: 'application/pdf' }), core.outName(f.name, 'senza-metadati', 'pdf'), 'stripped', []);
      f.rows = core.pdfRows(L, doc); f.form = core.pdfForm(L, doc); f.formInit = Object.assign({}, f.form); f.risks = []; f.editing = false;
    } catch (e) { f.status = 'error'; f.error = e && e.message === 'lib' ? LIB_ERR : 'Non è stato possibile elaborare questo PDF.'; }
    renderCard(f);
  }
  async function saveImage(f) {
    patch(f, { status: 'processing', error: '' });
    try {
      await lib('piexif');
      var P = window.piexif, form = f.form, b = await readBytes(f.file);
      var base = f.exif ? JSON.parse(JSON.stringify(f.exif)) : {}, orient = core.jpegInfo(b).orientation;
      try { b = core.stripJpeg(b); } catch (e) { /* file anomalo: si lavora sull'originale */ } // via XMP, IPTC e commenti: ripeterebbero i vecchi valori
      base['0th'] = base['0th'] || {}; base.Exif = base.Exif || {}; base.GPS = base.GPS || {}; base.Interop = base.Interop || {};
      if (orient > 1 && !base['0th'][274]) base['0th'][274] = orient;
      base['1st'] = {}; base.thumbnail = null; // la miniatura potrebbe mostrare l'immagine originale
      function set0(tag, v) { if (v) base['0th'][tag] = core.toExifString(v); else delete base['0th'][tag]; }
      set0(315, form.artist); set0(33432, form.copyright); set0(270, form.description); set0(305, form.software);
      if (form.dateTime) base.Exif[36867] = core.inputToExifDate(form.dateTime); else delete base.Exif[36867];
      if (form.gps === 'remove') base.GPS = {};
      else if (form.gps === 'set') {
        var lat = parseFloat(String(form.lat).replace(',', '.')), lon = parseFloat(String(form.lon).replace(',', '.'));
        if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { f.status = 'ready'; f.error = 'Coordinate non valide: latitudine tra -90 e 90, longitudine tra -180 e 180.'; renderCard(f); return; }
        base.GPS = {}; base.GPS[1] = lat >= 0 ? 'N' : 'S'; base.GPS[2] = core.decToDms(lat); base.GPS[3] = lon >= 0 ? 'E' : 'W'; base.GPS[4] = core.decToDms(lon);
      }
      var out = fromBin(P.insert(P.dump(base), toBin(b)));
      setResult(f, new Blob([out], { type: 'image/jpeg' }), core.outName(f.name, 'modificato', 'jpg'), 'edited');
      var exif = P.load(toBin(out)), r = exifRows(exif);
      f.exif = exif; f.form = imgForm(exif); f.rows = r.rows; f.risks = r.risks; f.editing = false;
    } catch (e) { f.status = 'error'; f.error = e && e.message === 'lib' ? LIB_ERR : 'Non è stato possibile salvare le modifiche ai metadati.'; }
    renderCard(f);
  }
  async function savePdf(f) {
    patch(f, { status: 'processing', error: '' });
    try {
      var L = await lib('pdf'), doc = await L.PDFDocument.load(await readBytes(f.file), { updateMetadata: false });
      core.pdfApply(L, doc, f.form, f.formInit);
      var out = await doc.save({ updateFieldAppearances: false });
      setResult(f, new Blob([out], { type: 'application/pdf' }), core.outName(f.name, 'modificato', 'pdf'), 'edited');
      f.rows = core.pdfRows(L, doc); f.form = core.pdfForm(L, doc); f.formInit = Object.assign({}, f.form); f.risks = []; f.editing = false;
    } catch (e) { f.status = 'error'; f.error = e && e.message === 'lib' ? LIB_ERR : 'Non è stato possibile salvare le modifiche.'; }
    renderCard(f);
  }
  var strip = function (f) { return f.mode === 'pdf' ? stripPdf(f) : stripImage(f); };

  function removeFile(f) {
    if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    if (f.result) URL.revokeObjectURL(f.result.url);
    state[f.mode] = state[f.mode].filter(function (x) { return x !== f; });
    var el = document.getElementById('ac-clean-' + f.id);
    if (el) el.remove();
    renderBar(f.mode);
    if (!state[f.mode].length) setMsg(f.mode, '');
  }
  function download(url, name) {
    var a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  async function zipAll(m) {
    var ready = state[m].filter(function (f) { return f.result; });
    if (!ready.length) return;
    try {
      var Z = await lib('zip'), zip = new Z(), used = {};
      ready.forEach(function (f) { zip.file(core.uniqueName(f.result.name, used), f.result.blob); });
      var blob = await zip.generateAsync({ type: 'blob' }), url = URL.createObjectURL(blob);
      download(url, MODES[m].zip);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('Scaricato ✓');
    } catch (e) { toast(LIB_ERR); }
  }

  // ---------- Eventi ----------
  root.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-ac-act],[data-ac-tab],[data-ac="drop"]') : null, f, act, m, i;
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute('data-ac-tab')) return setTab(t.getAttribute('data-ac-tab'));
    if (t.getAttribute('data-ac') === 'drop') return panels[state.tab].input.click();
    act = t.getAttribute('data-ac-act'); m = t.getAttribute('data-m'); f = getFile(t.getAttribute('data-id'));
    if (act === 'strip-all') { (async function () { var fs = state[m].filter(function (x) { return x.canStrip; }); for (i = 0; i < fs.length; i++) await strip(fs[i]); })(); return; }
    if (act === 'edit-all') { state[m].forEach(function (x) { if (x.canEdit && x.form) { x.editing = true; renderCard(x); } }); return; }
    if (act === 'zip') return zipAll(m);
    if (act === 'clear') { state[m].slice().forEach(removeFile); setMsg(m, ''); return; }
    if (!f) return;
    if (act === 'remove') removeFile(f);
    else if (act === 'details') patch(f, { expanded: !f.expanded });
    else if (act === 'edit') patch(f, { editing: !f.editing });
    else if (act === 'strip') strip(f);
    else if (act === 'save') (f.mode === 'pdf' ? savePdf(f) : saveImage(f));
    else if (act === 'download') { download(f.result.url, f.result.name); toast('Scaricato ✓'); }
  });
  function onField(e) {
    var t = e.target, f = t.getAttribute && t.getAttribute('data-ac-field') ? getFile(t.getAttribute('data-id')) : null;
    if (!f) return;
    f.form[t.getAttribute('data-ac-field')] = t.value;
    if (e.type === 'change' && t.getAttribute('data-ac-field') === 'gps') renderCard(f); // mostra o nasconde latitudine e longitudine
  }
  root.addEventListener('input', onField);
  root.addEventListener('change', onField);
  root.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('data-ac') === 'drop') { e.preventDefault(); panels[state.tab].input.click(); }
  });
  // un'anteprima che non si può mostrare (es. HEIC fuori da Safari) diventa un segnaposto
  root.addEventListener('error', function (e) {
    var li = e.target.closest && e.target.tagName === 'IMG' ? e.target.closest('.ac-file') : null, f = li ? getFile(li.getAttribute('data-id')) : null;
    if (f) patch(f, { previewOk: false });
  }, true);

  Object.keys(panels).forEach(function (m) {
    var P = panels[m];
    P.input.addEventListener('change', function () { addFiles(m, P.input.files); P.input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { P.drop.addEventListener(ev, function (e) { e.preventDefault(); P.drop.setAttribute('data-over', ''); }); });
    ['dragleave', 'drop'].forEach(function (ev) { P.drop.addEventListener(ev, function (e) { e.preventDefault(); P.drop.removeAttribute('data-over'); }); });
    P.drop.addEventListener('drop', function (e) { addFiles(m, e.dataTransfer.files); });
  });
  // un file lasciato fuori dalla zona di rilascio non deve aprirsi nel browser
  window.addEventListener('dragover', function (e) { if (root.contains(e.target) && e.dataTransfer && e.dataTransfer.types.indexOf('Files') > -1) e.preventDefault(); });
  window.addEventListener('drop', function (e) { if (root.contains(e.target)) e.preventDefault(); });
})();
