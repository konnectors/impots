process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://a43bd181dc0b4a99b4a8085215ca00f1@errors.cozycloud.cc/30'

const {
  BaseKonnector,
  requestFactory,
  log,
  scrape,
  utils,
  errors
} = require('cozy-konnector-libs')

const request = requestFactory({
  debug: false,
  cheerio: true,
  jar: true,
  json: false
})

const moment = require('moment')
moment.locale('fr')
const sleep = require('util').promisify(global.setTimeout)

const { appendMetadata, formatPhone } = require('./metadata')
// eslint-disable-next-line no-unused-vars
const { getBills } = require('./bills')

const baseUrl = 'https://cfspart.impots.gouv.fr'

module.exports = new BaseKonnector(start)

async function start(fields) {
  await login.bind(this)(fields)
  let newDocuments
  try {
    newDocuments = await getDocuments()
    newDocuments = appendMetadata(newDocuments)
  } catch (e) {
    log('warn', 'Error during new documents collection')
    log('warn', e.message)
  }
  log('info', 'saving all files')
  const files = await this.saveFiles(newDocuments, fields, {
    contentType: 'application/pdf',
    fileIdAttributes: ['idEnsua']
  })

  // BYPASSING BILLS FETCH AS PAIMENTS DO NOT WORK
  /* const bills = await getBills(cleanLogin(fields.login), newDocuments)
  log('info', 'saving all bills')
  await this.saveBills(bills, fields, {
    contentType: 'application/pdf',
    fileIdAttributes: ['idEnsua'],
    linkBankOperations: false
  })
  */

  try {
    log('info', 'Fetching identity ...')
    const ident = await fetchIdentity(files)
    await this.saveIdentity(ident, cleanLogin(fields.login))
  } catch (e) {
    log('warn', 'Error during identity scraping or saving')
    log('warn', e.message)
  }
}

function cleanLogin(login) {
  return login.replace(/\s|[A-Z]|[a-z]/g, '')
}

function validateLogin(login) {
  if (login.includes('@') || login.includes('.')) {
    throw new Error('LOGIN_FAILED.FRANCE_CONNECT_LOGIN')
  }

  if (login.length !== 13) {
    log('error', `login length is ${login.length}`)
    throw new Error('LOGIN_FAILED')
  }
}

