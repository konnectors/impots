const { log } = require('cozy-konnector-libs')
const moment = require('moment')

module.exports = parseBills

function parseBills($, urlPrefix, baseUrl) {
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
      let bill = scrapeLine($line, masterBillLink, urlPrefix, 3, baseUrl)
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
      let bill = scrapeLine($line, masterBillLink, urlPrefix, 5, baseUrl)
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
        currentYear,
        baseUrl
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

function scrapeLine($line, masterBillLink, urlPrefix, model, baseUrl) {
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

function scrapeRefundLine($line, masterBillLink, urlPrefix, year, baseUrl) {
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
