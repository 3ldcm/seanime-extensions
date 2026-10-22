/**
 * Checks for sushiscan/main.ts — run with `node test_parser.js`.
 *
 * The provider is TypeScript and calls two globals provided by the Seanime
 * sandbox (`fetch` and `LoadDoc`), so this file assembles a temporary .ts
 * runner — a LoadDoc tripwire + main.ts + the assertions — and executes it with
 * Node's --experimental-strip-types. Fixtures are trimmed copies of real
 * responses captured on 2026-10-22 from sushiscan.net; the checks that matter
 * lock the two bugs this fork fixes:
 *
 *  - an empty User-Agent (Cloudflare answers 403 → "no results found"),
 *  - a `{{placeholder}}` that was never substituted must NOT be read as
 *    "use the FlareSolverr bypass at 127.0.0.1:8191".
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const providerSource = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8')

// Real trimmed response of POST /wp-admin/admin-ajax.php (action=ts_ac_do_search)
const FIXTURE_SEARCH = {
  series: [
    {
      all: [
        {
          ID: 56728,
          post_image: 'https://sushiscan.net/wp-content/uploads/OnePieceEpisodeAceCover.webp',
          post_title: 'One Piece : Episode A',
          post_link: 'https://sushiscan.net/catalogue/one-piece-episode-a/',
        },
        {
          ID: 54478,
          post_image: 'https://sushiscan.net/wp-content/uploads/SanjiFoodWarsCover.webp',
          post_title: 'Sanji&#039;s Food Wars',
          post_link: 'https://sushiscan.net/catalogue/sanjis-food-wars/',
        },
      ],
    },
  ],
}

// Real trimmed `sources` block of https://sushiscan.net/one-piece-chapitre-1180/
const FIXTURE_CHAPTER_HTML =
  '<!DOCTYPE html><html><head><script>window.__DATA = {"sources":[{"source":"Server 1","images":[' +
  '"https:\\/\\/c.sushiscan.net\\/wp-content\\/uploads97\\/OPChap1180-01.webp",' +
  '"https:\\/\\/c.sushiscan.net\\/wp-content\\/uploads97\\/OPChap1180-02.webp",' +
  '"https:\\/\\/c.sushiscan.net\\/wp-content\\/uploads97\\/OPChap1180-03.webp"]}]};</script></head><body></body></html>'

const ASSERTIONS = `
let failures = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log('  ok   ' + name)
  } else {
    failures++
    console.log('  FAIL ' + name + '\\n       actual:   ' + a + '\\n       expected: ' + e)
  }
}

function stub(payloads) {
  return async function (url, init) {
    const key = String(url)
    calls.push({ url: key, init })
    if (!(key in payloads)) throw new Error('unexpected fetch: ' + key)
    const payload = payloads[key]
    return { ok: true, status: 200, headers: {}, text: async () => payload, json: async () => JSON.parse(payload) }
  }
}

let calls = []

async function main() {
  const realFetch = globalThis.fetch

  // ---------------------------------------------------------------- search
  console.log('search() — request contract')
  calls = []
  globalThis.fetch = stub({ 'https://sushiscan.net/wp-admin/admin-ajax.php': JSON.stringify(FIXTURE_SEARCH) })

  const p = new Provider()
  p.useProxyBypass = '{{useProxyBypassSushiScan}}' // never substituted by the host
  p.proxyBypassUrl = '{{proxyBypassUrlSushiScan}}'

  const results = await p.search({ query: 'one piece' })

  check('unsubstituted switch: no FlareSolverr call at all', calls.map((c) => c.url), ['https://sushiscan.net/wp-admin/admin-ajax.php'])
  check('posts to admin-ajax.php', calls[0].url, 'https://sushiscan.net/wp-admin/admin-ajax.php')
  check('uses POST', calls[0].init.method, 'POST')
  check('sends a browser User-Agent (the fix: never empty)', calls[0].init.headers['User-Agent'].startsWith('Mozilla/5.0 (Windows'), true)
  check('sends a sushiscan Referer', calls[0].init.headers['Referer'], 'https://sushiscan.net/')
  check('no empty Cookie header', Object.prototype.hasOwnProperty.call(calls[0].init.headers, 'Cookie'), false)
  check('body carries action + query', [calls[0].init.body.get('action'), calls[0].init.body.get('ts_ac_query')], ['ts_ac_do_search', 'one piece'])
  check('results are mapped (entities decoded)', results, [
    { id: '/catalogue/one-piece-episode-a/', title: 'One Piece : Episode A', image: 'https://sushiscan.net/wp-content/uploads/OnePieceEpisodeAceCover.webp' },
    { id: '/catalogue/sanjis-food-wars/', title: "Sanji's Food Wars", image: 'https://sushiscan.net/wp-content/uploads/SanjiFoodWarsCover.webp' },
  ])

  // ------------------------------------------------- FlareSolverr opt-in
  console.log('search() — optional FlareSolverr bypass')
  calls = []
  globalThis.fetch = stub({
    'http://127.0.0.1:8191/v1': JSON.stringify({ solution: { cookies: [{ name: 'cf_clearance', value: 'abc' }], userAgent: 'UA-from-solver' } }),
    'https://sushiscan.net/wp-admin/admin-ajax.php': JSON.stringify({ series: [{ all: [] }] }),
  })
  const p2 = new Provider()
  p2.useProxyBypass = 'true'
  p2.proxyBypassUrl = 'http://127.0.0.1:8191'
  await p2.search({ query: 'x' })
  check('solver runs first, then the search', calls.map((c) => c.url), ['http://127.0.0.1:8191/v1', 'https://sushiscan.net/wp-admin/admin-ajax.php'])
  check('solver UA and cookies are forwarded', [calls[1].init.headers['User-Agent'], calls[1].init.headers['Cookie']], ['UA-from-solver', 'cf_clearance=abc'])

  console.log('search() — solver down is not fatal')
  calls = []
  globalThis.fetch = async function (url, init) {
    calls.push({ url: String(url), init })
    if (String(url).indexOf('8191') !== -1) throw new Error('Post "http://127.0.0.1:8191/v1": connect: connection refused')
    return { ok: true, status: 200, headers: {}, text: async () => JSON.stringify(FIXTURE_SEARCH), json: async () => FIXTURE_SEARCH }
  }
  const p3 = new Provider()
  p3.useProxyBypass = 'true'
  p3.proxyBypassUrl = 'http://127.0.0.1:8191'
  const r3 = await p3.search({ query: 'one piece' })
  check('search still returns results', r3.length, 2)
  check('still sends a browser UA', calls[1].init.headers['User-Agent'].startsWith('Mozilla/5.0 (Windows'), true)
  check('solver attempted only once per session', calls.filter((c) => c.url.indexOf('8191') !== -1).length, 1)

  // --------------------------------------------------------- chapter pages
  console.log('findChapterPages() — sources block')
  calls = []
  globalThis.fetch = stub({ 'https://sushiscan.net/one-piece-chapitre-1180/': FIXTURE_CHAPTER_HTML })
  const pages = await p.findChapterPages('/one-piece-chapitre-1180/')
  check('one entry per image', pages.length, 3)
  check('image urls + index', pages.map((x) => [x.index, x.url]), [
    [0, 'https://c.sushiscan.net/wp-content/uploads97/OPChap1180-01.webp'],
    [1, 'https://c.sushiscan.net/wp-content/uploads97/OPChap1180-02.webp'],
    [2, 'https://c.sushiscan.net/wp-content/uploads97/OPChap1180-03.webp'],
  ])
  check('pages carry a sushiscan Referer + UA', [pages[0].headers.Referer, pages[0].headers['User-Agent'].startsWith('Mozilla/5.0 (Windows')], ['https://sushiscan.net/one-piece-chapitre-1180/', true])
  globalThis.fetch = stub({ 'https://sushiscan.net/empty/' : '<html><body>no player here</body></html>' })
  check('missing sources block → empty list', (await p.findChapterPages('/empty/')).length, 0)

  // ------------------------------------------------------------------ dates
  console.log('parseChapterDate() — French dates')
  check('"19 avril 2026"', p.parseChapterDate('19 avril 2026'), new Date(Date.UTC(2026, 3, 19)).toISOString())
  check('accented month "1 décembre 2025"', p.parseChapterDate('1 décembre 2025'), new Date(Date.UTC(2025, 11, 1)).toISOString())
  check('unparseable text → undefined (not "Invalid Date")', p.parseChapterDate('hier'), undefined)
  check('what upstream shipped: new Date("19 avril 2026") is invalid in JS', new Date('19 avril 2026').toString().startsWith('Invalid'), true)

  globalThis.fetch = realFetch
  console.log(failures === 0 ? '\\nall checks passed' : '\\n' + failures + ' check(s) failed')
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(function (e) {
  console.log('FAIL ' + ((e && e.stack) || e))
  process.exit(1)
})
`

const runner = [
  '// generated by test_parser.js',
  'globalThis.LoadDoc = function () { throw new Error("LoadDoc must not be called by these checks") }',
  providerSource,
  `const FIXTURE_SEARCH = ${JSON.stringify(FIXTURE_SEARCH)}`,
  `const FIXTURE_CHAPTER_HTML = ${JSON.stringify(FIXTURE_CHAPTER_HTML)}`,
  ASSERTIONS,
].join('\n')

// TMPDIR first: the sandbox redirects temp writes away from the system temp dir
const tmpPath = path.join(process.env.TMPDIR || os.tmpdir(), `sushiscan-test-${process.pid}.ts`)
fs.writeFileSync(tmpPath, runner)

try {
  execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', tmpPath], { stdio: 'inherit' })
} finally {
  fs.unlinkSync(tmpPath)
}