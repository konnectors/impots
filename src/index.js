process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://937eb760d70849bea1e72b5ca92c3391:95635578f48d457a9abd3ac5a75aa3b6@sentry.cozycloud.cc/35'

const {
  BaseKonnector,
  requestFactory,
  log,
  scrape,
  saveFiles,
  errors
} = require('cozy-konnector-libs')
const request = requestFactory({
  // debug: true,
  cheerio: true,
  jar: true,
  json: false
})
const querystring = require('querystring')

const baseUrl = 'https://cfspart.impots.gouv.fr'

module.exports = new BaseKonnector(start)

async function start (fields) {
  await login(fields)
  const documents = await fetch()
  await saveFiles(documents, fields)
}

async function login (fields) {
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
    log('error', erreurs.eq(0).text().trim())
    throw new Error(errors.LOGIN_FAILED)
  }
}

async function fetch () {
  let {$, urlPrefix} = await fetchMyDocumentsPage()

  const documents = parseMyDocuments($, urlPrefix)
  const result = await fetchFilesUrls(documents)
  return normalizeOldFileNames(result)
}

async function fetchMyDocumentsPage () {
  // default Mes Documents page
  log('info', 'Fetching the list of documents')
  let $ = await request(`${baseUrl}/acces-usager/cfs`)
  const documentsLink = $('img[name=doc]').closest('a').attr('href')
  const urlPrefix = documentsLink.split('/')[1] // gets "cesu-XX" from the url
  $ = await request(`${baseUrl}${documentsLink}`)

  // full Mes Documents page with all the documents
  const $form = $('form[name=documentsForm]')
  const formUrl = $form.attr('action')
  const token = $form.find('input[name=CSRFTOKEN]').val()

  $ = await request({
    method: 'POST',
    uri: `${baseUrl}${formUrl}`,
    form: {
      annee: 'all',
      CSRFTOKEN: token,
      method: 'rechercheDocuments',
      typeDocument: 'toutDocument',
      typeImpot: 'toutImpot'
    }
  })

  return {$, urlPrefix}
}

function parseMyDocuments ($, urlPrefix) {
  log('info', 'Now parsing the documents links')
  const documents = scrape($, {
    fileurl: {
      attr: 'onclick',
      parse: onclick => {
        const viewerUrl = onclick.match(/\((.*)\)/)[1].split(',')[0].slice(1, -1)
        return `${baseUrl}/${urlPrefix}/${viewerUrl}`
      }
    },
    name: {
      fn: link => {
        return $(link).closest('tr').text()
      }
    }
  }, '.cssLienTable')

  log('info', `Found ${documents.length} documents to download`)

  return documents
}

async function fetchFilesUrls (documents) {
  const result = []
  for (let doc of documents) {
    log('debug', `Fetching doc url for ${doc.name}`)
    const $ = await request(doc.fileurl)
    result.push({
      fileurl: `${baseUrl}${$('iframe').attr('src')}`,
      name: doc.name
    })
  }
  return result
}

function normalizeOldFileNames (documents) {
  return documents.map(doc => {
    if (doc.fileurl.match(/ConsultAR/)) {
      // we have an "accusé de reception" without a file name
      log('info', 'Old accuse de reception without filename')
      const {typeForm, annee, numeroAdonis} = querystring.parse(doc.fileurl)
      doc.filename = `IR-${typeForm}--${annee}-${numeroAdonis}.pdf`
      log('info', 'Changed filename to ' + doc.filename)
    }
    return doc
  })
}
