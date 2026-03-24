/* eslint-disable */
/* tslint:disable */

const { existsSync } = require('fs')
const { join } = require('path')

function requireBinding(localFile) {
  const localPath = join(__dirname, localFile)
  if (existsSync(localPath)) {
    return require(localPath)
  }

  throw new Error(
    '[XQoder] No packaged renderer is available for ' + process.platform + '/' + process.arch + '. ' +
    'Build locally with pnpm build:renderer or add a platform package.'
  )
}

function loadNativeBinding() {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return requireBinding('index.darwin-arm64.node')
  }

  if (process.platform === 'darwin' && process.arch === 'x64') {
    return requireBinding('index.darwin-x64.node')
  }

  if (process.platform === 'darwin') {
    return requireBinding('index.darwin-universal.node')
  }

  if (process.platform === 'linux' && process.arch === 'x64') {
    return requireBinding('index.linux-x64-gnu.node')
  }

  if (process.platform === 'win32' && process.arch === 'x64') {
    return requireBinding('index.win32-x64-msvc.node')
  }

  throw new Error(
    '[XQoder] Unsupported renderer platform ' + process.platform + '/' + process.arch + '. '
  )
}

module.exports = loadNativeBinding()
