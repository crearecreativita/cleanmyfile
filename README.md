# Rimuovi metadati da immagini e PDF — Creare Creatività

Strumento gratuito per **vedere, cancellare o modificare i metadati** di immagini (JPEG, PNG, WebP; TIFF e HEIC dove il browser li legge) e PDF. Uno strumento di [Creare Creatività](https://www.crearecreativita.it).

Tutto client-side: nessun backend, nessun file inviato. Costo: zero, gira su GitHub Pages. Nessun framework: JavaScript e CSS a mano (prima era un bundle React da 2 MB). Le uniche librerie, caricate solo quando servono e con controllo SRI da jsDelivr, sono **piexifjs** (scrittura EXIF nei JPEG), **pdf-lib** (PDF) e **JSZip** (download `.zip`).

## Cosa fa

- **Immagini** (fino a 10, 15 MB ciascuna). Mostra i campi trovati con le etichette in italiano ed evidenzia i rischi: posizione GPS, dati del dispositivo, autore.
  - *Cancella tutto* lavora sui byte del file, senza ricomprimere: i pixel restano identici. JPEG: toglie EXIF, XMP, IPTC, commenti, JUMBF/C2PA e miniature; tiene l'orientamento (altrimenti le foto verticali si vedono ruotate) e il profilo ICC. PNG: toglie `tEXt`/`iTXt`/`zTXt`, `eXIf`, `tIME` e i chunk non necessari. WebP: toglie `EXIF` e `XMP`. Altri formati: ridisegno su canvas (esce PNG).
  - *Modifica* (solo JPEG): autore, copyright, descrizione, software, data scatto, GPS (mantieni / rimuovi / imposta). XMP, IPTC e commenti vengono tolti, perché ripeterebbero i vecchi valori.
- **PDF** (fino a 5, 15 MB ciascuno). Cancella o modifica titolo, autore, oggetto, parole chiave, applicazione, software, date. Toglie sempre anche il blocco XMP (dal catalogo e dal file). Non tocca commenti, allegati, livelli, script. Rifiuta i PDF protetti da password.
- Download singolo o `.zip` (nomi duplicati risolti: `foto (2).jpg`).
- Il tool non è pensato per rimuovere watermark invisibili di generatori AI (nota in pagina).

### Correzioni rispetto alla versione precedente

- Il PDF mostrava come "software di produzione" sempre `pdf-lib` e come date quelle di oggi (la libreria le riscrive al caricamento): ora si leggono quelle vere (`updateMetadata: false`).
- La pulizia dei PDF scriveva date del 1970 e lasciava l'XMP con autore e titolo originali: ora i campi vengono eliminati e l'XMP rimosso.
- Sui JPEG "cancella tutto" toglieva solo l'EXIF, non XMP, IPTC e commenti; e perdeva l'orientamento.
- In modifica, con le due caselle GPS vuote le coordinate venivano cancellate di nascosto: ora c'è una scelta esplicita.
- Gli accenti e gli apostrofi tipografici nei campi EXIF si salvano in UTF-8.

## Com'è fatto

```
cleanmyfile/
├── config.json                  URL della pagina WordPress, pagina contatti, tema (unico posto da modificare)
├── frontend/                    ac-cleanmyfile.css, ac-cleanmyfile.js, block.html, index.html (GitHub Pages), font e immagini
├── wordpress/blocco-wordpress.html   blocco già pronto da incollare (CSS + HTML + JS)
├── content/                     testo SEO, FAQ, JSON-LD, impostazioni Yoast
└── scripts/                     build.mjs, build-content.mjs, test.mjs
```

Le classi hanno prefisso `ac-` e tutti i selettori partono da `.ac-clean`, quindi il blocco non tocca il tema. Il font è quello del tema (`--ac-font`, `inherit`); la pagina su GitHub Pages usa Inter e Poppins self-hosted. La scheda iniziale si può scegliere con `#pdf` in fondo all'URL.

Dopo ogni modifica a `frontend/`, `config.json` o `content/faq.json` riesegui:

```bash
npm install --no-save pdf-lib@1.17.1   # solo per i test sui PDF (senza, vengono saltati)
node scripts/test.mjs                  # test di JPEG, PNG, WebP e PDF
node scripts/build.mjs                 # rigenera frontend/index.html e wordpress/blocco-wordpress.html
node scripts/build-content.mjs         # rigenera testo pagina, JSON-LD e Yoast
```

## Incollare lo strumento in Elementor

1. Crea la pagina **Rimuovere metadati** con slug `rimuovere-metadati` (se usi un altro slug, cambia `pageUrl` in `config.json` e riesegui i due build).
2. Apri `content/testo-pagina.html`: contiene la parte sopra il tool, il segnaposto e la parte sotto. Usa i widget *Titolo* e *Editor di testo* (o un widget *HTML*) per le due parti.
3. Nel punto del segnaposto trascina un widget **HTML** e incolla tutto il contenuto di `wordpress/blocco-wordpress.html`. Contiene CSS, markup e JavaScript.
4. In fondo alla pagina aggiungi un altro widget HTML con `content/json-ld.html` (schema WebApplication + FAQPage).
5. Yoast: frase chiave, title e meta description sono in `content/yoast.md`.
6. Se un plugin di cache o minificazione rompe lo script, escludi la pagina dalla minificazione JS. Se hai una Content Security Policy, deve ammettere `cdn.jsdelivr.net` per gli script.
7. Se il widget sta in una colonna stretta, il layout va a capo da solo; sotto i 640 px di schermo è in verticale.

Il testo attorno al tool è HTML normale: Google lo legge anche senza JavaScript.

## GitHub Pages

Il workflow [.github/workflows/pages.yml](.github/workflows/pages.yml) esegue i test, rigenera `frontend/` e pubblica la cartella a ogni push su `main`. In **Settings → Pages** la sorgente deve essere *GitHub Actions*.

La pagina su GitHub Pages ha `<link rel="canonical">` che punta a `pageUrl` (la pagina WordPress), quindi Google considera quella principale.

Sottodominio: `cleanmyfile.crearecreativita.it` (file `frontend/CNAME`). Nel DNS serve il record `CNAME` `cleanmyfile` → `crearecreativita.github.io`; poi in Settings → Pages spunta *Enforce HTTPS*.

## Sviluppo locale

```bash
node scripts/build.mjs
python3 -m http.server 8080 -d frontend   # apri http://localhost:8080
```

## Note

- **Nessun Analytics** sulla pagina GitHub Pages: le visite si misurano sul sito WordPress, che è la pagina principale (il canonical punta lì).
- Il tema chiaro è disponibile con `"theme": "light"` in `config.json`.
- Le librerie hanno la versione fissata e l'hash SRI in `frontend/ac-cleanmyfile.js`: se le aggiorni, ricalcola l'hash.
