/**
 * Fixture tests for anime-sama-manga/provider.js — run with `node test_parser.js`.
 *
 * Fixtures are trimmed copies of real fragment.php cards captured on
 * 2026-10-22 from https://anime-sama.to/catalogue/fragment.php?search=…&type[]=Scans
 * The point of this file is to lock the 2026-10 card markup: `as-carte` divs
 * with data-url/data-nom/data-img. The old `catalog-card` +
 * <p class="info-value">Types</p> markup must no longer be relied upon (the
 * catalogue page stopped rendering cards at all), and manga filtering is done
 * by the server through `type[]=Scans`, not client side.
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

// --- real card shape, badges included (as served once type[]=Scans is applied) ---
const CARD_ONE_PIECE = `<div class="as-carte as-carte-oeuvre" data-url="/catalogue/one-piece/" data-cat="oeuvre" data-nom="One Piece" data-img="https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/one-piece.jpg"><a class="as-carte-lien" href="https://anime-sama.to/catalogue/one-piece" draggable="false"><div class="as-carte-image"><img src="https://cdn.jsdelivr.net/gh/Anime-Sama/IMG@img/contenu/thumb/one-piece.webp" alt="" loading="lazy"></div><div class="as-carte-badges"><span class="as-badge as-badge-anime">Anime</span><span class="as-badge as-badge-scan">Scans</span></div><div class="as-carte-texte"><h3 class="as-carte-titre" title="One Piece">One Piece</h3></div></a><button class="pf-carte-btn" type="button" aria-label="Actions" title="Actions"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M3 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z" /></svg></button></div>`

// webtoon-only card: real case — "Infinite Mage" has scans but carries only the webtoon badge
const CARD_WEBTOON = `<div class="as-carte as-carte-oeuvre" data-url="/catalogue/infinite-mage/" data-cat="oeuvre" data-nom="Infinite Mage" data-img="https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/infinite-mage.jpg"><a class="as-carte-lien" href="https://anime-sama.to/catalogue/infinite-mage" draggable="false"><div class="as-carte-image"><img src="https://cdn.jsdelivr.net/gh/Anime-Sama/IMG@img/contenu/thumb/infinite-mage.webp" alt=""></div><div class="as-carte-badges"><span class="as-badge as-badge-webtoon">Webtoon</span><span class="as-drapeau"><img src="https://cdn.jsdelivr.net/gh/Anime-Sama/IMG@img/autres/flag_fr.png" alt="VF" title="VF"></span></div><div class="as-carte-texte"><h3 class="as-carte-titre" title="Infinite Mage">Infinite Mage</h3></div></a></div>`

// --- legacy markup that the site no longer serves ---
const FIXTURE_LEGACY = `<div class="catalog-card"><a href="https://anime-sama.to/catalogue/blue-lock"><h2 class="card-title">Blue Lock</h2></a><p class="info-value">Anime, Scans</p></div>`

console.log('parseSearchResults — 2026-10 markup')
check('multi-card payload keeps every card (filtering is server side)', p.parseSearchResults(CARD_ONE_PIECE + CARD_WEBTOON), [
    {
        id: 'one-piece',
        title: 'One Piece',
        image: 'https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/one-piece.jpg',
    },
    {
        id: 'infinite-mage',
        title: 'Infinite Mage',
        image: 'https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/infinite-mage.jpg',
    },
])
check('legacy catalog-card markup yields nothing', p.parseSearchResults(FIXTURE_LEGACY), [])
check('empty payload yields nothing', p.parseSearchResults(''), [])

// Regression: `\bas-carte\b` also matches the nested helper divs (as-carte-badges,
// as-carte-image, as-carte-texte), which truncated every card before its own
// children. Assert on a card with no data-* so the content after a helper div is
// what proves the split is right.
console.log('parseSearchResults — nested as-carte-* helper divs')
check(
    'a nested helper div does not truncate the card',
    p.parseSearchResults(
        '<div class="as-carte"><div class="as-carte-image"><img src="https://cdn.example/blue-lock.webp"></div><div class="as-carte-texte"><h3 class="as-carte-titre">Blue Lock</h3></div><a class="as-carte-lien" href="https://anime-sama.to/catalogue/blue-lock"></a></div>'
    ),
    [{ id: 'blue-lock', title: 'Blue Lock', image: 'https://cdn.example/blue-lock.webp' }]
)

console.log('search() — request contract')
async function networkChecks() {
    const calls = []
    const realFetch = global.fetch
    global.fetch = async (url, init) => {
        calls.push({ url, init })
        return { ok: true, status: 200, text: async () => JSON.stringify({ liste: CARD_WEBTOON, pagination: '', total: 1 }) }
    }
    try {
        const res = await p.search({ query: 'Infinite Mage' })
        check('search hits fragment.php with type[]=Scans', calls[0].url,
            'https://anime-sama.to/catalogue/fragment.php?search=Infinite%20Mage&type%5B%5D=Scans')
        check('search sends the catalogue Referer', calls[0].init.headers.Referer, 'https://anime-sama.to/catalogue/')
        check('search maps the JSON liste to results', res, [
            { id: 'infinite-mage', title: 'Infinite Mage', image: 'https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/infinite-mage.jpg' },
        ])
    } finally {
        global.fetch = realFetch
    }

    console.log('findChapterPages — static page URLs from the encoded chapter id')
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

networkChecks()