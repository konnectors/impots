const cheerio = require('cheerio')
const moment = require('moment')
const parseBills = require('./bills')

describe('Test on bills parsing', () => {
  it('Covering model 3 case, model 5 case, refund, second tax same year', () => {
    const inputHtml = `<table cellspacing="0" class="cssTailleTable" border="0" cellpadding="0">
<tbody>
<tr><td valign="top" width="15"><img border="0" src="https://static.impots.gouv.fr/cfsu/static/usager/img/tabl_puce.gif"></td><td width="15" class="cssBarreTitre"><img height="1" width="15" border="0" src="https://static.impots.gouv.fr/cfsu/static/common/img/pixnull.gif"></td><td bgcolor="#84ba39" class="cssBarreTitreAvecTaille"><img height="1" border="0" class="cssTailleImage" src="https://static.impots.gouv.fr/cfsu/static/common/img/pixnull.gif"></td><td width="15"><img src="https://static.impots.gouv.fr/cfsu/static/usager/img/tabl_haut_droit.gif"></td><td width="600" class="cssEspace"><img height="1" width="15" border="0" src="https://static.impots.gouv.fr/cfsu/static/common/img/pixnull.gif"></td></tr>
<tr><td width="600" class="cssEspace"><img height="1" width="15" border="0" src="https://static.impots.gouv.fr/cfsu/static/common/img/pixnull.gif"></td><td colspan="3" width="100%" class="cssFondTable"><table cellspacing="0" width="100%" border="0" cellpadding="0"><tbody>
<tr><td width="58" class="cssSousTitre" valign="top" nowrap="">Année</td><td width="115" class="cssSousTitre" valign="top" nowrap="">Impôt</td><td width="*" class="cssSousTitre" valign="top" nowrap="">Détail</td><td width="98" valign="top" class="cssSousTitre" nowrap="">Montant dû&nbsp;&nbsp;&nbsp;</td><td width="98" class="cssSousTitre" valign="top" nowrap="">Montant réglé</td><td width="98" class="cssSousTitre" valign="top" nowrap="">Reste à payer</td></tr>

<tr><td rowspan="62" width="58" class="cssFondTextePair" valign="top">2018</td><td colspan="5" class="cssFondTextePair"><a onclick="win = ouvreDocument('consultation/ConsultationDocument?Action=GetDocument&amp;Page=Documents&amp;typeImpot=1&amp;typeDoc=2&amp;numeroAdonis=18780&amp;pph=57000000&amp;numSection=1&amp;typeForm=1MEN&amp;annee=2018&amp;numCompteCom=&amp;cdDoc=2-1-1MEN', 805, 500)" title="Accéder au dernier avis" href="javascript:;" class="cssLienTable">Impôt 2018 sur les revenus de 2017</a></td></tr>
<tr><td width="*" class="cssFondTexteImpair" rowspan="25">&nbsp;</td><td class="cssFondTexteImpair"><a href="javascript:;" onclick="win = ouvrePage('./contrat.html?method=affichage&amp;id=M17&amp;idLot=17472&amp;typeImpot=IR', '400','250')" class="cssLienTable">Prélèvement mensuel&nbsp;du 15/12/2017</a></td><td valign="middle" width="98" class="cssFondTexteImpair">&nbsp;</td><td align="right" width="98" class="cssFondTexteImpair" valign="middle">305&nbsp;€</td><td align="right" rowspan="25" width="98" class="cssFondTexteImpair" valign="top">0&nbsp;€</td></tr>
<tr><td width="*" class="cssFondTextePair" rowspan="20">&nbsp;</td><td class="cssFondTextePairEcheance">Echéance de mensualisation&nbsp;du 15/10/2018</td><td align="right" width="98" class="cssFondTextePairEcheance" valign="middle">502&nbsp;€</td><td valign="middle" width="98" class="cssFondTextePairEcheance">&nbsp;</td><td align="right" rowspan="20" width="98" class="cssFondTextePair" valign="top">1&nbsp;831&nbsp;€</td></tr>
<tr><td class="cssFondTextePair"><a href="javascript:;" onclick="win = ouvrePage('./contrat.html?method=affichage&amp;id=M178027&amp;idLot=1884202443&amp;typeImpot=IR', '400','250')" class="cssLienTable">Prélèvement mensuel&nbsp;du 17/09/2018</a></td><td valign="middle" width="98" class="cssFondTextePair">&nbsp;</td><td align="right" width="98" class="cssFondTextePair" valign="middle">296&nbsp;€</td></tr>
<tr><td colspan="4" class="cssFondTexteImpair">Remboursement d'excédent de 350&nbsp;€. Pour plus d'informations sur le paiement, veuillez contacter votre&nbsp;<a href="javascript:;" onclick="win = ouvrePage('./tresorerie.html?method=affichage&amp;type=78043 ',345,250)" class="cssLienTable">Service gestionnaire</a>.</td></tr>

<tr><td colspan="5" class="cssFondTextePair"><a onclick="win = ouvreDocument('consultation/ConsultationDocument?Action=GetDocument&amp;Page=Documents&amp;typeImpot=2&amp;typeDoc=2&amp;numeroAdonis=167&amp;pph=5700000&amp;numSection=1&amp;typeForm=1MEN&amp;annee=2016&amp;numCompteCom=&amp;cdDoc=2-2-1MEN', 805, 500)" title="Accéder au dernier avis" href="javascript:;" class="cssLienTable">Taxes foncières</a></td></tr>
<tr><td rowspan="25" width="*" valign="top" class="cssFondTextePair">BLANC (88)</td><td class="cssFondTextePair"><a href="javascript:;" onclick="win = ouvrePage('./contrat.html?method=affichage&amp;id=M378&amp;idLot=16802&amp;typeImpot=TF', '400','250')" class="cssLienTable">Prélèvement mensuel&nbsp;du 15/12/2016</a></td><td valign="middle" width="98" class="cssFondTextePair">&nbsp;</td><td align="right" width="98" class="cssFondTextePair" valign="middle">77&nbsp;€</td><td align="right" rowspan="25" width="98" class="cssFondTextePair" valign="top">0&nbsp;€</td></tr>
<tr><td rowspan="20" width="*" valign="top" class="cssFondTextePair">BLANC (88)</td><td class="cssFondTextePairEcheance">Echéance de mensualisation&nbsp;du 15/10/2018</td><td align="right" width="98" class="cssFondTextePairEcheance" valign="middle">103&nbsp;€</td><td valign="middle" width="98" class="cssFondTextePairEcheance">&nbsp;</td><td align="right" rowspan="20" width="98" class="cssFondTextePair" valign="top">124&nbsp;€</td></tr>


</tbody></table></td></tr>
<tr><td width="600" class="cssEspace"><img height="1" width="15" border="0" src="https://static.impots.gouv.fr/cfsu/static/common/img/pixnull.gif"></td><td class="cssBarreBas"><img src="https://static.impots.gouv.fr/cfsu/static/usager/img/tabl_bas_gauche.gif"></td><td colspan="2" bgcolor="#c8e0a6" class="cssBarreBas"><img height="1" border="0" class="cssTailleImage" src="https://static.impots.gouv.fr/cfsu/static/common/img/pixnull.gif"></td></tr></tbody></table>
`
    const $ = cheerio.load(inputHtml)
    const bills = parseBills($, 'cfsu-05', 'https://cfspart.impots.gouv.fr')
    expect(bills).toEqual([
      {
        vendor: 'impot',
        amount: 305,
        currency: 'EUR',
        date: moment('15/12/2017', 'DD-MM-YYYY').toDate(),
        fileurl:
          'https://cfspart.impots.gouv.fr/cfsu-05/consultation/ConsultationDocument?Action=GetDocument&Page=Documents&typeImpot=1&typeDoc=2&numeroAdonis=18780&pph=57000000&numSection=1&typeForm=1MEN&annee=2018&numCompteCom=&cdDoc=2-1-1MEN'
      },
      {
        vendor: 'impot',
        amount: 296,
        currency: 'EUR',
        date: moment('17/09/2018', 'DD-MM-YYYY').toDate(),
        fileurl:
          'https://cfspart.impots.gouv.fr/cfsu-05/consultation/ConsultationDocument?Action=GetDocument&Page=Documents&typeImpot=1&typeDoc=2&numeroAdonis=18780&pph=57000000&numSection=1&typeForm=1MEN&annee=2018&numCompteCom=&cdDoc=2-1-1MEN'
      },
      {
        vendor: 'impot',
        amount: 350,
        isRefund: true,
        currency: 'EUR',
        date: moment('01/07/2018', 'DD-MM-YYYY').toDate(),
        fileurl:
          'https://cfspart.impots.gouv.fr/cfsu-05/consultation/ConsultationDocument?Action=GetDocument&Page=Documents&typeImpot=1&typeDoc=2&numeroAdonis=18780&pph=57000000&numSection=1&typeForm=1MEN&annee=2018&numCompteCom=&cdDoc=2-1-1MEN'
      },
      {
        vendor: 'impot',
        amount: 77,
        currency: 'EUR',
        date: moment('15/12/2016', 'DD-MM-YYYY').toDate(),
        fileurl:
          'https://cfspart.impots.gouv.fr/cfsu-05/consultation/ConsultationDocument?Action=GetDocument&Page=Documents&typeImpot=2&typeDoc=2&numeroAdonis=167&pph=5700000&numSection=1&typeForm=1MEN&annee=2016&numCompteCom=&cdDoc=2-2-1MEN'
      }
    ])
  })
})