async function login(fields) {
  log('info', 'Logging in')
  await this.deactivateAutoSuccessfulLogin()
  validateLogin(cleanLogin(fields.login))
  let $

  // Precheck Fiscal Number, not mandatory, only for login_failed detection
  await request.get('https://cfspart.impots.gouv.fr/LoginAccess')
  try {
    $ = await request({
      method: 'POST',
      uri: `${baseUrl}/GetContexte?op=c&url=`,
      form: {
        url: '',
        spi: cleanLogin(fields.login)
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

  if ($.html().includes("postMessage('ctx,3S'")) {
    log(
      'warn',
      `Vous devez créer votre espace en saisissant votre numéro d'accès en ligne et votre revenu fiscal de référence.`
    )
    throw new Error('USER_ACTION_NEEDED.CREATE_ACCOUNT')
  }

  try {
    $ = await request({
      method: 'POST',
      uri: `${baseUrl}/LoginAEL?op=c&url=`,
      form: {
        url: '',
        spi: cleanLogin(fields.login),
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
  } else if ($.html().includes("postMessage('lmdp,4665'")) {
    log('error', 'detected a maintenance, lmdp,4665')
    throw new Error(errors.VENDOR_DOWN + '.MAINTENANCE')
  } else if ($.html().includes("postMessage('lmdp")) {
    log('error', 'Password seems wrong')
    throw new Error(errors.LOGIN_FAILED)
  } else {
    throw new Error('UNKOWN_LOGIN_STATUS')
  }
  await this.notifySuccessfulLogin()
}

async function getDocuments() {
  log('info', 'Getting documents on new interface')
  let docs = []
  const $ = await request(`${baseUrl}/enp/ensu/documents.do?n=0`)
  let years = Array.from(
    $('.date')
      .find('a')
      .map((idx, el) => {
        const year = el.children
          .filter(tag => tag.type === 'text')
          .map(t => t.data)
          .join('')
          .trim()
        if (year.match(/^\d{4}$/) === null) {
          throw 'Docs year scraping failed'
        }
        return Number(year)
      })
  )

  log('debug', `Docs available for years ${years}`)
  for (const year of years) {
    const $year = await request(`${baseUrl}/enp/ensu/documents.do?n=${year}`)
    const tmpDocs = Array.from(
      $year('.documents')
        .find('.document')
        .map((idx, el) => {
          const label = $year(el)
            .find('div.hidden-xs.texte > span')
            .text()
            .trim()
          // Evaluating the buggy label with double text entry
          const buggyLabel = $year(el).find('div.texte > span').text().trim()

          const idEnsua = $year(el).find('input').attr('value')
          let filename = `${year}-${label}.pdf`
          // Replace / and : found in some labels
          // 1) in date (01/01/2018 -> 01-01-2018)
          filename = filename.replace(/\//g, '-')
          // 2) in complementrary form
          filename = filename.replace(' : ', ' - ') // eslint-disable-line
          filename = filename.replace(' : ', ' - ')
          // 3) replace time (19:26 -> 19h26)
          filename = filename.replace(':', 'h')

          // Evaluate the problematic filename the same way
          let buggyFilename = `${year}-${buggyLabel}.pdf`
          buggyFilename = buggyFilename.replace(/\//g, '-')
          buggyFilename = buggyFilename.replace(' : ', ' - ') // eslint-disable-line
          buggyFilename = buggyFilename.replace(' : ', ' - ')
          buggyFilename = buggyFilename.replace(':', 'h')
          // Remove last : in second time appearance (15:27) as it was remove by saveFiles
          buggyFilename = buggyFilename.replace(':', '')

          return {
            year,
            label,
            idEnsua,
            filename,
            fileurl:
              `https://cfspart.impots.gouv.fr/enp/ensu/Affichage_Document_PDF` +
              `?idEnsua=${idEnsua}`,
            shouldReplaceName: buggyFilename
          }
        })
    )
    log('info', `${tmpDocs.length} docs found for year ${year}`)
    docs = docs.concat(tmpDocs)
  }
  return docs
}

async function fetchIdentity(files) {
  // Prefetch is mandatory if we want maritalStatus
  await request('https://cfspart.impots.gouv.fr/enp/ensu/redirectpas.do')
  await sleep(5000) // Need to wait here, if not, maritalStatus is not available
  let $ = await request('https://cfspart.impots.gouv.fr/tremisu/accueil.html')
  const result = { contact: {}, tax_informations: {} }

  result.contact.maritalStatus = $('#libelle-sit-fam').text().trim()
  result.contact.numberOfDependants = Number(
    $('.p-nb-pac').text().split(':').pop().trim()
  )
  result.tax_informations = await fetchTaxInfos(files)
  // Not used for identities, but can be useful later
  // result.contact.tauxImposition = parseFloat(
  //   $('#libelle-tx-foyer')
  //     .text()
  //     .replace(',', '.')
  //     .replace('%', '')
  //     .trim()
  // )

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
  // extractible datas :
  // {
  //    'Prénom': 'PRENOM',
  //    Nom: 'NOM',
  //    'Date de naissance': '1 janvier 1980',
  //    'Lieu de naissance': 'VILLE (57)',
  //    'Adresse électronique validée': 'mail@mail.com',
  //    'Téléphone portable': '+33 0606060606',
  //    'Téléphone fixe': '+33 0909090909'
  //    'Adresse postale': '2 RUE DU MOULIN00001 VILLE'
  //  }

  // We extracted the address this way to be able to keep the cariage return information
  //  and parse it
  const formattedAddress = $('#adressepostale').html().replace('<br>', '\n')

  const linesAddress = formattedAddress.split(/\n|<br>/)
  // <br> is found in some long address as line separator
  const lastLineAddress = linesAddress.pop() // Remove the city line from array
  const street = linesAddress.join('\n')
  const lastLineMatch = lastLineAddress.match(/^\d{5}/)
  const postcode = lastLineMatch ? lastLineMatch[0] : null
  const city = lastLineAddress.replace(postcode, '').trim()

  // Structuring as a io.cozy.contacts
  const maritalStatusTable = {
    'marié(e)': 'married',
    'divorcé(e)/séparé(e)': 'separated',
    'pacsé(e)': 'pacs',
    célibataire: 'single',
    'veuf(ve)': 'widowed'
  }
  result.contact.maritalStatus =
    maritalStatusTable[result.contact.maritalStatus]
  result.contact.address = [{ formattedAddress, street, postcode, city }]

  for (const info of infos) {
    if (info.key === 'Prénom') {
      result.contact.name = { givenName: info.value }
    } else if (info.key === 'Nom') {
      result.contact.name.familyName = info.value
    } else if (info.key === 'Date de naissance') {
      result.contact.birthday = moment(info.value, 'DD MMMM YYYY', 'fr').format(
        'YYYY-MM-DD'
      )
    } else if (info.key === 'Lieu de naissance') {
      result.contact.birthPlace = info.value
    } else if (info.key === 'Adresse électronique validée') {
      result.contact.email = [{ address: info.value }]
    } else if (info.key === 'Téléphone portable') {
      if (info.value != '') {
        if (result.contact.phone) {
          result.contact.phone.push({
            type: 'mobile',
            number: formatPhone(info.value)
          })
        } else {
          result.contact.phone = [
            { type: 'mobile', number: formatPhone(info.value) }
          ]
        }
      }
    } else if (info.key === 'Téléphone fixe') {
      if (info.value != '') {
        if (result.contact.phone) {
          result.contact.phone.push({
            type: 'home',
            number: formatPhone(info.value)
          })
        } else {
          result.contact.phone = [
            { type: 'home', number: formatPhone(info.value) }
          ]
        }
      }
    }
  }
  return result
}

async function fetchTaxInfos(files) {
  const rawTaxInfos = []
  let fiscalRefRevenue
  for (let i = 0; i < files.length; i++) {
    const fileId = files[i].fileDocument._id
    const resp = await utils.getPdfText(fileId)
    let year = files[i].fileDocument.metadata.year
    if (year === undefined) {
      const getYear = files[i].filename.split('-')
      year = getYear[0]
    }
    try {
      const testFiscalRef = resp['2'][0].str
      if (testFiscalRef === `Impôt sur les revenus de ${parseInt(year - 1)}`) {
        const transform = await findTransform(resp)
        fiscalRefRevenue = transform
      }
    } catch (err) {
      log('info', 'No transform property found, continue')
    }
    const firstAJ = resp.text.match(/1AJ Salaires - Déclarant 1 : ([0-9]+)/g)
    const firstBJ = resp.text.match(/1BJ Salaires - Déclarant 2 : ([0-9]+)/g)

    if (firstAJ) {
      if (firstAJ && firstBJ) {
        rawTaxInfos.push({
          filename: files[i].filename,
          year: parseInt(year),
          declarers: {
            firstAJ: firstAJ[0].split(':')[1],
            firstBJ: firstBJ[0].split(':')[1]
          }
        })
      } else {
        log('info', 'no 1BJ line found, saving 1AJ only')
        rawTaxInfos.push({
          filename: files[i].filename,
          year: parseInt(year),
          declarers: { firstAJ: firstAJ[0].split(':')[1] }
        })
      }
    }
    if (fiscalRefRevenue != null) {
      rawTaxInfos.push({
        filename: files[i].filename,
        year: parseInt(year),
        fiscalRefRevenue: fiscalRefRevenue
      })
    }
  }
  const taxInfos = await formatTaxInfos(rawTaxInfos)

  return taxInfos
}

// findTransfrorm will find top-margin of the cell with wanted string and match the value associated
async function findTransform(resp) {
  log('debug', 'Starting findTransform')
  let matchedAmount
  let compareTransform
  // If true, get the last index of the compareTransform array as it is the top-margin of the cell
  for (let i = 0; i < resp['2'].length; i++) {
    const string = resp['2'][i].str
    const findTransform = resp['2'][i].transform
    if (string === `Revenu fiscal de référence`) {
      compareTransform = findTransform.pop()
    }
  }
  // If true, the value in the cell matching the top-margin found above is saved
  for (let i = 0; i < resp['2'].length; i++) {
    const string = resp['2'][i].str
    const findTransform = resp['2'][i].transform.pop()
    if (findTransform === compareTransform) {
      matchedAmount = parseInt(string, 10)
    }
  }
  // Return the value of the matched
  return matchedAmount
}

async function formatTaxInfos(rawTaxInfos) {
  log('info', 'Starting to format tax information')
  const availableYears = []
  const tax_informations = []

  rawTaxInfos.forEach(info => {
    if (info.year) {
      availableYears.push(info.year)
    }
  })
  const uniqYears = [...new Set(availableYears)]

  for (let i = 0; i < uniqYears.length; i++) {
    let firstAJ
    let firstBJ
    let RFR
    let year
    let fileRFR
    let fileFirstJ
    for (let j = 0; j < rawTaxInfos.length; j++) {
      if (rawTaxInfos[j].year === uniqYears[i]) {
        year = rawTaxInfos[j].year
        if (rawTaxInfos[j].declarers) {
          firstAJ = parseInt(rawTaxInfos[j].declarers.firstAJ)
          if (!rawTaxInfos[j].declarers.firstBJ) {
            firstBJ = null
          } else {
            firstBJ = parseInt(rawTaxInfos[j].declarers.firstBJ)
          }
          fileFirstJ = rawTaxInfos[j].filename
        }
        if (rawTaxInfos[j].fiscalRefRevenue) {
          RFR = rawTaxInfos[j].fiscalRefRevenue
          fileRFR = rawTaxInfos[j].filename
        }
      }
    }

    tax_informations.push({
      year: year,
      RFR: RFR,
      '1AJ': firstAJ,
      '1BJ': firstBJ,
      currency: 'EUR',
      files: {
        '1AJ': fileFirstJ,
        '1BJ': fileFirstJ,
        RFR: fileRFR
      }
    })
  }
  return tax_informations
}
