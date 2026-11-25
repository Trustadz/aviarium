import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const database = process.env.AVIARIUM_I18N_TEST_DATABASE_URL
if (!database) throw new Error('Set AVIARIUM_I18N_TEST_DATABASE_URL to a disposable PostgreSQL database.')
const port = Number(process.env.AVIARIUM_I18N_TEST_PORT || 4194)
const origin = 'http://127.0.0.1:' + port
Object.assign(process.env, {
  DATABASE_URL: database, LOGIN_ENABLED: 'false', TEST_ENVIRONMENT: 'true',
  PUBLIC_ORIGIN: origin, HOST: '127.0.0.1', AVIARIUM_ENABLED_LOCALES: 'en,nl',
  OPENAI_API_KEY: 'local-test-fixture', AVIARIUM_TRANSLATION_MODEL: 'local-test-fixture',
})

const { migrate } = await import('../dist/apps/server/src/migrate.js')
const { makeApp } = await import('../dist/apps/server/src/app.js')
const { pool } = await import('../dist/apps/server/src/config.js')
const { runNewsTranslations } = await import('../dist/apps/server/src/news-translation.js')
const id = crypto.randomUUID().slice(0, 8)
const english = { title: 'Test announcement ' + id, intro: 'An English introduction.', body: '', headerAlt: '' }
const dutch = { title: 'Testaankondiging ' + id, intro: 'Een Nederlandse inleiding.', body: '', headerAlt: '' }

const realFetch = globalThis.fetch
let providerCalls = 0
globalThis.fetch = async (url, options) => {
  if (url !== 'https://api.openai.com/v1/responses') return realFetch(url, options)
  const request = JSON.parse(options.body)
  assert.equal(request.store, false)
  assert.deepEqual(JSON.parse(request.input), english)
  assert.equal(request.text.format.strict, true)
  providerCalls++
  return Response.json({ status: 'completed', output: [
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(dutch) }] },
  ] })
}

