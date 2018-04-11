const {
  BaseKonnector,
  requestFactory,
  log,
  scrape
} = require('cozy-konnector-libs')
const request = requestFactory({
  // debug: true,
  cheerio: true,
  jar: true
})

const baseUrl = 'https://cfspart.impots.gouv.fr'

module.exports = new BaseKonnector(start)

async function start (fields) {
  await login(fields)
  await fetch()
}

async function fetch () {
  log('info', 'Fetching the list of documents')
  let $ = await request(`${baseUrl}/acces-usager/cfs`)

  // get the "Mes documents" link
  const documentsLink = $('img[name=doc]').closest('a').attr('href')
  $ = await request(`${baseUrl}${documentsLink}`)

  const $form = $('form[name=documentsForm]')
  const formUrl = $form.attr('action')
  const token = $form.find('input[name=CSRFTOKEN]').val()

  $ = await request({
    method: 'POST',
    uri: `${baseUrl}${formUrl}`,
    form: {
      annee: 'all',
      CSRFTOKEN: token,
      method: 'rechercheDocuments',
      typeDocument: 'toutDocument',
      typeImpot: 'toutImpot'
    }
  })

  const docs = scrape($, {
    'fileurl': {
      attr: 'onclick'
    }
  }, '.cssLienTable')

  console.log(docs, 'docs')
}

async function login (fields) {
  log('info', 'Logging in')
  await request(`${baseUrl}/LoginMDP`)
  await request({
    method: 'POST',
    uri: `${baseUrl}/LoginMDP?op=c&url=`,
    form: {
      url: '',
      LMDP_Spi: fields.login,
      LMDP_Password: fields.password,
      LMDP_Spi_tmp: fields.login,
      LMDP_Password_tmp: fields.password
    }
  })
  // TODO check LOGIN_FAILED
}
