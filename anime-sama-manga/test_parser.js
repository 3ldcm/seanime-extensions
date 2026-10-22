/**
 * Fixture tests for anime-sama-manga/provider.js — run with `node test_parser.js`.
 *
 * Fixtures are trimmed copies of real fragment.php cards captured on
 * 2026-10-22 from https://anime-sama.to/catalogue/fragment.php?search=…
 * The point of this file is to lock the 2026-10 card markup: `as-carte` divs
 * with data-url/data-nom/data-img and as-badge-scan / as-badge-webtoon badges.
 * The old `catalog-card` + <p class="info-value">Types</p> markup must no
 * longer be relied upon (the catalogue page stopped rendering it).
 */
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(path.join(__dirname, 'provider.js'), 'utf8')
const Provider = new Function(`${src}\nreturn Provider`)()
const p = new Provider()

let failures = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) {
        console.log(`  ok   ${name}`)
    } else {
        failures++
        console.log(`  FAIL ${name}\n       actual:   ${a}\n       expected: ${e}`)
    }
}

// --- fixture 1: two cards, one anime+scan (kept), one anime-only (skipped) ---
const FIXTURE_MIXED = `
<div class="as-carte as-carte-oeuvre" data-url="/catalogue/one-piece/" data-cat="oeuvre" data-nom="One Piece" data-img="https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/one-piece.jpg"><a class="as-carte-lien" href="https://anime-sama.to/catalogue/one-piece" draggable="false"><div class="as-carte-image"><img src="https://cdn.jsdelivr.net/gh/Anime-Sama/IMG@img/contenu/thumb/one-piece.webp" alt="" loading="lazy"></div><div class="as-carte-badges"><span class="as-badge as-badge-anime">Anime</span><span class="as-badge as-badge-scan">Scans</span></div><div class="as-carte-texte"><h3 class="as-carte-titre" title="One Piece">One Piece</h3></div></a><button class="pf-carte-btn" type="button" aria-label="Actions" title="Actions"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M3 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z" /></svg></button></div>
<div class="as-carte as-carte-oeuvre" data-url="/catalogue/naruto-sd-rock-lee/" data-cat="oeuvre" data-nom="Naruto SD Rock Lee" data-img="https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/naruto-sd-rock-lee.jpg"><a class="as-carte-lien" href="https://anime-sama.to/catalogue/naruto-sd-rock-lee" draggable="false"><div class="as-carte-image"><img src="https://cdn.jsdelivr.net/gh/Anime-Sama/IMG@img/contenu/thumb/naruto-sd-rock-lee.webp" alt=""></div><div class="as-carte-badges"><span class="as-badge as-badge-anime">Anime</span></div><div class="as-carte-texte"><h3 class="as-carte-titre" title="Naruto SD Rock Lee">Naruto SD Rock Lee</h3></div></a></div>
`

// --- fixture 2: webtoon-only card (real case: Infinite Mage has scans but no scan badge) ---
const FIXTURE_WEBTOON = `<div class="as-carte as-carte-oeuvre" data-url="/catalogue/infinite-mage/" data-cat="oeuvre" data-nom="Infinite Mage" data-img="https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/infinite-mage.jpg"><a class="as-carte-lien" href="https://anime-sama.to/catalogue/infinite-mage" draggable="false"><div class="as-carte-image"><img src="https://cdn.jsdelivr.net/gh/Anime-Sama/IMG@img/contenu/thumb/infinite-mage.webp" alt=""></div><div class="as-carte-badges"><span class="as-badge as-badge-webtoon">Webtoon</span><span class="as-drapeau"><img src="https://cdn.jsdelivr.net/gh/Anime-Sama/IMG@img/autres/flag_fr.png" alt="VF" title="VF"></span></div><div class="as-carte-texte"><h3 class="as-carte-titre" title="Infinite Mage">Infinite Mage</h3></div></a></div>`

// --- fixture 3: legacy markup that the site no longer serves ---
const FIXTURE_LEGACY = `<div class="catalog-card"><a href="https://anime-sama.to/catalogue/blue-lock"><h2 class="card-title">Blue Lock</h2></a><p class="info-value">Anime, Scans</p></div>`

console.log('parseSearchResults — new markup')
check('mixed: keeps scan card, drops anime-only card', p.parseSearchResults(FIXTURE_MIXED), [
    {
        id: 'one-piece',
        title: 'One Piece',
        image: 'https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/one-piece.jpg',
    },
])
check('webtoon-only card is kept', p.parseSearchResults(FIXTURE_WEBTOON), [
    {
        id: 'infinite-mage',
        title: 'Infinite Mage',
        image: 'https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/infinite-mage.jpg',
    },
])
check('legacy catalog-card markup yields nothing', p.parseSearchResults(FIXTURE_LEGACY), [])
check('empty payload yields nothing', p.parseSearchResults(''), [])

console.log('parseSearchResults — attribute fallbacks')
check(
    'slug/title/image fall back to href + h3 + <img> when data-* are missing',
    p.parseSearchResults(
        '<div class="as-carte"><a href="https://anime-sama.to/catalogue/blue-lock"><div class="as-carte-badges"><span class="as-badge as-badge-scan">Scans</span></div><h3 class="as-carte-titre">Blue Lock</h3><img src="https://cdn.example/blue-lock.webp"></a></div>'
    ),
    [{ id: 'blue-lock', title: 'Blue Lock', image: 'https://cdn.example/blue-lock.webp' }]
)

console.log('findChapterPages — static page URLs from the encoded chapter id')
async function asyncChecks() {
    check(
        'builds 3 page URLs with referer',
        await p.findChapterPages('infinite-mage|Infinite%20Mage|vf|1|3'),
        [
            { url: 'https://anime-sama.to/s2/scans/Infinite%20Mage/1/1.jpg', index: 0, headers: { Referer: 'https://anime-sama.to/' } },
            { url: 'https://anime-sama.to/s2/scans/Infinite%20Mage/1/2.jpg', index: 1, headers: { Referer: 'https://anime-sama.to/' } },
            { url: 'https://anime-sama.to/s2/scans/Infinite%20Mage/1/3.jpg', index: 2, headers: { Referer: 'https://anime-sama.to/' } },
        ]
    )

    console.log('getWorkTitle — raw title (spacing preserved)')
    check('keeps trailing spaces of the oeuvre title', p.getWorkTitle('<h1 id="titreOeuvre" class="oe-titre">Blue Lock  </h1>'), 'Blue Lock  ')

    console.log(failures === 0 ? '\nall fixtures passed' : `\n${failures} fixture(s) failed`)
    process.exit(failures === 0 ? 0 : 1)
}

asyncChecks()