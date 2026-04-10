class SemanticInputTooLargeError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'SemanticInputTooLargeError'
    this.code = 'SEMANTIC_INPUT_TOO_LARGE'
    this.reason = options.reason || 'input_too_large'
    this.details = options.details || {}
  }
}

function isSemanticInputTooLargeError(error) {
  return error?.code === 'SEMANTIC_INPUT_TOO_LARGE'
}

module.exports = {
  SemanticInputTooLargeError,
  isSemanticInputTooLargeError
}
