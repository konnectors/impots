const normalizeFileNames = require('./fileNamer')

describe('File normalizer', () => {
  it('should normalize nominal files', () => {
    const input = [
      'https://cfspart.impots.gouv.fr/cfsu-01/consultation/ConsultationDocument/IR-Avis-ASDIR-2016-XXX.pdf?Action=ConsultPDF&annee=2016&typeDoc=7&typeImpot=1&numeroAdonis=XXX&pph=XXX&typeForm=1ASDIR&numCompteCom=&cdDoc=7-1-1ASDIR&file=.pdf',
      'https://cfspart.impots.gouv.fr/cfsu-01/consultation/ConsultationDocument/TH-Avis-PrimTIP-2017-XXX.pdf?Action=ConsultPDF&annee=2017&typeDoc=2&typeImpot=3&numeroAdonis=XXX&pph=XXX&typeForm=1TIP&numCompteCom=&cdDoc=2-3-1TIP&file=.pdf'
    ]
    const documentsInput = input.map(fileurl => ({ fileurl }))

    const output = [
      '2016-ImpotsRevenus-Avis-SituationDéclarative-XXX.pdf',
      '2017-TaxeHabitation-Avis-XXX.pdf'
    ]

    expect(normalizeFileNames(documentsInput).map(doc => doc.filename)).toEqual(
      output
    )
  })
})
