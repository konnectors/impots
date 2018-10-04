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
const moment = require('moment')

const normalizeFileNames = require('./fileNamer')

const baseUrl = 'https://cfspart.impots.gouv.fr'

module.exports = new BaseKonnector(start)

async function start(fields) {
  await login(fields)
  const [documents, bills] = await fetch()
  await saveFiles(documents, fields)
  await saveBills(bills, fields, {
    identifiers: ['impot', 'impots', 'dgfip', 'd.g.f.i.p', 'ddfip', 'd.d.f.i.p', 'drfip',
                  'd.r.f.i.p', 'tresor public', 'finances pub', 'finances publiques']
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
  const bills = await parseBills($, urlPrefix)

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

async function parseBills($, urlPrefix) {
  /* This big function scrape the tab with multiple column size and
     no specific characteristics to stick
  */
  log('info', 'Parsing bills from detailAccount page')
  let masterBillLink, currentYear
  let bills = []
  const lines = Array.from($('td[class=cssFondTable]').find('table tr'))
  lines.forEach((line, index) => {
    const $line = $(line)
    if (
      // Throw first line as title
      index === 0
    ) {
      log('debug', 'Throw line 0 as title')
    } else if (
      // If line is a master line(2 column), store link and year
      $line.find('td').length === 2 &&
      $line
        .find('td')
        .eq(1)
        .attr('colspan') == 5
    ) {
      log('debug', `Master line detected`)
      masterBillLink = extractLinkInMasterLine($line)
      currentYear = extractYearInMasterLine($line)
    } else if (
      // If line is a same year master line(1 column), store link
      $line.find('td').length === 1 &&
      $line.find('td').attr('colspan') == 5
    ) {
      log('debug', `Master same year line detected`)
      masterBillLink = extractLinkInMasterLine($line)
    } else if (
      // If line is a payment (3 column), make a bill
      $line.find('td').length === 3 &&
      $line
        .find('td')
        .eq(2)
        .text() != '\xa0' // Unbreakable-space as empty cell
    ) {
      log('debug', 'Payment line with 3 column detected')
      let bill = scrapeLine($line, masterBillLink, urlPrefix, 3)
      bills.push(bill)
    } else if (
      // If line is a payment(5 column), make a bill
      $line.find('td').length === 5 &&
      $line
        .find('td')
        .eq(3)
        .text() != '\xa0' // Unbreakable-space as empty cell
    ) {
      log('debug', 'Payment line with 5 column detected')
      let bill = scrapeLine($line, masterBillLink, urlPrefix, 5)
      bills.push(bill)
    } else if (
      // If line is a refund
      $line.find('td').length === 1 &&
      $line.find('td').attr('colspan') == 4
    ) {
      log('debug', 'Refund line detected')
      const bill = scrapeRefundLine(
        $line,
        masterBillLink,
        urlPrefix,
        currentYear
      )
      bills.push(bill)
    }
  })
  return bills
}

function extractLinkInMasterLine($line) {
  let link = $line.find('a').attr('onclick')
  if (link != undefined) {
    link = link.split(`'`)[1]
  }
  return link
}

function extractYearInMasterLine($line) {
  return $line
    .find('td')
    .eq(0)
    .text()
}

function scrapeLine($line, masterBillLink, urlPrefix, model) {
  let amountCol, dateCol
  if (model == 3) {
    amountCol = 2
    dateCol = 0
  } else if (model == 5) {
    amountCol = 3
    dateCol = 1
  }
  const amount = $line
    .find('td')
    .eq(amountCol)
    .text()
  const date = $line
    .find('td')
    .eq(dateCol)
    .text()
    .match(/\d{2}\/\d{2}\/\d{4}/)[0]
  return {
    vendor: 'impot',
    amount: parseFloat(amount.match(/\d+/g).join('')),
    currency: 'EUR',
    date: moment(
      date.match(/\d{1,2}\/\d{1,2}\/\d{4}/)[0],
      'DD-MM-YYYY'
    ).toDate(),
    fileurl: masterBillLink
      ? `${baseUrl}/${urlPrefix}/${masterBillLink}`
      : undefined
  }
}

function scrapeRefundLine($line, masterBillLink, urlPrefix, year) {
  const amountLine = $line.find('td').text()
  return {
    vendor: 'impot',
    amount: parseFloat(amountLine.match(/\d+/g).join('')),
    isRefund: true,
    currency: 'EUR',
    date: moment(`01/07/${year}`, 'DD-MM-YYYY').toDate(),
    fileurl: masterBillLink
      ? `${baseUrl}/${urlPrefix}/${masterBillLink}`
      : undefined
  }
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
