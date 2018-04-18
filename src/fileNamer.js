const { log } = require('cozy-konnector-libs')
const querystring = require('querystring')

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

function normalizeFileNames(documents) {
  return documents.map(doc => {
    log('info', doc.fileurl)
    const {
      typeForm,
      annee,
      numeroAdonis,
      typeDoc,
      typeImpot
    } = querystring.parse(doc.fileurl)
    doc.filename = `${annee}${mapValue(categoryMap, typeImpot)}${mapValue(
      documentTypeMap,
      typeDoc
    )}${mapValue(formTypeMap, typeForm)}-${numeroAdonis}.pdf`
    return doc
  })
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
