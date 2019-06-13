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
  // debug: true,
  cheerio: true,
  jar: true,
  json: false
})
const sleep = require('util').promisify(global.setTimeout)

const normalizeFileNames = require('./fileNamer')
const parseBills = require('./bills')

const baseUrl = 'https://cfspart.impots.gouv.fr'

module.exports = new BaseKonnector(start)

async function start(fields) {
  await login(fields)
  await fetchIdentity()
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

  // Precheck Fiscal Number, not mandatory, only for login_failed detection
  try {
    $ = await request({
      method: 'POST',
      uri: `${baseUrl}/GetContexte?op=c&url=`,
      form: {
        url: '',
        spi: fields.login
      }
    })
  } catch (err) {
    log('error', 'Website failed while trying to login')
    log('error', err)
    throw new Error(errors.VENDOR_DOWN)
  }
  if ($.html().includes("postMessage('ctx,EXISTEPAS")) {
    log('error', 'Fiscal number does not exist')
    throw new Error(errors.LOGIN_FAILED)
  }

  try {
    $ = await request({
      method: 'POST',
      uri: `${baseUrl}/LoginAEL?op=c&url=`,
      form: {
        url: '',
        spi: fields.login,
        pwd: fields.password
      }
    })
  } catch (err) {
    log('error', 'Website failed while trying to login')
    log('error', err)
    throw new Error(errors.VENDOR_DOWN)
  }

  // Expect a 200 received here. Login success and login failed come here
  if ($.html().includes("postMessage('ok,https://cfspart.impots.gouv.fr")) {
    log('info', 'Successfully logged in')
    const confirmUrl = $.html().match(/postMessage\(.*,(.*),.*\)/)[1]
    if (confirmUrl) await request(confirmUrl)
  } else if ($.html().includes("postMessage('lmdp")) {
    log('error', 'Password seems wrong')
    throw new Error(errors.LOGIN_FAILED)
  } else {
    throw new Error('UNKOWN_LOGIN_STATUS')
  }
}

async function fetch() {
  /* Mandatory: Fetch details before documents, because pdf access is selective.
     Hopefully, 'details' pdfs are included in 'all documents' pdfs.
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
  if (urlPrefix == undefined) {
    log('error', 'No url prefix defined, unable to continue')
    throw new Error(errors.VENDOR_DOWN)
  }
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

async function fetchIdentity() {
  await request('https://cfspart.impots.gouv.fr/enp/ensu/redirectpas.do')
  await sleep(5000)
  let $ = await request('https://cfspart.impots.gouv.fr/tremisu/accueil.html')
  const result = {}

  result.situationFamiliale = $('#libelle-sit-fam')
    .text()
    .trim()
  result.personnesACharge = Number(
    $('.p-nb-pac')
      .text()
      .split(':')
      .pop()
      .trim()
  )
  result.tauxImposition = parseFloat(
    $('#libelle-tx-foyer')
      .text()
      .replace(',', '.')
      .replace('%', '')
      .trim()
  )
  result.numeroFiscal = $('#head-usager-spi')
    .text()
    .trim()

  $ = await request(
    'https://cfspart.impots.gouv.fr/enp/ensu/chargementprofil.do'
  )

  $ = await request(
    'https://cfspart.impots.gouv.fr/enp/ensu/affichageadresse.do'
  )

  const infos = scrape(
    $,
    { key: '.labelInfo', value: '.inputInfo' },
    '.infoPersonnelle > ul > li'
  )
  for (const info of infos) {
    result[info.key] = info.value
  }

  // result sample :
  // {
  //    situationFamiliale: 'marié(e)',
  //    personnesACharge: 1,
  //    tauxImposition: 0.0,
  //    numeroFiscal: 'XXXXX',
  //    'Prénom': 'PRENOM',
  //    Nom: 'NOM',
  //    'Date de naissance': '1 janvier 1980',
  //    'Lieu de naissance': 'VILLE (57)',
  //    'Adresse électronique validée': 'mail@mail.com',
  //    'Téléphone portable': '+33 0606060606',
  //    'Téléphone fixe': '+33 0909090909'
  //    'Adresse postale': '2 RUE DU MOULIN 00001 VILLE'
  //  }

  return result
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
