/**
 * Checks for voir-anime-v2/payload.ts — run with `node test_parser.js`.
 *
 * The payload is TypeScript calling sandbox globals (`fetch`, `LoadDoc`, `eval`
 * simulation), so this file assembles a temporary .ts runner — a LoadDoc
 * tripwire + payload.ts + the assertions — and executes it with Node's
 * --experimental-strip-types. Fixtures are trimmed copies of real pages
 * captured on 2026-10-22:
 *
 *  - the episode page carries `var thisChapterSources = {...}` (label -> iframe);
 *  - voe.sx answers its embed URL with a 751-byte stub whose only content is
 *    `window.location.href = 'https://derricknationtop.com/e/<id>'`; the player
 *    markup (JWPlayer + /js/loader) only exists on that mirror. Without following
 *    that redirect the provider could never return a VOE source.
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

const EPISODE_URL = 'https://voir-anime.to/anime/buddy-daddies/buddy-daddies-11-vostfr/'
const IFRAME_URL = 'https://voembed.net/embed-wgwl8mvo1rqf.html'
const MIRROR_URL = 'https://derricknationtop.com/e/7411dx8564zs'
const STREAM_URL = 'https://prx-1564-ant-q.vmpx.online/hls2/02/00546/wgwl8mvo1rqf_,n,l,.urlset/master.m3u8?t=abc'

// real shape: {"LECTEUR myTV":"<iframe src=\"...\"></iframe>", ...}
const EPISODE_HTML =
  '<html><body><div id="chapter-video-frame"></div><script>var thisChapterSources = ' +
  JSON.stringify({
    'LECTEUR myTV': `<iframe src="${IFRAME_URL}" scrolling="no" frameborder="0" width="700" height="430"></iframe>`,
    'LECTEUR MOON': '<iframe src="https://mfw09.org/e/rastfi90rum8" scrolling="no" frameborder="0"></iframe>',
    'LECTEUR SB': '<iframe src="https://streamhide.to/e/3qe3v5af0rmm" scrolling="no" frameborder="0"></iframe>',
    'LECTEUR VOE': '<iframe src="https://voe.sx/e/7411dx8564zs" scrolling="no" frameborder="0"></iframe>',
    'LECTEUR Stape': '<iframe src="https://streamtape.com/e/RydrkVoRpmIkOO" scrolling="no" frameborder="0"></iframe>',
    'LECTEUR FHD1': '<iframe src="https://my.mail.ru/video/embed/7427523657800352764" scrolling="no" frameborder="0"></iframe>',
  }) +
  ';</script></body></html>'

// real 751-byte voe.sx stub
const VOEREDIRECT_HTML =
  "<html><body><script>window.location.href = 'https://derricknationtop.com/e/7411dx8564zs';</script></body></html>"

const MIRROR_HTML =
  `<html><head><script src="https://derricknationtop.com/js/loader.a40897e.js"></script></head><body>` +
  `<script>jwplayer('vplayer').setup({"sources":[{"file":"${STREAM_URL}","type":"hls","label":"HLS"}]});</script>` +
  '</body></html>'

const AD_REDIRECT_HTML =
  "<html><body><script>window.location.href = 'https://ads.example/click?id=1';</script></body></html>"

// Real Streamtape shapes: the literal's junk prefix and the number of chained
// .substring() calls change on every page load. Only evaluating the expression
// yields the right URL ('dget_video' / 'stredamtape.com' came from applying the
// first substring only).
const STAPE_HTML =
  '<html><body><div id="robotlink" style="display:none;"></div>' +
  "<script>document.getElementById('robotlink').innerHTML = " +
  "'//streamtape.com/'+ ('xcdget_video?id=RydrkVoRpmIkOO&expires=1&ip=x&token=Tp').substring(2).substring(1);" +
  '</script></body></html>'

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
  p.pageCache = {}
  p.searchCache = {}
}

function stubFetch(pages) {
  return async function (url, init) {
    const key = String(url)
    calls.push({ url: key, init: init || {} })
    if (!(key in pages)) throw new Error('unexpected fetch: ' + key)
    const body = pages[key]
    return { ok: true, status: 200, headers: {}, text: async () => body, json: async () => JSON.parse(body) }
  }
}

async function main() {
  const realFetch = globalThis.fetch
  const provider = new Provider()

  console.log('getSettings() — advertised servers')
  check('only servers that can return a source are advertised', provider.getSettings().episodeServers, ['mytv', 'stape'])

  console.log('extractJsRedirectTarget() — stub forms')
  check('window.location.href', provider.extractJsRedirectTarget(VOEREDIRECT_HTML), MIRROR_URL)
  check('location.replace', provider.extractJsRedirectTarget(String.fromCharCode(60) + 'script>location.replace("https://x.example/e/1")' + String.fromCharCode(60) + '/script>'), 'https://x.example/e/1')
  check('meta refresh', provider.extractJsRedirectTarget('<meta http-equiv="refresh" content="0; url=https://y.example/embed-1.html">'), 'https://y.example/embed-1.html')
  check('no redirect → empty', provider.extractJsRedirectTarget('<html><body>player</body></html>'), '')

  console.log('findEpisodeServer() — JS redirect to the mirror is followed')
  resetCalls(provider)
  globalThis.fetch = stubFetch({
    [EPISODE_URL]: EPISODE_HTML,
    [IFRAME_URL]: VOEREDIRECT_HTML,
    [MIRROR_URL]: MIRROR_HTML,
  })
  const redirected = await provider.findEpisodeServer({ id: EPISODE_URL, url: EPISODE_URL, number: 11 }, 'mytv')
  check('fetches episode, iframe, then the mirror', calls.map((c) => c.url), [EPISODE_URL, IFRAME_URL, MIRROR_URL])
  check('mirror request carries a referer', calls[2].init.headers && calls[2].init.headers.Referer, 'https://voir-anime.to/')
  check('source comes from the mirror page', redirected.videoSources.map((s) => [s.url, s.type]), [[STREAM_URL, 'm3u8']])
  check('returned referer is the mirror origin (not voe.sx)', redirected.headers.referer, 'https://derricknationtop.com/')
  check('server name kept', redirected.server, 'mytv')

  console.log('findEpisodeServer() — a redirect that is not an embed page is ignored')
  resetCalls(provider)
  globalThis.fetch = stubFetch({ [EPISODE_URL]: EPISODE_HTML, [IFRAME_URL]: AD_REDIRECT_HTML })
  const notFollowed = await provider.findEpisodeServer({ id: EPISODE_URL, url: EPISODE_URL, number: 11 }, 'mytv')
  check('no extra request for the ad host', calls.map((c) => c.url), [EPISODE_URL, IFRAME_URL])
  check('no source claimed', notFollowed.videoSources, [])

  console.log('findEpisodeServer() — a normal player page keeps working')
  resetCalls(provider)
  const PLAYER_HTML = '<html><body><script>file: "' + STREAM_URL + '"</script></body></html>'
  globalThis.fetch = stubFetch({ [EPISODE_URL]: EPISODE_HTML, [IFRAME_URL]: PLAYER_HTML })
  const direct = await provider.findEpisodeServer({ id: EPISODE_URL, url: EPISODE_URL, number: 11 }, 'mytv')
  check('two requests only', calls.map((c) => c.url), [EPISODE_URL, IFRAME_URL])
  check('source found', direct.videoSources.map((s) => s.url), [STREAM_URL])
  check('referer stays the iframe origin', direct.headers.referer, 'https://voembed.net/')

  console.log('findEpisodeServer() — decoy video URLs are rejected')
  resetCalls(provider)
  const DECOY_HTML =
    '<html><body><script>var source="https://test-videos.co.uk/vids/bigbuckbunny/mp4/av1/1080/Big_Buck_Bunny_1080_10s_5MB.mp4";</script>' +
    '<script>file: "' + STREAM_URL + '"</script></body></html>'
  globalThis.fetch = stubFetch({ [EPISODE_URL]: EPISODE_HTML, [IFRAME_URL]: DECOY_HTML })
  const withDecoy = await provider.findEpisodeServer({ id: EPISODE_URL, url: EPISODE_URL, number: 11 }, 'mytv')
  check('the sample clip is dropped, the real stream kept', withDecoy.videoSources.map((s) => s.url), [STREAM_URL])

  console.log('streamtape — expression evaluation (four real shapes)')
  check('simple literal', provider.evaluateStringExpression("'//streamtape.com/get_video?id=A&stream=1'"), '//streamtape.com/get_video?id=A&stream=1')
  check('term-level substring', provider.evaluateStringExpression("'//streamtape.com/get_video?id=' + ('xyzTOKEN').substring(3)"), '//streamtape.com/get_video?id=TOKEN')
  check('whole-expression substring', provider.evaluateStringExpression("('//streamtape.com/get_video?id=A&expires=1&token=T').substring(2)"), 'streamtape.com/get_video?id=A&expires=1&token=T')
  check('chained substring (the bug: used to give get_vdideo)', provider.evaluateStringExpression("'//streamtape.com/'+ ('xcdget_video?id=A&token=Tp').substring(2).substring(1)"), '//streamtape.com/get_video?id=A&token=Tp')
  check('chained substring with the host split', provider.evaluateStringExpression("'//stre'+ ('xcdamtape.com/get_video?id=A&token=Tp').substring(2).substring(1)"), '//streamtape.com/get_video?id=A&token=Tp')
  check('identifiers are refused (no page code runs)', provider.evaluateStringExpression("'a' + constructor"), '')

  console.log('streamtape — which element is read')
  check('robotlink then botlink, ideoolink ignored', provider.collectStreamtapeExpressions(
    '<div id="ideoolink"></div><script>document.getElementById("ideoolink").innerHTML = "\\/streamtape.com/get" + (\\'xcdb_video?id=A\\').substring(1).substring(2);</script>' +
    '<script>document.getElementById("botlink").innerHTML = \\'//streamtape.com/ge\\'+ (\\'xyzat_video?id=B\\').substring(4);</script>'
  ), ["'//streamtape.com/ge'+ ('xyzat_video?id=B').substring(4)"])
  check('deleted video page (404, no assignment) yields nothing', provider.collectStreamtapeExpressions('<html><body>Video not found or deleted</body></html>'), [])

  console.log('findEpisodeServer() — streamtape end to end')
  resetCalls(provider)
  const RESOLVED = 'https://861134098.tapecontent.net/radosgw/RydrkVoRpmIkOO/abc?file=video.mp4'
  globalThis.fetch = async function (url, init) {
    const key = String(url)
    calls.push({ url: key, init: init || {} })
    if (key === EPISODE_URL) return { ok: true, status: 200, headers: {}, url: key, text: async () => EPISODE_HTML }
    if (key.indexOf('streamtape.com/e/') !== -1) return { ok: true, status: 200, headers: {}, url: key, text: async () => STAPE_HTML }
    if (key.indexOf('streamtape.com/get_video') !== -1) return { ok: true, status: 200, headers: {}, url: RESOLVED, text: async () => '' }
    throw new Error('unexpected fetch: ' + key)
  }
  const stape = await provider.findEpisodeServer({ id: EPISODE_URL, url: EPISODE_URL, number: 11 }, 'stape')
  check('probed URL = reconstructed get_video URL with stream=1', [calls[2].url.startsWith('https://streamtape.com/get_video?id=RydrkVoRpmIkOO'), calls[2].url.indexOf('&stream=1') !== -1], [true, true])
  check('the resolved CDN URL is returned', stape.videoSources.map((s) => s.url), [RESOLVED])
  check('stape source is typed mp4', stape.videoSources.map((s) => s.type), ['mp4'])

  console.log('search() — AJAX endpoint contract')
  resetCalls(provider)
  const AJAX_JSON = JSON.stringify({ success: true, data: [
    { title: 'Sousou no Frieren 2', url: 'https://voir-anime.to/anime/sousou-no-frieren-2/', type: 'video' },
    { title: 'Sousou no Frieren 2 (VF)', url: 'https://voir-anime.to/anime/sousou-no-frieren-2-vf/', type: 'video' },
  ] })
  globalThis.fetch = stubFetch({ 'https://voir-anime.to/wp-admin/admin-ajax.php': AJAX_JSON })
  const found = await provider.search({ query: 'Sousou no Frieren 2' })
  check('POSTs the theme action to admin-ajax', [calls[0].url, calls[0].init.method, calls[0].init.body], [
    'https://voir-anime.to/wp-admin/admin-ajax.php',
    'POST',
    'action=wp-manga-search-manga&title=Sousou%20no%20Frieren%202',
  ])
  check('one request only (no word-by-word page walk)', calls.length, 1)
  check('VOSTFR entry kept, VF filtered out', found.map((r) => [r.url, r.subOrDub]), [['https://voir-anime.to/anime/sousou-no-frieren-2/', 'sub']])
  const again = await provider.search({ query: 'Sousou no Frieren 2' })
  check('an identical search is served from cache', [calls.length, again.length], [1, 1])

  console.log('findEpisodeServer() — the episode page is cached')
  resetCalls(provider)
  globalThis.fetch = stubFetch({ [EPISODE_URL]: EPISODE_HTML, [IFRAME_URL]: PLAYER_HTML })
  await provider.findEpisodeServer({ id: EPISODE_URL, url: EPISODE_URL, number: 11 }, 'mytv')
  const beforeCache = calls.length
  await provider.findEpisodeServer({ id: EPISODE_URL, url: EPISODE_URL, number: 11 }, 'mytv')
  check('first call fetches page + iframe, second one only the iframe', [beforeCache, calls.length - beforeCache], [2, 1])
  check('the repeated call went straight to the iframe', calls[2].url, IFRAME_URL)

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
  `const EPISODE_URL = ${JSON.stringify(EPISODE_URL)}`,
  `const IFRAME_URL = ${JSON.stringify(IFRAME_URL)}`,
  `const MIRROR_URL = ${JSON.stringify(MIRROR_URL)}`,
  `const STREAM_URL = ${JSON.stringify(STREAM_URL)}`,
  `const EPISODE_HTML = ${JSON.stringify(EPISODE_HTML)}`,
  `const VOEREDIRECT_HTML = ${JSON.stringify(VOEREDIRECT_HTML)}`,
  `const MIRROR_HTML = ${JSON.stringify(MIRROR_HTML)}`,
  `const AD_REDIRECT_HTML = ${JSON.stringify(AD_REDIRECT_HTML)}`,
  `const STAPE_HTML = ${JSON.stringify(STAPE_HTML)}`,
  ASSERTIONS,
].join('\n')

const tmpPath = path.join(process.env.TMPDIR || os.tmpdir(), `voir-anime-test-${process.pid}.ts`)
fs.writeFileSync(tmpPath, runner)

try {
  execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', tmpPath], { stdio: 'inherit' })
} finally {
  fs.unlinkSync(tmpPath)
}