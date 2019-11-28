process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://937eb760d70849bea1e72b5ca92c3391:95635578f48d457a9abd3ac5a75aa3b6@sentry.cozycloud.cc/35'

const {
  BaseKonnector,
  requestFactory,
  log,
  scrape,
  errors,
  cozyClient,
  utils
} = require('cozy-konnector-libs')

const request = requestFactory({
  // debug: true,
  cheerio: true,
  jar: true,
  json: false
})

const YEAR_CLEAN_LIMIT = 2017 // the files from old connector will be cleaned until this limit
const moment = require('moment')
moment.locale('fr')
const sleep = require('util').promisify(global.setTimeout)

const { appendMetadata, formatPhone } = require('./metadata')
const { getBills } = require('./bills')

const baseUrl = 'https://cfspart.impots.gouv.fr'
const REMOVE_OLD_FILES_FLAG = true
const keyBy = require('lodash/keyBy')

module.exports = new BaseKonnector(start)

async function start(fields) {
  await login(fields)
  let newDocuments
  try {
    const lastYear = await cleanOldFilesAndBills(
      fields.folderPath,
      YEAR_CLEAN_LIMIT
    )
    newDocuments = await getDocuments(lastYear)
    newDocuments = appendMetadata(newDocuments)
  } catch (e) {
    log('warn', 'Error during new documents collection')
    log('warn', e.message)
  }

  log('info', 'saving all files')
  await this.saveFiles(newDocuments, fields, {
    contentType: 'application/pdf',
    fileIdAttributes: ['idEnsua']
  })
  const bills = await getBills(cleanLogin(fields.login), newDocuments)
  log('info', 'saving all bills')
  await this.saveBills(bills, fields, {
    contentType: 'application/pdf',
    fileIdAttributes: ['idEnsua'],
    linkBankOperations: false
  })

  try {
    log('info', 'Fetching identity ...')
    const ident = await fetchIdentity()
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
  if (login.includes('@')) {
    throw new Error('LOGIN_FAILED.FRANCE_CONNECT_LOGIN')
  }
}

async function login(fields) {
  log('info', 'Logging in')
  validateLogin(fields.login)
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
  } else if ($.html().includes("postMessage('lmdp")) {
    log('error', 'Password seems wrong')
    throw new Error(errors.LOGIN_FAILED)
  } else {
    throw new Error('UNKOWN_LOGIN_STATUS')
  }
}

async function getOldFiles(folderPath, limit) {
  log('info', 'Getting list of old files')
  const dir = await cozyClient.files.statByPath(folderPath)
  const oldFiles = (await utils.queryAll('io.cozy.files', { dir_id: dir._id }))
    .filter(file => file && file.metadata && file.metadata.oldSiteMetadata) // file from the old connector version)
    .map(file => ({
      ...file,
      year: Number(file.metadata.datetime.substring(0, 4))
    }))

  const oldFilesToRemove = oldFiles.filter(file => file.year >= limit)
  const oldFilesRemaining = oldFiles.filter(file => file.year < limit)
  const lastRemainingYear = oldFilesRemaining.reduce(
    (memo, file) => (file.year > memo ? file.year : memo),
    0
  )
  return { oldFilesToRemove, lastRemainingYear }
}

async function cleanOldFilesAndBills(folderPath, limit) {
  const { oldFilesToRemove, lastRemainingYear } = await getOldFiles(
    folderPath,
    limit
  )
  if (oldFilesToRemove.length) {
    const bills = await utils.queryAll('io.cozy.bills', { vendor: 'impot' })
    const billsIndex = keyBy(bills.filter(bill => bill.invoice), bill =>
      bill.invoice.split(':').pop()
    )
    const billsToDelete = oldFilesToRemove
      .map(file => billsIndex[file._id])
      .filter(Boolean)
    if (REMOVE_OLD_FILES_FLAG) {
      log(
        'info',
        `Deleting ${oldFilesToRemove.length} old oldFilesToRemove and ${billsToDelete.length} associated bills`
      )
      for (const file of oldFilesToRemove) {
        try {
          await cozyClient.files.trashById(file._id)
        } catch (err) {
          log('warn', err.message)
        }
      }
      await utils.batchDelete('io.cozy.bills', billsToDelete)
    } else {
      log(
        'info',
        `Would remove ${oldFilesToRemove.length} old oldFilesToRemove and ${billsToDelete.length} associated bills`
      )
    }
  }
  return lastRemainingYear
}

