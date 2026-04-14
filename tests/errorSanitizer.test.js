const { mapToErrorCode } = require('../src/utils/errorSanitizer')

describe('errorSanitizer known OpenAI account failures', () => {
  it('maps missing linked OpenAI account errors to account unavailable', () => {
    expect(
      mapToErrorCode(new Error('OpenAI account acc-1 has no valid accessToken'))
    ).toMatchObject({
      code: 'E011',
      message: 'Account temporarily unavailable',
      status: 503
    })
  })

  it('maps OpenAI token decrypt failures to authentication failed', () => {
    expect(mapToErrorCode(new Error('Failed to decrypt OpenAI accessToken'))).toMatchObject({
      code: 'E003',
      message: 'Authentication failed',
      status: 401
    })
  })

  it('keeps unknown failures as internal server error', () => {
    expect(mapToErrorCode(new Error('some unexpected failure'))).toMatchObject({
      code: 'E015',
      message: 'Internal server error',
      status: 500
    })
  })
})
