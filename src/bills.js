const { requestFactory, log } = require('cozy-konnector-libs')
const request = requestFactory({
  //debug: true,
  cheerio: true,
  jar: true,
  json: false
})
const requestNoCheerio = requestFactory({
  cheerio: false,
  jar: true,
  json: false
})

module.exports = { getBills }

async function getBills(login) {
  let cfsuUrl
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
    if (e.statusCode === 302) {
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
  log('debug', `CSRFTOKEN is ${CSRFToken}`)
  const formLink = $firstForm('form[name="compteENSUForm"]').attr('action')
  log('debug', `Form Url is ${formLink}`)
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
  const bills = extractBills($fullForm)
  return bills
}

function extractBills($) {
  let bills = []
  let currentYear = undefined
  let currentType = undefined
  for (const tr of Array.from(
    $('table[class="cssFondTableENSU"] > tbody > tr')
  )) {
    if ($(tr).has('td[class="cssFondAnneeENSU"]').length > 0) {
      // It's a year line
      currentYear = $(tr)
        .find('td')
        .html()
    } else if ($(tr).has('td[class="cssLigneImpotENSU"]').length > 0) {
      // It's a type line
      currentType = $(tr)
        .find('span[class="cssImpotENSU"]')
        .html()
    } else if ($(tr).has('table[class="cssTableInternetENSU"]')) {
      // It's a line with a table 'details'
      bills = bills.concat(extractDetails($, tr, currentYear, currentType))
    }
  }
  return bills
}

function extractDetails($, trMain, year, type) {
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
      const date = parseDate(
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
        currency: 'EUR'
      })
    }
  }
  return bills
}

function parseAmount(string) {
  return parseInt(
    string
      .replace('&#xA0;&#x20AC;', '') // Remove end of line (nbsp+€)
      .replace(/&#xFFFD;/g, '') //Separator between 3 digits groups
  )
}

function parseDate(string) {
  const match = string.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return `${match[3]}-${match[2]}-${match[1]}`
}
