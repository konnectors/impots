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

  it('should generate proper file metadata for "Avis Primitif Impots sur le revenu"', () => {
    const input = [
      {
        fileurl:
          'https://cfspart.impots.gouv.fr/cfsu-03/consultation/ConsultationDocument/IR-Avis-PrimMEN-2014-xxx.pdf?Action=ConsultPDF&annee=2014&typeDoc=2&typeImpot=1&numeroAdonis=xxx&pph=xxx&typeForm=1MEN&numCompteCom=&cdDoc=2-1-1MEN&file=.pdf'
      }
    ]

    const output = [
      {
        classification: 'tax_notice',
        datetime: new Date('2014-09-01T10:00:00.000Z'),
        datetimeLabel: 'issueDate',
        contentAuthor: 'impots.gouv',
        subjects: ['income'],
        issueDate: new Date('2014-09-01T10:00:00.000Z')
      }
    ]

    expect(
      normalizeFileNames(input)
        .map(doc => doc.fileAttributes && doc.fileAttributes.metadata)
        .filter(Boolean)
    ).toEqual(output)
  })

  it('should generate proper file metadata for "Avis de situation déclarative Impots sur le revenu"', () => {
    const input = [
      {
        fileurl:
          'https://cfspart.impots.gouv.fr/cfsu-08/consultation/ConsultationDocument/IR-Avis-ASDIR-2018-xxx.pdf?Action=ConsultPDF&annee=2018&typeDoc=7&typeImpot=1&numeroAdonis=xxx&pph=xxx&typeForm=1ASDIR&numCompteCom=&cdDoc=7-1-1ASDIR&file=.pdf',
        name: 'Avis de situation d�clarative  - 28/04/2018 � 7h41'
      }
    ]

    const output = [
      {
        classification: 'tax_notice',
        datetime: new Date('2018-04-27T22:00:00.000Z'),
        datetimeLabel: 'issueDate',
        contentAuthor: 'impots.gouv',
        subjects: ['income'],
        issueDate: new Date('2018-04-27T22:00:00.000Z')
      }
    ]

    expect(
      normalizeFileNames(input)
        .map(doc => doc.fileAttributes && doc.fileAttributes.metadata)
        .filter(Boolean)
    ).toEqual(output)
  })

  it('should generate proper file metadata for "Avis primitif taxe habitation"', () => {
    const input = [
      {
        fileurl:
          'https://cfspart.impots.gouv.fr/cfsu-08/consultation/ConsultationDocument/TH-Avis-PrimMEN-2016-xxx.pdf?Action=ConsultPDF&annee=2016&typeDoc=2&typeImpot=3&numeroAdonis=xxx&pph=xxx&typeForm=1MEN&numCompteCom=&cdDoc=2-3-1MEN&file=.pdf',
        name: "Taxe d'habitation - xxxx (78)Avis primitif"
      }
    ]

    const output = [
      {
        classification: 'tax_notice',
        datetime: new Date('2016-09-15T10:00:00.000Z'),
        datetimeLabel: 'issueDate',
        contentAuthor: 'impots.gouv',
        subjects: ['residence'],
        issueDate: new Date('2016-09-15T10:00:00.000Z')
      }
    ]

    expect(
      normalizeFileNames(input)
        .map(doc => doc.fileAttributes && doc.fileAttributes.metadata)
        .filter(Boolean)
    ).toEqual(output)
  })

  it('should generate proper file metadata for "Avis simple taxe habitation"', () => {
    const input = [
      {
        fileurl:
          'https://cfspart.impots.gouv.fr/cfsu-02/consultation/ConsultationDocument/TH-Avis-PrimTIP-2016-xxx.pdf?Action=ConsultPDF&annee=2016&typeDoc=2&typeImpot=3&numeroAdonis=xxx&pph=xxx&typeForm=1TIP&numCompteCom=&cdDoc=2-3-1TIP&file=.pdf',
        date: new Date('2017-02-05T23:00:00.000Z')
      }
    ]

    const output = [
      {
        classification: 'tax_notice',
        datetime: new Date('2017-02-05T23:00:00.000Z'),
        datetimeLabel: 'issueDate',
        contentAuthor: 'impots.gouv',
        subjects: ['residence'],
        issueDate: new Date('2017-02-05T23:00:00.000Z')
      }
    ]

    expect(
      normalizeFileNames(input)
        .map(doc => doc.fileAttributes && doc.fileAttributes.metadata)
        .filter(Boolean)
    ).toEqual(output)
  })

  it('should generate proper file metadata for "Avis taxe foncière"', () => {
    const input = [
      {
        fileurl:
          'https://cfspart.impots.gouv.fr/cfsu-08/consultation/ConsultationDocument/TF-Avis-Suite-2018-xxx.pdf?Action=ConsultPDF&annee=2018&typeDoc=2&typeImpot=2&numeroAdonis=xxx&pph=xxx&typeForm=4&numCompteCom=&cdDoc=2-2-4&file=.pdf'
      }
    ]

    const output = [
      {
        classification: 'tax_notice',
        datetime: new Date('2018-10-15T10:00:00.000Z'),
        datetimeLabel: 'issueDate',
        contentAuthor: 'impots.gouv',
        subjects: ['property'],
        issueDate: new Date('2018-10-15T10:00:00.000Z')
      }
    ]

    expect(
      normalizeFileNames(input)
        .map(doc => doc.fileAttributes && doc.fileAttributes.metadata)
        .filter(Boolean)
    ).toEqual(output)
  })

  it('should generate proper file metadata for "Accusé de réception"', () => {
    const input = [
      {
        fileurl:
          'https://cfspart.impots.gouv.fr/cfsu-05/consultation/ConsultationDocument/IR-AR-2019-xxx.pdf?Action=ConsultPDF&annee=2019&typeDoc=4&typeImpot=1&numeroAdonis=xxx&pph=xxx&typeForm=AR&numCompteCom=&cdDoc=4-1-AR&file=.pdf',
        name:
          'D�claration 2042 - d�clar�e en ligne le 09/05/2019 � 21h49Accus� de r�ception n� xxxD�claration 2042 RICI - d�clar�e en ligne le 09/05/2019 � 21h49'
      }
    ]

    const output = [
      {
        classification: 'mail',
        datetime: new Date('2019-05-08T22:00:00.000Z'),
        datetimeLabel: 'issueDate',
        contentAuthor: 'impots.gouv',
        issueDate: new Date('2019-05-08T22:00:00.000Z')
      }
    ]

    expect(
      normalizeFileNames(input)
        .map(doc => doc.fileAttributes && doc.fileAttributes.metadata)
        .filter(Boolean)
    ).toEqual(output)
  })

  it('should generate proper file metadata for "Echeancier"', () => {
    const input = [
      {
        fileurl:
          'https://cfspart.impots.gouv.fr/cfsu-05/consultation/ConsultationDocument/TH-Avis-Echeancier-2018-xxx.pdf?Action=ConsultPDF&annee=2018&typeDoc=2&typeImpot=3&numeroAdonis=xxx&pph=xxx&typeForm=71&numCompteCom=&cdDoc=2-3-71&file=.pdf',
        name: "Taxe d'habitation Ech�ancier N� xxx"
      }
    ]

    const output = [
      {
        classification: 'tax_notice',
        subClassification: 'payment_schedule',
        datetime: new Date('2018-09-15T10:00:00.000Z'),
        datetimeLabel: 'issueDate',
        contentAuthor: 'impots.gouv',
        subjects: ['residence'],
        issueDate: new Date('2018-09-15T10:00:00.000Z')
      }
    ]

    expect(
      normalizeFileNames(input)
        .map(doc => doc.fileAttributes && doc.fileAttributes.metadata)
        .filter(Boolean)
    ).toEqual(output)
  })

  it('should generate proper file metadata for "RedevanceAudiovisuelle"', () => {
    const input = [
      {
        fileurl:
          'https://cfspart.impots.gouv.fr/cfsu-01/consultation/ConsultationDocument/TV-Avis-Degrevement-2018-xxx.pdf?Action=ConsultPDF&annee=2018&typeDoc=2&typeImpot=5&numeroAdonis=xxx&pph=xxx&typeForm=3&numCompteCom=&cdDoc=2-5-3&file=.pdf',
        name:
          "Taxe d'habitation - xxx (75)Avis de d�gr�vement(Contribution � l'audiovisuel public)Avis primitif"
      }
    ]

    const output = [
      {
        classification: 'tax_notice',
        datetime: new Date('2018-01-01T11:00:00.000Z'),
        datetimeLabel: 'issueDate',
        contentAuthor: 'impots.gouv',
        subjects: ['audiovisual'],
        issueDate: new Date('2018-01-01T11:00:00.000Z')
      }
    ]

    expect(
      normalizeFileNames(input)
        .map(doc => doc.fileAttributes && doc.fileAttributes.metadata)
        .filter(Boolean)
    ).toEqual(output)
  })

  it('should generate proper file metadata for "Special form"', () => {
    const input = [
      {
        fileurl:
          'https://cfspart.impots.gouv.fr/cfsu-04/consultation/ConsultationDocument/IR-Form_papier-2042-2012-xxx.pdf?Action=ConsultPDF&annee=2011&typeDoc=5&typeImpot=1&numeroAdonis=xxx&pph=xxx&typeForm=2042&base=&cdDoc=5-1-2042&numCompteCom=&file=.pdf',
        name: 'D�claration 2042'
      }
    ]

    const output = [
      {
        classification: 'tax_return',
        datetime: new Date('2011-01-01T11:00:00.000Z'),
        datetimeLabel: 'issueDate',
        contentAuthor: 'impots.gouv',
        subjects: ['income'],
        formReference: '2042',
        issueDate: new Date('2011-01-01T11:00:00.000Z')
      }
    ]

    expect(
      normalizeFileNames(input)
        .map(doc => doc.fileAttributes && doc.fileAttributes.metadata)
        .filter(Boolean)
    ).toEqual(output)
  })
})
