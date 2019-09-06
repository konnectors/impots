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
  errors,
  cozyClient,
  utils
} = require('cozy-konnector-libs')

const get = require('lodash/get')
const request = requestFactory({
  // debug: true,
  cheerio: true,
  jar: true,
  json: false
})
const moment = require('moment')
moment.locale('fr')
const sleep = require('util').promisify(global.setTimeout)

const appendMetadata = require('./metadata')
const { getBills } = require('./bills')

const baseUrl = 'https://cfspart.impots.gouv.fr'

module.exports = new BaseKonnector(start)

function shouldReplaceFile(file) {
  return (
    !get(file, 'attributes.metadata.oldSiteMetadata') &&
    !get(file, 'metadata.oldSiteMetadata')
  )
}

async function start(fields) {
  await login(fields)
  let ShouldRemoveOldFiles = false
  let newDocuments
  try {
    newDocuments = await getDocuments()
    newDocuments = appendMetadata(newDocuments)
    ShouldRemoveOldFiles = true
  } catch (e) {
    log('warn', 'Error during new documents collection')
    log('warn', e)
  }

  await getBills(fields.login)
  await saveFiles(newDocuments, fields, {
    sourceAccount: this._account._id,
    sourceAccountIdentifier: fields.login,
    contentType: 'application/pdf'
  })

  if (ShouldRemoveOldFiles) {
    const oldFilesToRemove = await getOldFiles(fields.folderPath)
    if (oldFilesToRemove) {
      await deleteOldFiles(oldFilesToRemove)
    }
  }

  try {
    log('info', 'Fetching identity ...')
    const ident = await fetchIdentity()
    await this.saveIdentity(ident, fields.login)
  } catch (e) {
    log('warn', 'Error during identity scraping or saving')
    log('warn', e)
  }
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

async function getOldFiles(folderPath) {
  log('info', 'Getting list of old files')
  const dir = await cozyClient.files.statByPath(folderPath)
  const files = await utils.queryAll('io.cozy.files', { dir_id: dir._id })
  const oldFiles = files.filter(file => {
    return file.metadata.oldSiteMetadata
  })
  const oldFilesToRemove = oldFiles.filter(file => {
    if (file.name.match(/^201\d-/) || file.name.match(/^2009/)) {
      return true
    }
  })
  return oldFilesToRemove
}

async function deleteOldFiles(files) {
  log('info', 'Deleting old files')
  for (const file of files) {
    cozyClient.files.trashById(file._id)
  }
}

async function getDocuments() {
  log('info', 'Getting documents on new interface')
  let docs = []
  const $ = await request(`${baseUrl}/enp/ensu/documents.do?n=0`)
  const years = Array.from(
    $('.date')
      .find('a')
      .map((idx, el) => {
        const year = $(el).text()
        if (year.match(/^\d{4}$/) === null) {
          throw 'Docs year scraping failed'
        }
        return year
      })
  )
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
          // Replace / and : found in some label
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
  // Prefetch mandatory if we want maritalStatus
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
  // datas extractible here :
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
  const postcode = lastLineAddress.match(/^\d{5}/)[0]
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

/* The website let the user to mistake with or without a leading 0 at french number
 *  We remove it if we detect a french prefix (+33) and a leading 0
 */
function formatPhone(phone) {
  if (phone.match(/^\+33 0/)) {
    log('debug', 'French phone found with leading 0, removing')
    return phone.replace('+33 0', '+33 ')
  } else {
    return phone
  }
}
