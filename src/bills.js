const { requestFactory, log, errors } = require('cozy-konnector-libs')
const get = require('lodash/get')
const orderBy = require('lodash/orderBy')
const round = require('lodash/round')
const levenshtein = require('fast-levenshtein')
// const fs = require('fs')
const request = requestFactory({
  // debug: true,
  cheerio: true,
  jar: true,
  json: false
})
const requestNoCheerio = requestFactory({
  cheerio: false,
  jar: true,
  json: false
})

module.exports = {
  getBills,
  extractBills,
  extractDetails,
  parseType,
  ReconcilIiateBillsWithFiles
}

async function getBills(login, entries) {
  let cfsuUrl
  log('info', 'fetching payments')
  await request({
    url: 'https://cfspart.impots.gouv.fr/enp/ensu/interpaiements.do'
  })
  await request({
    url: 'https://cfspart.impots.gouv.fr/enp/ensu/paiementimpots.do'
  })
  try {
    await requestNoCheerio({
      url: `https://cfspart.impots.gouv.fr/acces-usager/ensu/compteENSU.html`,
      method: 'GET',
      qs: {
        spi: login
      },
      followRedirect: false,
      followAllRedirects: false
    })
  } catch (e) {
    if (e.statusCode === 404) {
      log('error', e.message)
      throw new Error(errors.VENDOR_DOWN)
    } else if (e.statusCode === 302) {
      // Expect cookie setting and catching an url like :
      //   https://cfspart.impots.gouv.fr/cfsu-XX/compteENSU.html?spi=05050505050
      cfsuUrl = e.response.headers.location
    } else {
      throw e
    }
  }
  cfsuUrl = cfsuUrl.split('?')[0]
  const $firstForm = await request({
    headers: {
      // Force user agent here to avoid error 500 on request
      'User-Agent':
        'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:62.0) Gecko/20100101 Firefox/62.0'
    },
    url: cfsuUrl,
    method: 'GET',
    qs: {
      spi: login
    }
  })
  const CSRFToken = $firstForm('input[name="CSRFTOKEN"]').attr('value')
  // log('debug', `CSRFTOKEN is ${CSRFToken}`)
  const formLink = $firstForm('form[name="compteENSUForm"]').attr('action')

  if (!formLink) {
    log('warn', `Found no payment`)
    return []
  }
  // log('debug', `Form Url is ${formLink}`)
  const $fullForm = await request({
    url: `https://cfspart.impots.gouv.fr${formLink}`,
    method: 'POST',
    form: {
      CSRFTOKEN: CSRFToken,
      date: 'gardeDate',
      typeImpot: 'toutImpot',
      tresorerieCodee: 'toutesTresoreries',
      annee: 'all',
      compte: 'compteDetaille'
    }
  })
  log('info', 'Reconciliation of bills with files...')
  const bills = ReconcilIiateBillsWithFiles(extractBills($fullForm), entries)

  return bills
}

function ReconcilIiateBillsWithFiles(bills, entries) {
  const matchedBills = []
  const notMatchedBills = []
  const entriesIndex = entries
    .filter(
      entry =>
        get(entry, 'fileAttributes.metadata.classification') === 'tax_notice'
    )
    .reduce((memo, entry) => {
      const subjects = get(entry, 'fileAttributes.metadata.subjects', [])
      for (const subject of subjects) {
        const year = get(entry, 'fileAttributes.metadata.year')
        const key = `${year}-${subject}`
        if (!memo[key]) memo[key] = []
        memo[key].push(entry)
      }
      return memo
    }, {})

  for (const bill of bills) {
    let billEntries = entriesIndex[bill.year - 1 + '-' + bill.type] || []
    const month = new Date(bill.date).getMonth() + 1
    const currentYearEntries = entriesIndex[bill.year + '-' + bill.type]
    if (
      currentYearEntries &&
      currentYearEntries.length &&
      (!bill.isMonthly || month > 9)
    ) {
      billEntries = billEntries.concat(currentYearEntries)
    }

    // add levenshtein from bill address to entries addresses if any
    billEntries = billEntries.map(entry => {
      const entryAddress = get(entry, 'fileAttributes.metadata.address')
      if (!entryAddress || !bill.address) {
        return entry
      }
      return {
        ...entry,
        addressDistance: levenshtein.get(bill.address, entryAddress)
      }
    })

    billEntries = sortCandidates(billEntries)

    if (billEntries.length) {
      Object.assign(billEntries[0], {
        amount: bill.amount,
        date: new Date(bill.date + 'T12:00:00'),
        vendor: 'impot',
        currency: 'EUR',
        isRefund: bill.isRefund
      })
      matchedBills.push({
        ...billEntries[0],
        amount: bill.amount,
        date: new Date(bill.date),
        vendor: 'impot',
        currency: 'EUR',
        monthly: bills.isMonthly
        // bill,
        // candidates: billEntries
      })
    } else {
      notMatchedBills.push(bill)
    }
  }

  log(
    'info',
    `Bills matching to files success rate : ${round(
      (matchedBills.length / bills.length) * 100,
      2
    )} %`
  )
  const uniqYears = [...new Set(notMatchedBills.map(bill => bill.year))]
  log(
    'info',
    `${
      notMatchedBills.length
    } non matched bills are from years: ${uniqYears.join(', ')}`
  )

  // fs.writeFileSync('matchedBills.json', JSON.stringify(matchedBills, null, 2))
  // fs.writeFileSync('index.json', JSON.stringify(entriesIndex, null, 2))
  // fs.writeFileSync(
  //   'notMatchedBills.json',
  //   JSON.stringify(notMatchedBills, null, 2)
  // )
  // fs.writeFileSync('entries.json', JSON.stringify(entries, null, 2))
  // console.log(JSON.stringify(matchedBills, null, 2))
  return matchedBills
}

