const cheerio = require('cheerio')
const { extractDetails } = require('./bills')

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
   </tbody>
  </table>
 </body>
</html>`

      const $ = cheerio.load(html)
      const result = extractDetails($, $('body'), 2019, 'thetype')
      expect(result).toEqual([
        {
          year: 2019,
          type: 'thetype',
          date: '2019-08-16',
          amount: 19,
          currency: 'EUR'
        }
      ])
    })
  })
})
