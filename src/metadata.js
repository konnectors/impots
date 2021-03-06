const { log } = require('cozy-konnector-libs')
const moment = require('moment')

module.exports = {
  appendMetadata,
  evalSubject,
  evalClassification,
  evalDate,
  evalSubClassification,
  formatPhone
}

function appendMetadata(docs) {
  for (let doc of docs) {
    let metadata = {
      contentAuthor: 'impots.gouv',
      year: doc.year,
      idEnsua: doc.idEnsua,
      classification: evalClassification(doc.label),
      subClassification: evalSubClassification(doc.label),
      subjects: [evalSubject(doc.label)],
      datetimeLabel: 'issueDate',
      originalLabel: doc.label
    }

    const proposedAddress = doc.label.includes(' - ')
      ? doc.label.split(' - ').pop()
      : false
    if (proposedAddress && !proposedAddress.includes('prélèvements sociaux'))
      metadata.address = proposedAddress
    ;(metadata.datetime =
      evalDate(
        doc.label,
        metadata.classification,
        metadata.subjects,
        metadata.year
      ) || moment(`${doc.year}-01-01T12:00:00`).toDate()),
      (metadata.issueDate =
        evalDate(
          doc.label,
          metadata.classification,
          metadata.subjects,
          metadata.year
        ) || moment(`${doc.year}-01-01T12:00:00`).toDate()),
      delete doc.year
    delete doc.label
    doc.fileAttributes = { metadata }
  }
  return docs
}

function evalSubject(label) {
  if (label.match(/revenus/)) {
    return 'income'
  } else if (label.match(/habitation/)) {
    return 'residence'
  } else if (label.match(/foncières/)) {
    return 'property'
  } else {
    // log('debug', label)
    log('warn', 'Impossible to evalute Subject metadata for one doc')
    return undefined
  }
}

function evalClassification(label) {
  if (label.match(/Avis/)) {
    return 'tax_notice'
  } else if (label.match(/^Déclaration/)) {
    return 'tax_return'
  } else if (label.match(/^Accusé de réception/)) {
    return 'mail'
  } else {
    log('warn', 'Impossible to evalute Classification metadata for one doc')
    return undefined
  }
}

// Try to evaluate a date from label, then apply preconstruct date to 'Avis' or return false
function evalDate(label, classification, subjects, year) {
  if (label.match(/\(.*\)$/)) {
    const date = label.match(/(\d{1,2})\/(\d{2})\/(\d{4})/)
    const time = label.match(/(\d{1,2}):(\d{2})/)
    return moment(
      `${date[3]}-${date[2]}-${date[1]}T${time[1]}:${time[2]}:00`
    ).toDate()
  } else if (classification === 'tax_notice') {
    if (subjects[0] === 'income') {
      return moment(`${year}-09-01T12:00:00`).toDate()
    } else if (subjects[0] === 'residence') {
      return moment(`${year}-09-15T12:00:00`).toDate()
    } else if (subjects[0] === 'property') {
      return moment(`${year}-10-15T12:00:00`).toDate()
    }
  } else {
    return false
  }
}

function evalSubClassification(label) {
  if (label.match(/échéancier/)) {
    return 'payment_schedule'
  } else if (label.match(/^Avis d'impôt \d{4} sur les revenus/)) {
    // Probably need to add a main_notice match for 'Fonciere' and 'Habitation'
    return 'main_notice'
  } else {
    return undefined
  }
}

/* The website let the user do mistake with or without a leading 0 at french number
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
