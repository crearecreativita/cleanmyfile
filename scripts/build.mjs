// Assembla: frontend/index.html (GitHub Pages) e wordpress/blocco-wordpress.html (incolla-e-via).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const tidy = (s) => s.split('\n').filter((l) => l.trim() !== '').join('\n'); // niente righe vuote: WordPress non le trasforma in <p>

const cfg = JSON.parse(read('config.json'));
const theme = cfg.theme === 'light' ? 'light' : 'dark';
const block = read('frontend/block.html').replaceAll('{{THEME}}', theme).trim();
const css = tidy(read('frontend/ac-cleanmyfile.css'));
const js = tidy(read('frontend/ac-cleanmyfile.js'));

// 1) pagina GitHub Pages
const tpl = read('frontend/index.template.html')
  .replaceAll('{{PAGE_URL}}', cfg.pageUrl)
  .replace('<!--AC_BLOCK-->', block);
writeFileSync(join(root, 'frontend/index.html'), tpl);

// 2) blocco per WordPress / Elementor (widget "HTML")
mkdirSync(join(root, 'wordpress'), { recursive: true });
const wp = `<!-- Rimuovi metadati — Creare Creatività. Incolla tutto in un widget "HTML" di Elementor (o in un blocco "HTML personalizzato"). -->
<style>
${css}
</style>
${tidy(block)}
<script>
${js}
</script>
`;
writeFileSync(join(root, 'wordpress/blocco-wordpress.html'), wp);
console.log('Generati frontend/index.html e wordpress/blocco-wordpress.html');