const stop = new AbortController()
let app, browser, worker
try {
  await migrate()
  app = await makeApp()
  await app.listen({ host: '127.0.0.1', port })
  worker = runNewsTranslations(stop.signal)
  browser = await chromium.launch({ executablePath: process.env.AVIARIUM_CHROMIUM })
  const admin = await browser.newContext({ locale: 'nl-NL' })
  const player = await browser.newContext({ locale: 'en-US' })
  const json = { Origin: origin, 'Content-Type': 'application/json' }
  for (const [context, role] of [[admin, 'admin'], [player, 'user']]) {
    const response = await context.request.post(origin + '/api/auth/test-role', { headers: json, data: { role } })
    assert.equal(response.status(), 204)
  }

  const publish = { category: 'update', translations: { en: english, nl: dutch } }
  const denied = await player.request.post(origin + '/api/news', { headers: json, data: publish })
  assert.equal(denied.status(), 403)
  assert.equal((await denied.json()).code, 'permission_denied')
  const invalid = await admin.request.post(origin + '/api/news', { headers: json, data: { ...publish, translations: { en: english } } })
  assert.equal(invalid.status(), 400)
  const incomplete = await admin.request.post(origin + '/api/news', { headers: json, data: {
    ...publish, translations: { en: { ...english, body: 'English body only.' }, nl: dutch },
  } })
  assert.equal(incomplete.status(), 400)
  assert.equal((await incomplete.json()).code, 'announcement_translation_incomplete')

  const page = await admin.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error))
  await page.goto(origin + '/news')
  await page.getByRole('heading', { name: 'Nieuw in Aviarium 0.1.13' }).waitFor()
  await page.getByRole('heading', { name: 'Nieuw in Aviarium 0.1.14' }).waitFor()
  await page.getByRole('heading', { name: 'Nieuw in Aviarium 0.1.15' }).waitFor()
  assert.equal(await page.locator('html').getAttribute('lang'), 'nl')
  await page.getByRole('button', { name: /Accountmenu/ }).click()
  await page.getByRole('button', { name: 'Apparaatinstellingen' }).click()
  await page.getByRole('dialog', { name: 'Apparaatinstellingen' }).waitFor()
  assert.equal(await page.getByLabel('Taal', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Sluiten', exact: true }).click()
  await page.getByRole('button', { name: 'Nieuwe aankondiging' }).click()
  const englishFields = page.getByRole('group', { name: 'English' })
  const dutchFields = page.getByRole('group', { name: 'Nederlands' })
  await englishFields.getByLabel('Titel').fill(english.title)
  await englishFields.getByLabel('Inleiding').fill(english.intro)
  await page.getByRole('button', { name: 'Vertaalconcept maken met AI' }).click()
  await dutchFields.getByLabel('Titel').waitFor()
  for (let attempt = 0; attempt < 60 && (await dutchFields.getByLabel('Titel').inputValue()) !== dutch.title; attempt++) await delay(200)
  assert.equal(await dutchFields.getByLabel('Titel').inputValue(), dutch.title)
  assert.equal(providerCalls, 1)
  assert.ok(!(await (await player.request.get(origin + '/api/news')).json()).posts.some(post => post.title === english.title))
  const reviewedDutch = dutch.title + ' gecontroleerd'
  await dutchFields.getByLabel('Titel').fill(reviewedDutch)
  await page.getByRole('button', { name: 'Aankondiging publiceren' }).click()
  const news = page.getByRole('article').filter({ has: page.getByRole('heading', { name: reviewedDutch }) })
  await news.getByRole('button', { name: 'Aankondiging leuk vinden' }).click()
  await news.getByRole('button', { name: 'Vind-ik-leuk intrekken' }).waitFor()

  const en = (await (await player.request.get(origin + '/api/news?locale=en')).json()).posts.find(post => post.title === english.title)
  const nl = (await (await player.request.get(origin + '/api/news?locale=nl')).json()).posts.find(post => post.title === reviewedDutch)
  assert.equal(nl.id, en.id)
  assert.equal(en.likes, 1)
  assert.equal(nl.locale, 'nl')
  const edit = await admin.request.put(origin + '/api/news/' + en.id + '/translations',
    { headers: json, data: { revision: 1, translations: publish.translations } })
  assert.equal(edit.status(), 200)
  const stale = await admin.request.put(origin + '/api/news/' + en.id + '/translations',
    { headers: json, data: { revision: 1, translations: publish.translations } })
  assert.equal(stale.status(), 409)

  await page.goto(origin + '/games/sudoku/how-to')
  await page.getByRole('heading', { name: 'Zo speel je Sudoku' }).waitFor()
  await page.getByRole('heading', { name: 'Het doel' }).waitFor()
  await page.goto(origin + '/games/sudoku')
  await page.getByRole('button', { name: /Grasparkieten/ }).click()
  await page.getByRole('button', { name: 'Spelen: Zitstok in de tuin' }).click()
  await page.getByRole('heading', { name: 'Zitstok in de tuin' }).waitFor()
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.waitForFunction(async () => Boolean(await caches.match('/__aviarium/last-played', { cacheName: 'aviarium-game-sudoku' })))
  const board = page.getByLabel('Sudokubord', { exact: true })
  const firstCell = board.locator('button').first()
  await firstCell.waitFor()
  await page.getByRole('button', { name: 'Notities', exact: true }).click()
  await firstCell.press('1')
  await firstCell.getByText('1', { exact: true }).waitFor()
  const before = await board.locator('button').allTextContents()
  assert.equal(before.length, 81)
  await page.getByRole('button', { name: 'Hint', exact: true }).click()
  await admin.setOffline(true)
  assert.equal(await page.getByRole('button', { name: 'Accountinstellingen', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Terug', exact: true }).click()
  await page.getByRole('button', { name: 'Terug', exact: true }).click()
  await page.getByRole('button', { name: 'Terug', exact: true }).click()
  await page.getByRole('button', { name: /Accountmenu/ }).click()
  await page.getByRole('button', { name: 'Accountinstellingen', exact: true }).click()
  await page.getByLabel('Taal').selectOption('en')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const savedPuzzle = page.getByRole('region', { name: 'Continue' }).getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Garden Perch', exact: true }) })
  await savedPuzzle.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.getByRole('heading', { name: 'Garden Perch', level: 1 }).waitFor()
  assert.equal(await page.locator('html').getAttribute('lang'), 'en')
  assert.deepEqual(await page.getByLabel('Sudoku board', { exact: true }).locator('button').allTextContents(), before)
  await page.locator('.hint-trigger:not([disabled])').waitFor()
  await page.getByRole('button', { name: 'Hint', exact: true }).click()
  await page.locator('.hint-drawer[data-open=true]').waitFor()
  await page.locator('.hint-drawer').getByText(/Hint/).first().waitFor()
  assert.deepEqual(errors, [])
  await admin.setOffline(false)
  let remoteLocale
  for (let attempt = 0; attempt < 30 && remoteLocale !== 'en'; attempt++) {
    const progress = await admin.request.get(origin + '/api/progress')
    assert.equal(progress.status(), 200)
    remoteLocale = (await progress.json()).prefs.data.locale
    if (remoteLocale !== 'en') await delay(200)
  }
  assert.equal(remoteLocale, 'en')
  assert.equal((await (await player.request.get(origin + '/api/progress')).json()).prefs.data.locale, undefined)

  const anotherDevice = await browser.newContext({ locale: 'nl-NL',
    storageState: { cookies: await admin.cookies(), origins: [] } })
  const anotherPage = await anotherDevice.newPage()
  await anotherPage.goto(origin + '/news')
  await anotherPage.getByRole('heading', { name: 'What’s new', level: 1, exact: true }).waitFor()
  assert.equal(await anotherPage.locator('html').getAttribute('lang'), 'en')
  console.log('Passed bilingual publication, AI review, shared likes, edit conflicts, and offline language switching.')
} finally {
  stop.abort()
  await Promise.allSettled([worker, app?.close(), browser?.close()])
  await pool.end()
  globalThis.fetch = realFetch
}
