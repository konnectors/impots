const { log } = require('cozy-konnector-libs')
const querystring = require('querystring')
const moment = require('moment')

// normalize the impots file names with the following format
// "year-category-docType-formType-adonisNumber.pdf"
// ex: 2016-ImpotsRevenus-Avis-SituationDéclarative-3938943793797.pdf
module.exports = normalizeFileNames

const categoryMap = {
  '1': 'ImpotsRevenus',
  '2': 'TaxeFoncière',
  '3': 'TaxeHabitation',
  '5': 'RedevanceAudiovisuelle'
}

const documentTypeMap = {
  '1': 'Formulaire',
  '2': 'Avis',
  '4': 'AccuséRéception',
  '5': 'Formulaire',
  '7': 'Avis'
}

const formTypeMap = {
  '2': 'Correctif',
  '4': 'Suite',
  '71': 'Echeancier',
  AR: false,
  '1MEN': 'Primitif',
  '1ASDIR': 'SituationDéclarative',
  '1TIP': false
}

function getNameDate(doc) {
  if (doc.date) return doc.date
  if (doc.name) {
    let nameDate = doc.name.match(/^.*(\d\d\/\d\d\/\d\d\d\d).*$/)
    if (nameDate) {
      return moment(nameDate.slice(1).pop(), 'DD/MM/YYYY').toDate()
    }
  }
  return false
}

function normalizeFileNames(documents) {
  return documents.map(doc => {
    if (doc.fileurl) {
      log('info', doc.fileurl)
      const {
        typeForm,
        annee,
        numeroAdonis,
        typeDoc,
        typeImpot
      } = querystring.parse(doc.fileurl)
      const category = mapValue(categoryMap, typeImpot)
      const typeFormLabel = mapValue(formTypeMap, typeForm)
      const documentTypeLabel = mapValue(documentTypeMap, typeDoc)
      doc.filename = `${annee}${category}${documentTypeLabel}${typeFormLabel}-${numeroAdonis}.pdf`

      if (documentTypeLabel === '-Avis') {
        const subject = getDocSubject(category)
        const subClassification =
          typeFormLabel === '-Echeancier' ? 'payment_schedule' : undefined
        const dayMap = {
          ImpotsRevenus: '09-01',
          TaxeFoncière: '10-15',
          TaxeHabitation: '09-15'
        }
        const day = dayMap[category.slice(1)] || '01-01'
        let date =
          getNameDate(doc) || moment(`${annee}-${day}T12:00:00`).toDate()
        if (!moment(date).isValid()) {
          log('warn', `Could not find a date`)
          return doc
        }
        if (!subject) {
          log('warn', `Could not find a subject`)
          return doc
        }

        doc.fileAttributes = {
          metadata: {
            classification: 'tax_notice',
            subClassification,
            datetime: date,
            datetimeLabel: 'issueDate',
            contentAuthor: 'impots.gouv',
            subject: [subject],
            issueDate: date
          }
        }
      } else if (documentTypeLabel === '-Formulaire') {
        const subject = getDocSubject(category)
        if (subject) {
          doc.fileAttributes = {
            metadata: {
              classification: 'tax_return',
              datetime:
                getNameDate(doc) || moment(`${annee}-01-01T12:00:00`).toDate(),
              datetimeLabel: 'issueDate',
              contentAuthor: 'impots.gouv',
              subject: [subject],
              formReference: typeFormLabel.slice(1),
              issueDate:
                getNameDate(doc) || moment(`${annee}-01-01T12:00:00`).toDate()
            }
          }
        }
      } else if (documentTypeLabel.slice(1) === 'AccuséRéception') {
        doc.fileAttributes = {
          metadata: {
            classification: 'mail',
            datetime:
              getNameDate(doc) || moment(`${annee}-01-01T12:00:00`).toDate(),
            datetimeLabel: 'issueDate',
            contentAuthor: 'impots.gouv',
            issueDate:
              getNameDate(doc) || moment(`${annee}-01-01T12:00:00`).toDate()
          }
        }
      }
    }

    return doc
  })
}

function getDocSubject(category) {
  const subjectMap = {
    ImpotsRevenus: 'income',
    TaxeFoncière: 'property',
    TaxeHabitation: 'residence',
    RedevanceAudiovisuelle: 'audiovisual'
  }

  return subjectMap[category.slice(1)]
}

function mapValue(map, value) {
  if (map[value] === undefined) {
    log(
      'info',
      `${value} has no associated value in ${JSON.stringify(Object.keys(map))}`
    )
    return `-${value}`
  } else if (map[value] === false) {
    return ''
  } else {
    return `-${map[value]}`
  }
}
