process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://a43bd181dc0b4a99b4a8085215ca00f1@errors.cozycloud.cc/30'

// This has been added for "Mes papiers" needs
// It must be removed when everything has been sat up and synchronized
// When it will be removed, we will only keep 'refTaxIncome' instead of 'RFR'
const { default: CozyClient } = require('cozy-client')

const {
  BaseKonnector,
  requestFactory,
  log,
  scrape,
  utils,
  errors,
  cozyClient
} = require('cozy-konnector-libs')

// |Mes papiers|
const flag = require('cozy-flags/dist/flag').default

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
    if (ident.housing === null) {
      log('warn', 'No housing infos available, deleting "housing" property')
      delete ident.housing
    }
    // Due to "Mes papiers" needs, we have to update the metadata to add the "RFR" value found during pdfs parsing.
    await updateMetadata(files, ident.tax_informations)
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
  if ($.html().includes("postMessage('ctx,BLOCAGE'")) {
    log('error', 'Account seems blocked')
    throw new Error('USER_ACTION_NEEDED')
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
  const $ = await request(`${baseUrl}/enp/documents.do?n=0`)
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
    const $year = await request(`${baseUrl}/enp/documents.do?n=${year}`)

    const tmpDocs = Array.from(
      $year('.documents')
        .find('ul[class="list-unstyled documents"] > li')
        .map((idx, el) => {
          let label = $year(el).find('div.hidden-xs.texte > span').text().trim()
          if (label.length === 0) {
            label = $year(el)
              .find('div[class="visible-xs col-xs-5 texte_docslies"] > span')
              .text()
              .trim()
          }
          if (label.match(/Décla\s/g)) {
            log('debug', 'getting in décla matching condition')
            label = label.replace('Décla', 'Déclaration')
          }
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
          return {
            year,
            label,
            idEnsua,
            filename,
            fileurl:
              `https://cfspart.impots.gouv.fr/enp/Affichage_Document_PDF` +
              `?idEnsua=${idEnsua}`
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
  await request('https://cfspart.impots.gouv.fr/enp/redirectpas.do')
  await sleep(5000) // Need to wait here, if not, maritalStatus is not available
  let $ = await request('https://cfspart.impots.gouv.fr/tremisu/accueil.html')
  const result = { contact: {}, tax_informations: {}, housing: {} }

  result.contact.maritalStatus = $('#libelle-sit-fam').text().trim()
  result.contact.numberOfDependants = Number(
    $('.p-nb-pac').text().split(':').pop().trim()
  )
  result.tax_informations = await fetchTaxInfos(files)
  result.housing = await fetchHousingInfos()
  // Not used for identities, but can be useful later
  // result.contact.tauxImposition = parseFloat(
  //   $('#libelle-tx-foyer')
  //     .text()
  //     .replace(',', '.')
  //     .replace('%', '')
  //     .trim()
  // )

  $ = await request('https://cfspart.impots.gouv.fr/enp/chargementprofil.do')

  $ = await request('https://cfspart.impots.gouv.fr/enp/affichageadresse.do')
  const infos = scrape(
    $,
    { key: '.labelInfo', value: '.inputInfo' },
    '.infoPersonnelle > dl > dd'
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
      result.contact.birthplace = info.value
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
  let taxNotices = []
  // We admit that we will refer to the "Avis d'impôt" files to find the real taxInformations
  // So we're looping on each file to only keep the "Avis d'impôt" from each year.
  for (const file of files) {
    if (file.filename.match(/Avis d'impôt/)) {
      taxNotices.push(file)
    }
  }
  for (let i = 0; i < taxNotices.length; i++) {
    let fileId
    try {
      fileId = taxNotices[i].fileDocument._id
    } catch (err) {
      log('error', err)
      log(
        'warn',
        'Impossible to fetch the file, maybe due to disk quota reached'
      )
    }
    const resp = await utils.getPdfText(fileId)
    log('info', 'fetchTaxInfo first year')
    let year = taxNotices[i].fileAttributes.metadata.year
    log('info', 'fetchTaxInfo after first year')
    if (year === undefined) {
      const getYear = taxNotices[i].filename.split('-')
      year = getYear[0]
    }
    try {
      const transform = await findTransform(resp)
      fiscalRefRevenue = transform
    } catch (err) {
      log('info', 'No matching found, continue')
    }
    const firstAJ = resp.text.match(/Déclar\. 1\n\n([0-9]*)\n/)[1]
    let firstBJ = undefined
    if (resp.text.match(/Déclar\. 2\n\n([0-9]*)\n/)) {
      firstBJ = resp.text.match(/Déclar\. 2\n\n([0-9]*)\n/)[1]
    }

    if (firstAJ) {
      if (firstAJ && firstBJ) {
        rawTaxInfos.push({
          filename: taxNotices[i].filename,
          year: parseInt(year),
          declarers: {
            firstAJ,
            firstBJ
          }
        })
      } else {
        log('info', 'no 1BJ line found, saving 1AJ only')
        rawTaxInfos.push({
          filename: taxNotices[i].filename,
          year: parseInt(year),
          declarers: { firstAJ }
        })
      }
    }
    if (fiscalRefRevenue != null) {
      rawTaxInfos.push({
        filename: taxNotices[i].filename,
        year: parseInt(year),
        fiscalRefRevenue: fiscalRefRevenue
      })
    }
  }
  const taxInfos = await formatTaxInfos(rawTaxInfos)
  return taxInfos
}

async function fetchHousingInfos() {
  try {
    let housingInfos = []
    log('debug', 'Getting in fetchHousingInfos')
    const $ = await request(
      'https://cfspart.impots.gouv.fr/gmbi-mapi/accueil/flux.ex?_flowId=accueil-flow'
    )
    // For the following comparison, we need to remove every whitespaces found as the website uses different encoding.
    // Otherwise, the line won't match with the expected result even if it looks the same.
    const haveProperty = $('p[role="heading"] > span > strong')
      .text()
      .replace(/\s+/g, '')
    const compareString = "Aucun bien n'a été trouvé.".replace(/\s+/g, '')
    if (haveProperty === compareString) {
      log('info', 'No properties owned, returning null')
      return null
    }
    const typeElements = Array.from($('span > span[class="type-bien"]'))
    const foundedType = []
    for (const element of typeElements) {
      foundedType.push($(element).text())
    }
    const cityElements = Array.from($('span > span[class="ville"]'))
    const foundedCity = []
    for (const element of cityElements) {
      foundedCity.push($(element).text())
    }
    const addressElements = Array.from($('span[class="adresse"]'))
    const foundedAddress = []
    for (const element of addressElements) {
      foundedAddress.push($(element).text())
    }
    const livingSpaceSizeElements = Array.from(
      $('span[class="bulles-infos"] > span[class="bulle"]:nth-child(1)')
    )
    const foundedLivingspaceSize = []
    for (const element of livingSpaceSizeElements) {
      foundedLivingspaceSize.push($(element).text())
    }
    const uniqEntitySize = []
    for (let i = 0; i < foundedLivingspaceSize.length; i++) {
      uniqEntitySize.push(foundedLivingspaceSize[i])
    }
    for (let i = 0; i < foundedType.length; i++) {
      let housing_type = foundedType[i].trim()
      const housing_type_EN = await housingTypeTraduction(housing_type)
      const cityAndPostcode = foundedCity[i]
        .replace(/\s{1,}/g, '-')
        .replace(/\(|\)/g, '')
        .split('-')
      const cityCap = cityAndPostcode[0]
      const city = cityCap[0] + cityCap.toLowerCase().substring(1)
      const street = foundedAddress[i].trim().toLowerCase()
      const postcode = cityAndPostcode[1]
      const living_space_m2 = parseInt(uniqEntitySize[i], 10)
      housingInfos.push({
        address: {
          formattedAddress: `${street}, ${postcode} ${city}`,
          street,
          postcode,
          city
        },
        housing_type: housing_type_EN,
        living_space_m2
      })
    }
    return housingInfos
  } catch (err) {
    log(
      'warn',
      `An error "${err.message}" prevents housing scraping, aborting step`
    )
  }
}

async function housingTypeTraduction(type) {
  if (type === 'Appartement') {
    return 'apartment'
  }
  if (type === 'Garage') {
    return 'garage'
  }
  if (type === 'Cave, cellier, buanderie...') {
    return 'cellar, laundry ...'
  }
  if (type === 'Maison') {
    return 'house'
  }
  if (type === 'Parking') {
    return 'parking'
  }
  return type.toLowerCase()
}

// findTransfrorm will find top-margin of the cell with wanted string and match the value associated
async function findTransform(resp) {
  log('debug', 'Starting findTransform')
  let matchedAmount
  let compareTransform
  // If true, get the last index of the compareTransform array as it is the top-margin of the cell
  for (let j = 1; j < Object.keys(resp).length; j++) {
    for (let i = 0; i < resp[j].length; i++) {
      const string = resp[j][i].str
      const findTransform = resp[j][i].transform
      if (string === `Revenu fiscal de référence`) {
        compareTransform = findTransform.pop()
      }
    }
    // If true, the value in the cell matching the top-margin found above is saved
    for (let i = 0; i < resp[j].length; i++) {
      const string = resp[j][i].str
      const findTransform = resp[j][i].transform.pop()
      if (findTransform === compareTransform) {
        matchedAmount = parseInt(string, 10)
      }
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
    const foundTaxInfos = {
      year: year,
      // RFR: RFR,
      '1AJ': firstAJ,
      '1BJ': firstBJ,
      net_monthly_income: parseFloat((RFR / 12).toFixed(2)),
      currency: 'EUR',
      files: {
        '1AJ': fileFirstJ,
        '1BJ': fileFirstJ
        // RFR: fileRFR
      }
    }
    // |Mes papiers|
    this.client = CozyClient.fromEnv()
    await this.client.registerPlugin(flag.plugin)
    await this.client.plugins.flags.initializing
    if (flag('mespapiers.migrated.metadata')) {
      foundTaxInfos.refTaxIncome = RFR
      foundTaxInfos.files.refTaxIncome = fileRFR
    } else {
      foundTaxInfos.RFR = RFR
      foundTaxInfos.files.RFR = fileRFR
    }
    // ====
    tax_informations.push(foundTaxInfos)
  }
  return tax_informations
}

async function updateMetadata(files, taxInfos) {
  log('info', 'updating metadata')
  for (const file of files) {
    // Get the RFR on wanted files
    if (file.filename.includes("Avis d'impôt")) {
      // First removing all not "avis d'impots"
      const fileFromCozy = await cozyClient.new
        .collection('io.cozy.files')
        .get(file.fileDocument._id)
      // Only then, removing all file with a RFR already
      if (
        !(
          fileFromCozy.data.metadata.RFR ||
          fileFromCozy.data.metadata.refTaxIncome
        )
      ) {
        const RFRForCurrentYear = findMatchingTaxInfo(
          file.fileAttributes.metadata.year,
          taxInfos
        )
        const newMetadata = {
          ...fileFromCozy.data.metadata
          // RFR: RFRForCurrentYear
        }
        // |Mes papiers|
        if (flag('mespapiers.migrated.metadata')) {
          newMetadata.refTaxIncome = RFRForCurrentYear
        } else {
          newMetadata.RFR = RFRForCurrentYear
        }
        // ====
        await cozyClient.new
          .collection('io.cozy.files')
          .updateMetadataAttribute(file.fileDocument._id, newMetadata)
      }
    }
    // Get the real issueDate of the file
    if (isArbitraryDate(file.fileAttributes.metadata.issueDate)) {
      const foundDate = await findRealIssueDate(file)
      if (foundDate) {
        log('info', 'Found realIssueDate, updating file')
        const fileFromCozy = await cozyClient.new
          .collection('io.cozy.files')
          .get(file.fileDocument._id)

        const newMetadata = {
          ...fileFromCozy.data.metadata,
          issueDate: foundDate,
          datetime: foundDate,
          datetimeLabel: 'issueDate'
        }
        await cozyClient.new
          .collection('io.cozy.files')
          .updateMetadataAttribute(file.fileDocument._id, newMetadata)
        continue
      }
      log('info', 'Nothing to update')
    }
    if (file.filename.includes('taxes foncières')) {
      const paymentLimitDate = await findPaymentLimitDate(file)
      if (paymentLimitDate) {
        log('info', 'Found a paymentLimitDate, updating file')
        const fileFromCozy = await cozyClient.new
          .collection('io.cozy.files')
          .get(file.fileDocument._id)

        const newMetadata = {
          ...fileFromCozy.data.metadata,
          paymentLimitDate
        }
        await cozyClient.new
          .collection('io.cozy.files')
          .updateMetadataAttribute(file.fileDocument._id, newMetadata)
        continue
      }
      log('info', 'Nothing to update')
    }
    if (
      file.filename.match(
        /Avis d'impôt|Avis impôts sur|Déclaration|foncières?|Avis échéancier|Échéancier/g
      )
    ) {
      if (file.filename.includes('réductions')) {
        log('info', 'No taxNumber on this type of documents, jumping it')
        continue
      }
      const fileFromCozy = await cozyClient.new
        .collection('io.cozy.files')
        .get(file.fileDocument._id)
      if (
        !fileFromCozy.data.metadata.taxNumber ||
        fileFromCozy.data.metadata.taxNumber.includes(' ')
      ) {
        const taxNumber = await findTaxNumber(file)
        if (taxNumber) {
          log('info', 'Found realIssueDate, updating file')
          const fileFromCozy = await cozyClient.new
            .collection('io.cozy.files')
            .get(file.fileDocument._id)

          const newMetadata = {
            ...fileFromCozy.data.metadata,
            taxNumber
          }
          await cozyClient.new
            .collection('io.cozy.files')
            .updateMetadataAttribute(file.fileDocument._id, newMetadata)
          continue
        } else {
          log(
            'info',
            'Cannot find taxNumber, can be an unknown case, jumping this file'
          )
          continue
        }
      }
    }
  }
}

function findMatchingTaxInfo(searchedYear, taxInfos) {
  for (const taxInfosForOneYear of taxInfos) {
    if (taxInfosForOneYear.year === searchedYear) {
      // |Mes papiers|
      return taxInfosForOneYear.RFR
        ? taxInfosForOneYear.RFR
        : taxInfosForOneYear.refTaxIncome
      // ====
    }
  }
}

function isArbitraryDate(date) {
  if (date.getDate() === 1 && date.getMonth() === 0) {
    log('debug', 'is arbitrary date')
    return true
  } else {
    log('debug', 'is good date')
    return false
  }
}

async function findRealIssueDate(file) {
  log('debug', 'findRealIssueDate starts')
  const isValidFile = await checkFileName(file.filename)
  if (!isValidFile) {
    log('info', 'File does not contains any date')
    return null
  }
  const fileId = file.fileDocument._id
  let realDate
  const resp = await utils.getPdfText(fileId)
  const foundDates = resp.text.match(
    /(\d{2}\/\d{2}\/\d{4})\n|(Horodatage : )(\d{2}\/\d{2}\/\d{4})/g
  )
  if (foundDates === null) {
    // Log only the 4 firsts words of the filename for unknown case
    log(
      'info',
      `Cannot find any date for ${file.filename
        .split(' ')
        .slice(0, 4)
        .join(' ')}')`
    )
    return null
  } else {
    // Until now, every know case shows the issueDate is always the first in the array if we found some
    foundDates[0].match('Horodatage')
      ? (realDate = foundDates[0].split(': ')[1])
      : (realDate = foundDates[0].replace('\n', ''))
  }
  const [day, month, year] = realDate.split('/')
  return new Date(`${year}-${month}-${day}`)
}

function checkFileName(filename) {
  // Some files did not have any dates so this is done with known case
  // of what's inside the different pdfs, list is subject to additions in the future
  if (filename.match(/Déclaration automatique/)) {
    log('info', 'No dates available on "Déclaration automatique" files')
    return null
  }
  return true
}

async function findPaymentLimitDate(file) {
  log('debug', 'findPaymentLimitDate starts')
  const fileId = file.fileDocument._id
  let limitPaymentDate
  const resp = await utils.getPdfText(fileId)
  const foundDate = resp.text.match(
    /(Date limite de paiement : )(\d{2}\/\d{2}\/\d{4})|(Au plus tard le\n \n)(\d{2}\/\d{2}\/\d{4})/g
  )

  if (foundDate) {
    const dateString = foundDate[0]
    limitPaymentDate = dateString.match('limite de paiement')
      ? dateString.split(' : ')[1]
      : dateString.split(' \n')[1]
    const [day, month, year] = limitPaymentDate.split('/')
    return new Date(`${year}-${month}-${day}`)
  } else {
    log('info', 'No payment limit date found for this file')
    return null
  }
}

async function findTaxNumber(file) {
  log('debug', 'findtaxNumber starts')
  const fileId = file.fileDocument._id
  let taxNumber
  const resp = await utils.getPdfText(fileId)
  const foundTaxNumber = resp.text.match(
    /\d{2} \d{2} \d{3} \d{3} \d{3}\n?|n° fiscal : \d{13}|\n(\d{13} [A-Z]{1})\n/g
  )
  if (foundTaxNumber.length > 1) {
    // Until now, everytime we found more than one number, the first one found is the user's number
    taxNumber = foundTaxNumber[0].replace(/ /g, '')
  } else if (foundTaxNumber[0].includes('fiscal')) {
    taxNumber = foundTaxNumber[0].split(':')[1].trim()
  } else if (foundTaxNumber[0].includes('\n')) {
    taxNumber = foundTaxNumber[0].replace(/\n|( [A-Z]\n)|\s/g, '')
  } else {
    return null
  }
  return taxNumber
}
