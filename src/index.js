const {
  BaseKonnector,
  requestFactory,
  log
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