async function getDocuments(lastYear) {
  log('info', 'Getting documents on new interface')
  let docs = []
  const $ = await request(`${baseUrl}/enp/ensu/documents.do?n=0`)
  let years = Array.from(
    $('.date')
      .find('a')
      .map((idx, el) => {
        const year = $(el).text()
        if (year.match(/^\d{4}$/) === null) {
          throw 'Docs year scraping failed'
        }
        return Number(year)
      })
  )

  if (lastYear) {
    log(
      'info',
      `Ignoring years before ${lastYear + 1}. There are old files before`
    )
    years = years.filter(y => y > lastYear)
  }
  log('debug', `Docs available for years ${years}`)
  for (const year of years) {
    const $year = await request(`${baseUrl}/enp/ensu/documents.do?n=${year}`)
    const tmpDocs = Array.from(
      $year('.documents')
        .find('div .document')
        .map((idx, el) => {
          const label = $year(el)
            .find('div .texte')
            .text()
            .trim()
          const idEnsua = $year(el)
            .find('input')
            .attr('value')
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
              `https://cfspart.impots.gouv.fr/enp/ensu/Affichage_Document_PDF` +
              `?idEnsua=${idEnsua}`
          }
        })
    )
    log('info', `${tmpDocs.length} docs found for year ${year}`)
    docs = docs.concat(tmpDocs)
  }
  return docs
}

async function fetchIdentity() {
  // Prefetch is mandatory if we want maritalStatus
  await request('https://cfspart.impots.gouv.fr/enp/ensu/redirectpas.do')
  await sleep(5000) // Need to wait here, if not, maritalStatus is not available
  let $ = await request('https://cfspart.impots.gouv.fr/tremisu/accueil.html')
  const result = {}

  result.maritalStatus = $('#libelle-sit-fam')
    .text()
    .trim()
  result.numberOfDependants = Number(
    $('.p-nb-pac')
      .text()
      .split(':')
      .pop()
      .trim()
  )
  // Not used for identities, but can be useful later
  // result.tauxImposition = parseFloat(
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
  const formattedAddress = $('.infoPersonnelle ul li')
    .eq(7)
    .find('.inputInfo span')
    .html()
    .replace('<br>', '\n')

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
  result.maritalStatus = maritalStatusTable[result.maritalStatus]
  result.address = [{ formattedAddress, street, postcode, city }]

  for (const info of infos) {
    if (info.key === 'Prénom') {
      result.name = { givenName: info.value }
    } else if (info.key === 'Nom') {
      result.name.familyName = info.value
    } else if (info.key === 'Date de naissance') {
      result.birthday = moment(info.value, 'DD MMMM YYYY', 'fr').format(
        'YYYY-MM-DD'
      )
    } else if (info.key === 'Lieu de naissance') {
      result.birthPlace = info.value
    } else if (info.key === 'Adresse électronique validée') {
      result.email = [{ address: info.value }]
    } else if (info.key === 'Téléphone portable') {
      if (info.value != '') {
        if (result.phone) {
          result.phone.push({ type: 'mobile', number: formatPhone(info.value) })
        } else {
          result.phone = [{ type: 'mobile', number: formatPhone(info.value) }]
        }
      }
    } else if (info.key === 'Téléphone fixe') {
      if (info.value != '') {
        if (result.phone) {
          result.phone.push({ type: 'home', number: formatPhone(info.value) })
        } else {
          result.phone = [{ type: 'home', number: formatPhone(info.value) }]
        }
      }
    }
  }
  return result
}
