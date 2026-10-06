// Genera da content/faq.json: testo della pagina (HTML), JSON-LD e controlli di lunghezza per Yoast.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const faq = JSON.parse(readFileSync(join(root, 'content/faq.json'), 'utf8'));
const cfg = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
const PAGE_URL = cfg.pageUrl;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SEO = {
  keyphrase: 'rimuovere metadati',
  related: 'rimuovere metadati foto, rimuovere metadati pdf, cancellare dati exif',
  title: 'Rimuovere metadati da immagini e PDF: strumento gratis',
  meta: 'Rimuovi o modifica i metadati di foto e PDF gratis: cancella GPS, autore e dati del dispositivo. Tutto nel browser, nessun file viene caricato.',
};

const part1 = `<h1>Rimuovere metadati da immagini e PDF, gratis e senza caricare nulla</h1>
<p>Mandi una foto a un cliente, o metti un PDF sul sito. Prima conviene rimuovere i metadati: dentro quei file c’è molto più di quello che vedi, dal punto esatto in cui hai scattato al nome di chi ha creato il documento.</p>
<p>Carica qui sotto fino a 10 immagini o 5 PDF e guarda cosa contengono. Poi <strong>cancelli tutto con un click</strong>, oppure modifichi i campi uno per uno. Nessun file lascia il tuo computer: l’elaborazione avviene nel browser.</p>`;

const part2 = `<h2>Che cosa sono i metadati, in due righe</h2>
<p>Sono dati scritti dentro il file, invisibili a occhio. Nelle foto si chiamano EXIF e raccontano come, quando e con cosa è stato fatto lo scatto. Nei PDF sono titolo, autore, programma di creazione e date. Lo strumento li mostra tutti prima di toccare qualsiasi cosa, così decidi tu.</p>

<h2>Quando conviene toglierli</h2>
<p><strong>Prima di pubblicare o inviare una foto scattata a casa, in studio o in un luogo che non vuoi far trovare.</strong> Le coordinate GPS, se la localizzazione della fotocamera è attiva, finiscono nel file.</p>
<p><strong>Prima di mandare un PDF a un cliente.</strong> Il campo autore e il titolo possono portarsi dietro il nome di un collega o di un documento da cui sei partito. Capita più spesso di quanto pensi, quando si lavora riciclando file.</p>
<p>Molte piattaforme tolgono i metadati da sole quando carichi un’immagine, ma non tutte, e non sai cosa succede con una mail o con un file mandato come documento. Pulire prima costa trenta secondi.</p>

<h2>Quando invece non serve</h2>
<p>Se pubblichi la foto di un prodotto fatta in laboratorio, i metadati sono innocui. Anzi: autore e copyright dentro il file possono aiutarti a rivendicare un’immagine. Per questo c’è anche la modifica campo per campo, non solo il tasto “cancella tutto”.</p>

<h2>Cosa tolgo e cosa lascio</h2>
<p>Nelle immagini tolgo EXIF, GPS, XMP, IPTC e commenti <strong>senza ricomprimere i pixel</strong>: la qualità resta identica. Nei JPEG lascio l’orientamento, altrimenti le foto verticali si vedrebbero storte, e il profilo colore, per non cambiare i colori. Nei PDF cancello i campi del documento e il blocco XMP, che ripete gli stessi dati. Sotto ogni file vedi sempre cosa è rimasto.</p>
<p>Non tocco invece commenti, allegati e script dentro un PDF, e non rimuovo i watermark invisibili dei generatori di immagini. Se il documento è delicato, controllalo anche a mano.</p>

<h2>Domande frequenti</h2>
${faq.map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`).join('\n')}

<p>Stai preparando immagini e documenti per un sito o per una stampa e vuoi che siano a posto fin dall’inizio? <a href="${cfg.contactUrl}">Scrivimi</a>: ne parliamo.</p>`;

writeFileSync(join(root, 'content/testo-pagina.html'),
`<!-- TESTO DELLA PAGINA "Rimuovere metadati" — HTML puro, leggibile da Google senza JavaScript.
     Se il tema stampa già il titolo della pagina come H1, togli l'<h1> qui sotto e metti lo stesso testo come titolo della pagina.
     Generato da scripts/build-content.mjs: non modificare a mano, cambia lo script o content/faq.json. -->

<!-- ===== PARTE 1: sopra il tool ===== -->
${part1}

<!-- ===== QUI VA IL BLOCCO DEL TOOL: wordpress/blocco-wordpress.html ===== -->

<!-- ===== PARTE 2: sotto il tool ===== -->
${part2}
`);

const jsonld = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      '@id': PAGE_URL + '#strumento',
      name: 'Rimuovi o modifica i metadati di immagini e PDF',
      url: PAGE_URL,
      description: 'Strumento gratuito che mostra e rimuove i metadati (EXIF, GPS, autore, dati del dispositivo) di immagini JPEG, PNG, WebP e dei PDF, oppure li modifica campo per campo. Funziona nel browser: nessun file viene caricato.',
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Qualsiasi (nel browser)',
      browserRequirements: 'Richiede JavaScript',
      inLanguage: 'it',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      creator: { '@type': 'Person', name: 'Alessandro Minotto', url: 'https://www.crearecreativita.it/' },
      provider: { '@type': 'Organization', name: 'Creare Creatività', url: 'https://www.crearecreativita.it/' },
    },
    {
      '@type': 'FAQPage',
      '@id': PAGE_URL + '#faq',
      mainEntity: faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ],
};

writeFileSync(join(root, 'content/json-ld.html'),
`<!-- Incolla in un widget "HTML" di Elementor in fondo alla pagina (o in Yoast > Schema). Le risposte coincidono con il testo visibile. -->
<script type="application/ld+json">
${JSON.stringify(jsonld, null, 2)}
</script>
`);

const slug = new URL(PAGE_URL).pathname.replaceAll('/', '');
writeFileSync(join(root, 'content/yoast.md'),
`# Impostazioni Yoast per la pagina "Rimuovere metadati"

(Generato da scripts/build-content.mjs: non modificare a mano, cambia lo script.)

| Campo | Valore |
|---|---|
| **Frase chiave principale** | ${SEO.keyphrase} |
| **Frasi chiave correlate** | ${SEO.related} |
| **SEO title** (${SEO.title.length}/60) | ${SEO.title} |
| **Meta description** (${SEO.meta.length}/155) | ${SEO.meta} |
| **Slug** | ${slug} |
| **URL finale** | ${PAGE_URL} |
| **Canonical della versione su GitHub Pages** | punta a ${PAGE_URL} (già impostato in frontend/index.html) |

## Note

- La frase chiave "${SEO.keyphrase}" è nell'H1, nel primo paragrafo, nel title e nella meta description (lo slug è il nome del tool: cleanmyfile).
- Il testo sta in HTML normale: Google lo legge anche senza JavaScript. Solo il tool è in JavaScript.
- Imposta la pagina su index, follow e inseriscila nella sitemap.
`);

const warn = [];
if (SEO.title.length > 60) warn.push(`title troppo lungo (${SEO.title.length})`);
if (SEO.meta.length > 155) warn.push(`meta description troppo lunga (${SEO.meta.length})`);
if (!part1.split('</h1>')[0].toLowerCase().includes(SEO.keyphrase)) warn.push('la frase chiave non è nell’H1');
if (warn.length) { console.error('ATTENZIONE Yoast:', warn.join('; ')); process.exitCode = 1; }
console.log(`Generati content/testo-pagina.html, json-ld.html, yoast.md (title ${SEO.title.length}/60, meta ${SEO.meta.length}/155)`);