function sortCandidates(entries) {
  return orderBy(
    entries,
    [
      'addressDistance',
      'fileAttributes.metadata.issueDate',
      'fileAttributes.metadata.subClassification'
    ],
    ['asc', 'desc', 'asc']
  )
}

function extractBills($) {
  let bills = []
  let currentYear = undefined
  let currentType = undefined
  let currentAddress = undefined
  for (const tr of Array.from($('table.cssFondTableENSU > tbody > tr'))) {
    if (isYearLine($, tr)) {
      currentYear = $(tr)
        .find('td')
        .text()
        .trim()
    } else if (isTypeLine($, tr)) {
      currentType = parseType(
        $(tr)
          .find('span.cssImpotENSU')
          .text()
          .trim()
      )
      currentAddress = parseAddress(
        $(tr)
          .find('> td:nth-child(2)')
          .html()
      )
    } else if (isDetailsLine($, tr) && currentType) {
      bills = bills.concat(
        extractDetails($, tr, currentYear, currentType, currentAddress)
      )
    }
  }
  return bills
}

function isDetailsLine($, tr) {
  return $(tr).find('td .cssTableInterneENSU').length
}

function isYearLine($, tr) {
  return $(tr).find('td.cssFondAnneeENSU').length
}

function isTypeLine($, tr) {
  return $(tr).find('td.cssLigneImpotENSU').length
}

function extractDetails($, trMain, year, type, address) {
  let bills = []
  for (const tr of Array.from($(trMain).find('tr'))) {
    // if has 3 cell and third cell contains €, it's a bill line
    if (
      $(tr).find('td').length === 3 &&
      $(tr)
        .find('td')
        .eq(2)
        .html()
        .includes('&#x20AC')
    ) {
      let date = parseDate(
        $(tr)
          .find('td')
          .eq(0)
          .html()
      )

      if (!date) {
        date = getPrelevementDate($, tr)
      }
      if (!date) continue
      const isMonthly = isMonthlyPayment(
        $(tr)
          .find('td')
          .eq(0)
          .html()
      )
      const amount = parseAmount(
        $(tr)
          .find('td')
          .eq(2)
          .html()
      )
      bills.push({
        year,
        type,
        date,
        amount,
        isMonthly,
        currency: 'EUR',
        ...{ address }
      })
    } else if (
      $(tr)
        .text()
        .includes('Remboursement')
    ) {
      const parsed = $(tr)
        .text()
        .match(/Remboursement d'exc�dent de (.*)\s€./)
      // the website does not give us information about reimbursement date (year excepted)
      // we try to guess it according to the type of document
      const typeToMonth = {
        income: '07',
        residence: '11',
        property: '11'
      }

      if (parsed && typeToMonth[type]) {
        bills.push({
          amount: parseFloat(parsed.slice(1)),
          year,
          type,
          date: `${year}-${typeToMonth[type]}-01`,
          currency: 'EUR',
          isRefund: true,
          ...{ address }
        })
      }
    }
  }

  return bills
}

function parseAmount(string) {
  return parseInt(
    string
      .trim()
      .replace('&#xA0;&#x20AC;', '') // Remove end of line (nbsp+€)
      .replace(/&#xFFFD;/g, '') // Separator between 3 digits groups
      .replace(/&#xA0;/g, '')
  )
}

function parseDate(str) {
  const match = str.trim().match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (!match) return false
  return `${match[3]}-${match[2]}-${match[1]}`
}

function getPrelevementDate($, tr) {
  const str = $(tr)
    .next('tr')
    .text()

  const match = str.trim().match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (!match) return false
  return `${match[3]}-${match[2]}-${match[1]}`
}

function isMonthlyPayment(str) {
  return str.includes('mensuel')
}

function parseType(strType) {
  const matchers = {
    income: /^Imp�t .* sur les revenus de .*$/,
    residence: /^Taxe d'habitation$/,
    property: /^Taxes fonci�res$/
  }

  for (const subject in matchers) {
    if (strType.trim().match(matchers[subject])) {
      return subject
    }
  }

  log('warn', `unknown bill type`)
  return false
}

function parseAddress(label) {
  return label
    .replace(/<br>/g, ',')
    .split('\n')
    .map(line => line.trim())
    .join('')
    .trim()
}
