/**
 * Checks for anime-sama/payload.ts — run with `node test_parser.js`.
 *
 * The payload is TypeScript calling sandbox globals (`fetch`, `LoadDoc`), so
 * this file assembles a temporary .ts runner — a LoadDoc tripwire + payload.ts
 * + the assertions — and executes it with Node's --experimental-strip-types.
 *
 * Fixtures are trimmed copies of real material captured on 2026-10-22:
 *
 *  - `episodes.js` for kuroneko-to-majo-no-kyoushitsu S1 VOSTFR: four player
 *    arrays (ansembed + embed4me, ansembed, ansembed + sibnet, minochinos).
 *    The site answers 403 for this file unless the request carries a Referer,
 *    which is why the provider silently listed zero episodes.
 *  - the ansembed embed page keeps its master.m3u8 in plain sight (escaped),
 *    next to a Big Buck Bunny decoy.
 *  - a base-62 packer header: `c.toString(62)` throws
 *    "radix argument must be between 2 and 36" and that exception used to abort
 *    the whole extraction.
 *  - the Embed4me ciphertext is generated locally with the player's own
 *    AES-CBC key/IV (the host is unreachable from the machine this was written
 *    on, so the contract is pinned by ciphertext rather than a live call).
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const providerSource = fs
  .readFileSync(path.join(__dirname, 'payload.ts'), 'utf8')
  // The payload uses the angle-bracket assertion `return <EpisodeServer>{...}`,
  // which Node's --experimental-strip-types rejects (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX).
  // Test-only rewrite: dropping the assertion leaves the same object literal.
  // `Promise<EpisodeServer>` / `Promise<Response>` are untouched (space before `{`).
  .replace(/<EpisodeServer>\{/g, '{')

const SITE = 'https://anime-sama.to'
const SEASON_URL = SITE + '/catalogue/kuroneko-to-majo-no-kyoushitsu/saison1/vostfr/'
const EPISODES_JS_URL = SEASON_URL + 'episodes.js'
const ANSEMBED_URL = 'https://ansembed.net/embed-3q2g98dahgxz.html'
const EMBED4ME_URL = 'https://lpayer.embed4me.com/#ebsnp'
const M3U8 = 'https://prx-1316-ant.vmget.online/hls2/01/02311/3q2g98dahgxz_,n,l,.urlset/master.m3u8?t=-kH7DWaYe&s=1792697835&e=43200'
const EMBED4ME_M3U8 = 'https://prx-9999-ant.vmget.online/hls2/05/01999/abcd1234_,n,l,.urlset/master.m3u8?t=XYZ&e=43200'
const DECOY = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/av1/1080/Big_Buck_Bunny_1080_10s_5MB.mp4'

// Real shape: var epsN = ['<player url>', ...] for each player of the season.
const EPISODES_JS =
  "var eps1 = ['https://lpayer.embed4me.com/#ebsnp','https://lpayer.embed4me.com/#xyz789'];\n" +
  "var eps2 = ['https://ansembed.net/embed-3q2g98dahgxz.html','https://ansembed.net/embed-b7k2m4p9q1wz.html'];\n" +
  "var eps3 = ['https://ansembed.net/embed-3q2g98dahgxz.html','https://video.sibnet.ru/shell.php?videoid=6170164'];\n" +
  "var eps4 = ['https://minochinos.com/embed/gmn1jag23dnu'];\n"

// The m3u8 sits in the page as an escaped literal, next to a sample-clip decoy
// and a protocol-relative copy of the same stream (the duplicate Seanime used to
// list twice in a row).
const ANSEMBED_HTML =
  '<html><head><title>AnsEmbed</title></head><body><div id="player"></div>' +
  '<script>var player = jwplayer("player"); player.setup({sources:[{file:"' +
  DECOY.replace(/\//g, '\\/') +
  '",type:"mp4"}]});</script>' +
  '<script>var cfg = {"file":"' +
  M3U8.replace(/\//g, '\\/').replace(/&/g, '\\u0026') +
  '","type":"hls"};</script>' +
  '<script>var alt = "//' +
  M3U8.slice('https://'.length) +
  '";</script>' +
  '</body></html>'

// Base-62 packer header. The dictionary holds 62 entries, so its last index is
// written "Z" — encoding it with Number.prototype.toString(62) throws
// "radix argument must be between 2 and 36" (the exception used to abort the
// whole extraction). The stream itself sits in plain HTML, exactly as on
// ansembed, so the assertion is: the page still yields its m3u8.
const PACKER_WORDS = (() => {
  const words = []
  for (let i = 0; i < 61; i++) words.push('dummy' + i)
  words.push('window.playerConfig')
  return words
})()
const PACKER_HTML =
  '<html><body><script>' +
  "eval(function(p,a,c,k,e,d){return p}('var src = 'Z';',62," +
  PACKER_WORDS.length +
  ",'" +
  PACKER_WORDS.join('|') +
  "'.split('|'),0,{}))" +
  '</script>' +
  '<script>var cfg = {"file":"' +
  M3U8.replace(/\//g, '\\/').replace(/&/g, '\\u0026') +
  '","type":"hls"};</script>' +
  '</body></html>'

// AES-CBC(kiemtienmua911ca, 1234567890oiuytr) over
// {"cfNative":"<m3u8>","cf":"<fallback>","duration":1440}
const EMBED4ME_HEX =
  'b09c8d6009007bbe62386cad31f28bb2d22ba4ca825c132fd3de0008f18c97cddfb06274797de28fcfe8fbd1cc20b437bd7b6d0213b8acee85021ade4c1d030fe2b19736b3b4bc44937c440634537f17f0b99e35cdaf619ba6e4ebb0ff101e6e934dd435f557bbc8d7919c0cda267160e0c438b0b0ee78b75d33938dccd89e4df3c2a59b258d57bd561bd5da5021659f1dd99f39cd0dfce63a5cad3bb8a449a514ed30921d39f2c988d29158018c963c'

const EPISODE = {
  id: EMBED4ME_URL + ',' + ANSEMBED_URL,
  url: SEASON_URL,
  number: 1,
}

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

let calls = []
function resetCalls(p) {
  calls = []
}
function stubFetch(pages) {
  return async function (url, init) {
    const key = String(url)
    calls.push({ url: key, init: init || {} })
    if (!(key in pages)) throw new Error('unexpected fetch: ' + key)
    const body = pages[key]
    return { ok: true, status: 200, headers: {}, text: async () => body }
  }
}

async function main() {
  const realFetch = globalThis.fetch
  const provider = new Provider()

  console.log('getSettings() — advertised servers')
  check('server list is stable', provider.getSettings().episodeServers,
    ['vk', 'vidmoly', 'movearnpre', 'oneupload', 'uqload', 'stape', 'embed4me', 'ansembed'])

  console.log('deriveReferer() — the Referer episodes.js requires')
  check('episodes.js → its season directory', provider.deriveReferer(EPISODES_JS_URL), SEASON_URL)
  check('a directory URL keeps its own path', provider.deriveReferer(SEASON_URL), SEASON_URL)
  check('catalogue search keeps the query out of the referer', provider.deriveReferer(SITE + '/catalogue/?search=naruto&page=1'), SITE + '/catalogue/')
  check('an embed host refers to itself', provider.deriveReferer(EMBED4ME_URL), 'https://lpayer.embed4me.com/')
  check('a broken URL falls back to the site root', provider.deriveReferer('not a url'), SITE + '/')

  console.log('proxyFetch() — every request carries a UA and a Referer')
  resetCalls(provider)
  globalThis.fetch = stubFetch({ [EPISODES_JS_URL]: EPISODES_JS })
  const raw = await provider.proxyFetch(EPISODES_JS_URL)
  const headers = calls[0].init.headers
  check('Referer is the season page (403 without it)', headers.Referer, SEASON_URL)
  check('a browser User-Agent is sent', /Mozilla\\/5\\.0/.test(headers['User-Agent'] || ''), true)
  check('the body comes back untouched', await raw.text(), EPISODES_JS)

  console.log('parseEpisodeArrays() — one array per player')
  const arrays = provider.parseEpisodeArrays(EPISODES_JS)
  check('four player arrays', arrays.length, 4)
  check('array 1', arrays[0], ['https://lpayer.embed4me.com/#ebsnp', 'https://lpayer.embed4me.com/#xyz789'])
  check('array 4', arrays[3], ['https://minochinos.com/embed/gmn1jag23dnu'])

  console.log('HandleServerUrl() — ansembed keeps its stream in the page')
  resetCalls(provider)
  globalThis.fetch = stubFetch({ [ANSEMBED_URL]: ANSEMBED_HTML })
  provider._Server = 'ansembed'
  const ans = await provider.HandleServerUrl(ANSEMBED_URL)
  check('the escaped m3u8 is unescaped and returned once (protocol-relative copy collapsed)', ans.map((s) => [s.url, s.type]), [[M3U8, 'm3u8']])
  check('the sample clip is dropped', ans.some((s) => s.url.includes('bigbuckbunny')), false)

  console.log('HandleServerUrl() — a base-62 packer must not throw')
  resetCalls(provider)
  globalThis.fetch = stubFetch({ [ANSEMBED_URL]: PACKER_HTML })
  provider._Server = 'ansembed'
  const packed = await provider.HandleServerUrl(ANSEMBED_URL)
  check('the base-62 dictionary does not abort the extraction', packed.map((s) => s.url), [M3U8])

  console.log('HandleServerUrl() — embed4me: API + AES-CBC')
  resetCalls(provider)
  const api =
    'https://lpayer.embed4me.com/api/v1/video?id=ebsnp&w=1920&h=1080&r=' +
    encodeURIComponent('https://lpayer.embed4me.com/')
  globalThis.fetch = stubFetch({ [api]: EMBED4ME_HEX })
  provider._Server = 'embed4me'
  const e4m = await provider.HandleServerUrl(EMBED4ME_URL)
  check('the id from the fragment is traded on the API', calls.map((c) => c.url), [api])
  check('an embed host refers to itself', calls[0].init.headers.Referer, 'https://lpayer.embed4me.com/')
  check('cfNative wins over the cf fallback', e4m.map((s) => [s.url, s.type]), [[EMBED4ME_M3U8, 'm3u8']])

  resetCalls(provider)
  globalThis.fetch = async function () { throw new Error('host unreachable') }
  const dead = await provider.HandleServerUrl(EMBED4ME_URL)
  check('an unreachable host yields no source instead of hanging', dead, [])

  check('a non-hex payload is refused', await provider.decryptAesCbcHex('not-hex', 'kiemtienmua911ca', '1234567890oiuytr'), '')

  console.log('findEpisodeServer() — end to end on the real episode id')
  resetCalls(provider)
  globalThis.fetch = stubFetch({ [EMBED4ME_URL]: '', [api]: EMBED4ME_HEX })
  const viaApi = await provider.findEpisodeServer(EPISODE, 'embed4me')
  check('embed4me goes straight to the API, not the embed page', calls.map((c) => c.url), [api])
  check('the source is returned', viaApi.videoSources.map((s) => s.url), [EMBED4ME_M3U8])

  resetCalls(provider)
  globalThis.fetch = stubFetch({ [ANSEMBED_URL]: ANSEMBED_HTML })
  const viaPage = await provider.findEpisodeServer(EPISODE, 'ansembed')
  check('ansembed reads the embed page', calls.map((c) => c.url), [ANSEMBED_URL])
  check('the source is returned', viaPage.videoSources.map((s) => s.url), [M3U8])
  check('the returned referer is the embed origin', viaPage.headers.referer, 'https://ansembed.net')

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
  `const SITE = ${JSON.stringify(SITE)}`,
  `const SEASON_URL = ${JSON.stringify(SEASON_URL)}`,
  `const EPISODES_JS_URL = ${JSON.stringify(EPISODES_JS_URL)}`,
  `const ANSEMBED_URL = ${JSON.stringify(ANSEMBED_URL)}`,
  `const EMBED4ME_URL = ${JSON.stringify(EMBED4ME_URL)}`,
  `const M3U8 = ${JSON.stringify(M3U8)}`,
  `const EMBED4ME_M3U8 = ${JSON.stringify(EMBED4ME_M3U8)}`,
  `const EPISODES_JS = ${JSON.stringify(EPISODES_JS)}`,
  `const ANSEMBED_HTML = ${JSON.stringify(ANSEMBED_HTML)}`,
  `const PACKER_HTML = ${JSON.stringify(PACKER_HTML)}`,
  `const EMBED4ME_HEX = ${JSON.stringify(EMBED4ME_HEX)}`,
  `const EPISODE = ${JSON.stringify(EPISODE)}`,
  ASSERTIONS,
].join('\n')

const tmpPath = path.join(process.env.TMPDIR || os.tmpdir(), `anime-sama-test-${process.pid}.ts`)
fs.writeFileSync(tmpPath, runner)

try {
  execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', tmpPath], { stdio: 'inherit' })
} finally {
  fs.unlinkSync(tmpPath)
}