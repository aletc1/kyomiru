import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(__dirname, '../dist')

const LOCALES = [
  {
    locale: 'es-ES',
    path: 'es',
    lang: 'es',
    title: 'Kyomiru — Tu memoria de anime y TV',
    description: 'Una capa de memoria auto-hospedable para anime y TV. Kyomiru muestra los shows que recibieron nuevos episodios mientras no estabas.',
  },
  {
    locale: 'fr-FR',
    path: 'fr',
    lang: 'fr',
    title: 'Kyomiru — Votre mémoire anime et TV',
    description: "Une couche de mémoire auto-hébergeable pour l'anime et la TV. Kyomiru affiche les shows qui ont reçu de nouveaux épisodes pendant votre absence.",
  },
]

const HREFLANG_BLOCK = `  <link rel="alternate" hreflang="en" href="https://www.kyomiru.com/" />
  <link rel="alternate" hreflang="es" href="https://www.kyomiru.com/es" />
  <link rel="alternate" hreflang="fr" href="https://www.kyomiru.com/fr" />
  <link rel="alternate" hreflang="x-default" href="https://www.kyomiru.com/" />`

function patchHtml(html, { lang, title, description, canonical }) {
  return html
    .replace(/<html lang="[^"]*"/, `<html lang="${lang}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/,
      `$1${description}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/,
      `$1${title}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/,
      `$1${description}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/,
      `$1https://www.kyomiru.com${canonical ? '/' + canonical : '/'}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/,
      `$1${title}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/,
      `$1${description}$2`)
    .replace('</head>', `  <link rel="canonical" href="https://www.kyomiru.com/${canonical || ''}" />\n${HREFLANG_BLOCK}\n</head>`)
}

const baseHtml = readFileSync(resolve(distDir, 'index.html'), 'utf-8')

const patchedBase = patchHtml(baseHtml, {
  lang: 'en',
  title: 'Kyomiru — Your anime & TV watch memory',
  description: "A self-hostable memory layer for the anime and TV you've already watched. Kyomiru surfaces shows that quietly got new episodes while you were away.",
  canonical: '',
})
writeFileSync(resolve(distDir, 'index.html'), patchedBase)
console.log('Patched dist/index.html with hreflang alternates')

for (const { path, lang, title, description } of LOCALES) {
  const outDir = resolve(distDir, path)
  mkdirSync(outDir, { recursive: true })
  const patched = patchHtml(baseHtml, { lang, title, description, canonical: path })
  writeFileSync(resolve(outDir, 'index.html'), patched)
  console.log(`Created dist/${path}/index.html`)
}
