process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://937eb760d70849bea1e72b5ca92c3391:95635578f48d457a9abd3ac5a75aa3b6@sentry.cozycloud.cc/35'

const {
  BaseKonnector,
  requestFactory,
  log,
  scrape,
  saveFiles,
  saveBills,
  errors
} = require('cozy-konnector-libs')
const request = requestFactory({
  //debug: true,
  cheerio: true,
  jar: true,
  json: false
})

const normalizeFileNames = require('./fileNamer')
const parseBills = require('./bills')

const baseUrl = 'https://cfspart.impots.gouv.fr'

module.exports = new BaseKonnector(start)

async function start(fields) {
  await login(fields)
  const [documents, bills] = await fetch()
  await saveFiles(documents, fields)
  await saveBills(bills, fields, {
    identifiers: [
      'impot',
      'impots',
      'dgfip',
      'd.g.f.i.p',
      'ddfip',
      'd.d.f.i.p',
      'drfip',
      'd.r.f.i.p',
      'tresor public',
      'finances pub',
      'finances publiques'
    ]
  })
}

async function login(fields) {
  log('info', 'Logging in')
  let $
  try {
    $ = await request({
      method: 'POST',
      uri: `${baseUrl}/LoginMDP?op=c&url=`,
      form: {
        url: '',
        LMDP_Spi: fields.login,
        LMDP_Password: fields.password,
        LMDP_Spi_tmp: fields.login,
        LMDP_Password_tmp: fields.password
      }
    })
  } catch (err) {
    log('error', 'Website failed while trying to login')
    log('error', err.message)
    throw new Error(errors.VENDOR_DOWN)
  }

  const erreurs = $('.erreur:not(.pasvisible)')
  if (erreurs.length) {
    log(
      'error',
      erreurs
        .eq(0)
        .text()
        .trim()
    )
    throw new Error(errors.LOGIN_FAILED)
  } else {
    log('info', 'Successfully logged in')
  }
}

async function fetch() {
  /* Mandatory: Fetch details before documents, because pdf access is selective.
     Hopefully, 'details' pdfs are include in 'all documents' pdfs.
  */
  let { urlPrefix, token } = await fetchMenu()

  let $ = await getMyDetailAccountPage(urlPrefix, token)
  const bills = parseBills($, urlPrefix, baseUrl)

  $ = await getMyDocumentsPage(urlPrefix, token)
  const documents = parseMyDocuments($, urlPrefix)

  const documentsFetched = await prefetchUrls(documents)
  const billsFetched = await prefetchUrls(bills)

  return [
    normalizeFileNames(documentsFetched),
    normalizeFileNames(billsFetched)
  ]
}

async function fetchMenu() {
  let $ = await request(`${baseUrl}/acces-usager/cfs`)
  const documentsLink = $('img[name=doc]')
    .closest('a')
    .attr('href')
  const urlPrefix = documentsLink.split('/')[1] // gets "cesu-XX" or "cfsu-XX" from the url
  $ = await request(`${baseUrl}${documentsLink}`)
  const $form = $('form[name=documentsForm]')
  const token = $form.find('input[name=CSRFTOKEN]').val()
  return { urlPrefix, token }
}

async function getMyDocumentsPage(urlPrefix, token) {
  log('info', 'Fetching the documents page')

  const $ = await request({
    method: 'POST',
    uri: `${baseUrl}/${urlPrefix}/documents.html`,
    form: {
      annee: 'all',
      CSRFTOKEN: token,
      method: 'rechercheDocuments',
      typeDocument: 'toutDocument',
      typeImpot: 'toutImpot'
    }
  })
  return $
}

async function getMyDetailAccountPage(urlPrefix, token) {
  log('info', 'Fetching the MyDetailAccount page')
  const $ = await request({
    method: 'POST',
    uri: `${baseUrl}/${urlPrefix}/compteRedirection.html`,
    form: {
      annee: 'all',
      CSRFTOKEN: token,
      method: 'redirection',
      date: 'gardeDate',
      typeImpot: 'toutImpot',
      tresorerieCodee: 'toutesTresoreries',
      compte: 'compteDetaille'
    }
  })
  return $
}

function parseMyDocuments($, urlPrefix) {
  log('info', 'Now parsing the documents links')
  const documents = scrape(
    $,
    {
      fileurl: {
        attr: 'onclick',
        parse: onclick => {
          const viewerUrl = onclick
            .match(/\((.*)\)/)[1]
            .split(',')[0]
            .slice(1, -1)
          return `${baseUrl}/${urlPrefix}/${viewerUrl}`
        }
      },
      name: {
        fn: link => {
          return $(link)
            .closest('tr')
            .text()
        }
      }
    },
    '.cssLienTable'
  )

  log('info', `Found ${documents.length} documents to download`)

  return documents
}

async function prefetchUrls(documents) {
  const result = []
  for (let doc of documents) {
    if (doc.fileurl == undefined) {
      log('debug', 'No url provide, delete attribut')
      delete doc.fileurl
      result.push(doc)
    } else {
      log('debug', `Prefetching url for ${doc.fileurl}`)
      const $ = await request(doc.fileurl)
      result.push({
        ...doc,
        fileurl: `${baseUrl}${$('iframe').attr('src')}`
      })
    }
  }
  return result
}
