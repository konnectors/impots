const cheerio = require('cheerio')
const {
  extractDetails,
  parseType,
  extractBills,
  ReconcilIiateBillsWithFiles
} = require('./bills')
const fs = require('fs')
const path = require('path')
describe('Bills', () => {
  describe('extractDetails', () => {
    it('should extract a nominal bill', () => {
      const html = `<html>
 <head>
 </head>
 <body>
  <table class="cssTableInterneENSU">
   <tbody>
    <tr>
     <td width="50%" class="cssEnteteTableInterneENSU"> Détail </td> <td width="25%" class="cssEnteteTableInterneENSU"> Montant dû </td>
     <td width="25%" class="cssEnteteTableInterneENSU"> Montant réglé </td>
    </tr>
    <tr>
     <td class="cssFondTextePairRar"> Echéance de mensualisation du 16/09/2019 </td>
     <td align="right" width="98" class="cssFondTextePairRar" valign="middle"> 19 € </td>
     <td valign="middle" width="98" class="cssFondTextePairRar"> </td>
    </tr>
    <tr>
     <td class="cssFondTexteImpairRar"> <a href="javascript:;" onclick="win = ouvreDocument(&#39;contratENSU.html?method=affichage&amp;id=idM2&amp;idLot=idLot&amp;typeImpot=TH&#39;,340,250)" class="cssLienTable"> Prélèvement mensuel du 16/08/2019 </a> </td>
     <td valign="middle" width="98" class="cssFondTexteImpairRar"> </td>
     <td align="right" width="98" class="cssFondTexteImpairRar" valign="middle"> 19 € </td>
    </tr>
    <tr>
      <td colspan="3" style="border-top: 2px solid #ffffff;" class="cssFondTexteImpairRar">
        <span class="droite">Remboursement d'exc�dent de 12&nbsp;€.</span>
      </td>
    </tr>
   </tbody>
  </table>
 </body>
</html>`

      const $ = cheerio.load(html)
      const result = extractDetails($, $('body'), 2019, 'income')
      expect(result).toEqual([
        {
          year: 2019,
          type: 'income',
          date: '2019-08-16',
          amount: 19,
          currency: 'EUR',
          isMonthly: true
        },
        {
          year: 2019,
          type: 'income',
          date: '2019-07-01',
          amount: 12,
          currency: 'EUR',
          isRefund: true
        }
      ])
    })
  })

  describe('parseType', () => {
    it('should parse income bills labels', () => {
      expect(parseType('Imp�t 2018 sur les revenus de 2017')).toEqual('income')
      expect(parseType('Imp�t 2012 sur les revenus de 2011')).toEqual('income')
    })

    it('should parse residence bills labels', () => {
      expect(parseType(`Taxe d'habitation`)).toEqual('residence')
    })

    it('should parse property bills labels', () => {
      expect(parseType(`Taxes fonci�res`)).toEqual('property')
    })

    it('should refuse unknown bills type labels', () => {
      expect(parseType(`test unknown type`)).toBe(false)
    })
  })

  describe('extractBills', () => {
    it('works in nominal general case', () => {
      const html = fs.readFileSync(path.join(__dirname, 'test.html'))
      const $ = cheerio.load(html)
      expect(extractBills($)).toEqual([
        {
          year: '2019',
          type: 'residence',
          date: '2019-08-16',
          amount: 116,
          currency: 'EUR',
          address: '2 rue du moulin,VILLE (00)',
          isMonthly: true
        },
        {
          year: '2019',
          type: 'property',
          date: '2019-08-16',
          amount: 105,
          currency: 'EUR',
          address: '2 rue du moulin,VILLE2 (00)',
          isMonthly: true
        }
      ])
    })
  })

  describe('ReconcilIiateBillsWithFiles', () => {
    const entries = [
      {
        filename:
          "2018-2e Avis d'Acompte Provisionnel pour l'impôt 2018 sur les revenus 2017.pdf",
        fileAttributes: {
          metadata: {
            contentAuthor: 'impots.gouv',
            year: 2018,
            classification: 'tax_notice',
            subjects: ['income'],
            datetimeLabel: 'issueDate',
            originalLabel:
              "2e Avis d'Acompte Provisionnel pour l'impôt 2018 sur les revenus 2017",
            datetime: '2018-09-01T10:00:00.000Z',
            issueDate: '2018-09-01T10:00:00.000Z'
          }
        }
      },
      {
        filename:
          "2018-1er Avis d'Acompte Provisionnel pour l'impôt 2018 sur les revenus 2017.pdf",
        fileAttributes: {
          metadata: {
            contentAuthor: 'impots.gouv',
            year: 2018,
            classification: 'tax_notice',
            subjects: ['income'],
            datetimeLabel: 'issueDate',
            originalLabel:
              "1er Avis d'Acompte Provisionnel pour l'impôt 2018 sur les revenus 2017",
            datetime: '2018-09-01T10:00:00.000Z',
            issueDate: '2018-09-01T10:00:00.000Z'
          }
        }
      },
      {
        filename: "2018-Avis d'impôt 2018 sur les revenus 2017.pdf",
        fileAttributes: {
          metadata: {
            contentAuthor: 'impots.gouv',
            year: 2018,
            classification: 'tax_notice',
            subClassification: 'main_notice',
            subjects: ['income'],
            datetimeLabel: 'issueDate',
            originalLabel: "Avis d'impôt 2018 sur les revenus 2017",
            datetime: '2018-09-01T10:00:00.000Z',
            issueDate: '2018-09-01T10:00:00.000Z'
          }
        }
      },
      {
        filename:
          "2018-Avis de situation déclarative à l'impôt 2018 sur les revenus 2017 (le 13-05-2018, à 18h18).pdf",
        fileAttributes: {
          metadata: {
            contentAuthor: 'impots.gouv',
            year: 2018,
            classification: 'tax_notice',
            subjects: ['income'],
            datetimeLabel: 'issueDate',
            originalLabel:
              "Avis de situation déclarative à l'impôt 2018 sur les revenus 2017 (le 13/05/2018, à 18:18)",
            datetime: '2018-05-13T16:18:00.000Z',
            issueDate: '2018-05-13T16:18:00.000Z'
          }
        }
      },
      {
        filename: "2017-Avis d'impôt 2017 sur les revenus 2016.pdf",
        fileAttributes: {
          metadata: {
            contentAuthor: 'impots.gouv',
            year: 2017,
            classification: 'tax_notice',
            subClassification: 'main_notice',
            subjects: ['income'],
            datetimeLabel: 'issueDate',
            originalLabel: "Avis d'impôt 2017 sur les revenus 2016",
            datetime: '2017-09-01T10:00:00.000Z',
            issueDate: '2017-09-01T10:00:00.000Z'
          }
        }
      },
      {
        filename:
          "2017-Avis de situation déclarative à l'impôt 2017 sur les revenus 2016 (le 29-05-2017, à 14h35).pdf",
        fileAttributes: {
          metadata: {
            contentAuthor: 'impots.gouv',
            year: 2017,
            classification: 'tax_notice',
            subjects: ['income'],
            datetimeLabel: 'issueDate',
            originalLabel:
              "Avis de situation déclarative à l'impôt 2017 sur les revenus 2016 (le 29/05/2017, à 14:35)",
            datetime: '2017-05-29T12:35:00.000Z',
            issueDate: '2017-05-29T12:35:00.000Z'
          }
        }
      },
      {
        filename:
          "2017-1er Avis d'Acompte Provisionnel pour l'impôt 2017 sur les revenus 2016.pdf",
        fileAttributes: {
          metadata: {
            contentAuthor: 'impots.gouv',
            year: 2017,
            classification: 'tax_notice',
            subjects: ['income'],
            datetimeLabel: 'issueDate',
            originalLabel:
              "1er Avis d'Acompte Provisionnel pour l'impôt 2017 sur les revenus 2016",
            datetime: '2017-09-01T10:00:00.000Z',
            issueDate: '2017-09-01T10:00:00.000Z'
          }
        }
      }
    ]
    it('should reconciliate non monthly income bill with current year pdf', () => {
      const bills = [
        {
          year: '2018',
          type: 'income',
          date: '2018-09-10',
          amount: 1111,
          isMonthly: false,
          currency: 'EUR',
          address: '&#xA0;'
        }
      ]

      const result = ReconcilIiateBillsWithFiles(bills, entries)

      expect(result[0]).toMatchObject({
        amount: 1111,
        vendor: 'impot',
        currency: 'EUR',
        fileAttributes: {
          metadata: {
            originalLabel: "Avis d'impôt 2018 sur les revenus 2017"
          }
        }
      })
    })

    it('should reconciliate monthly income bill with previous year pdf if before October', () => {
      const bills = [
        {
          year: '2018',
          type: 'income',
          date: '2018-09-10',
          amount: 1111,
          isMonthly: true,
          currency: 'EUR',
          address: '&#xA0;'
        }
      ]

      const result = ReconcilIiateBillsWithFiles(bills, entries)

      expect(result[0]).toMatchObject({
        amount: 1111,
        vendor: 'impot',
        currency: 'EUR',
        fileAttributes: {
          metadata: {
            originalLabel: "Avis d'impôt 2017 sur les revenus 2016"
          }
        }
      })
    })

    it('should reconciliate monthly income bill with current year pdf if October or after', () => {
      const bills = [
        {
          year: '2018',
          type: 'income',
          date: '2018-10-10',
          amount: 1111,
          isMonthly: true,
          currency: 'EUR',
          address: '&#xA0;'
        }
      ]

      const result = ReconcilIiateBillsWithFiles(bills, entries)

      expect(result[0]).toMatchObject({
        amount: 1111,
        vendor: 'impot',
        currency: 'EUR',
        fileAttributes: {
          metadata: {
            originalLabel: "Avis d'impôt 2018 sur les revenus 2017"
          }
        }
      })
    })
  })
})
