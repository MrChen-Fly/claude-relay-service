jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}))

const { CLIENT_IDS, isPathAllowedForClient } = require('../src/validators/clientDefinitions')
const CodexCliValidator = require('../src/validators/clients/codexCliValidator')

describe('Codex CLI path and request validation', () => {
  const baseHeaders = {
    'user-agent': 'codex_cli_rs/0.80.0 (Windows 10.0.26100; x86_64) WindowsTerminal',
    originator: 'codex_cli_rs',
    session_id: 'x'.repeat(32)
  }

  it('allows chat/completions paths for the Codex client definition', () => {
    expect(isPathAllowedForClient(CLIENT_IDS.CODEX_CLI, '/openai/chat/completions')).toBe(true)
    expect(isPathAllowedForClient(CLIENT_IDS.CODEX_CLI, '/openai/v1/chat/completions')).toBe(true)
  })

  it('accepts chat/completions requests without Codex instructions in the body', () => {
    const req = {
      headers: baseHeaders,
      path: '/openai/v1/chat/completions',
      body: {
        model: 'mimo-v2-pro',
        messages: [{ role: 'user', content: 'hello' }]
      }
    }

    expect(CodexCliValidator.validate(req)).toBe(true)
  })

  it('still requires Codex instructions for responses requests', () => {
    const missingInstructionsReq = {
      headers: baseHeaders,
      path: '/openai/v1/responses',
      body: {
        model: 'gpt-5-codex'
      }
    }
    expect(CodexCliValidator.validate(missingInstructionsReq)).toBe(false)

    const validResponsesReq = {
      headers: baseHeaders,
      path: '/openai/v1/responses',
      body: {
        model: 'gpt-5-codex',
        instructions:
          "You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer."
      }
    }
    expect(CodexCliValidator.validate(validResponsesReq)).toBe(true)
  })
})
