#!/usr/bin/env node
// 给 klaus dev 准备一份独立 bundle id 的 Electron.app — 避免和其它 electron dev 工程
// 共享 `com.github.Electron` 导致 macOS LaunchServices 互杀。
//
// 幂等：通过 .electron-dev/VERSION 和当前 node_modules/electron 版本比对，一致就 no-op。
// 触发重建的场景：首次跑 / electron 升级 / .electron-dev 被删。

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_APP = resolve(APP_ROOT, 'node_modules/electron/dist/Electron.app')
const DEST_DIR = resolve(APP_ROOT, '.electron-dev')
const DEST_APP = resolve(DEST_DIR, 'Klaus-Dev.app')
const VERSION_FILE = resolve(DEST_DIR, 'VERSION')
const BUNDLE_ID = 'ai.klaus.desktop.dev'
const BUNDLE_NAME = 'Klaus Dev'

function plist(arg, path) {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', arg, path], { stdio: 'pipe' })
}

const pkg = JSON.parse(readFileSync(resolve(APP_ROOT, 'node_modules/electron/package.json'), 'utf8'))
const version = pkg.version
const stamp = existsSync(VERSION_FILE) ? readFileSync(VERSION_FILE, 'utf8').trim() : null

if (stamp === version && existsSync(DEST_APP)) process.exit(0)

if (!existsSync(SRC_APP)) {
  console.error(`[setup-electron-dev] ${SRC_APP} not found — run npm install first`)
  process.exit(1)
}

console.log(`[setup-electron-dev] Preparing ${DEST_APP} (electron ${version})`)

if (existsSync(DEST_APP)) rmSync(DEST_APP, { recursive: true, force: true })
mkdirSync(DEST_DIR, { recursive: true })
execFileSync('cp', ['-R', SRC_APP, DEST_APP], { stdio: 'inherit' })

const infoPlist = resolve(DEST_APP, 'Contents/Info.plist')
plist(`Set :CFBundleIdentifier ${BUNDLE_ID}`, infoPlist)
plist(`Set :CFBundleName ${BUNDLE_NAME}`, infoPlist)
try {
  plist(`Set :CFBundleDisplayName ${BUNDLE_NAME}`, infoPlist)
} catch {
  plist(`Add :CFBundleDisplayName string ${BUNDLE_NAME}`, infoPlist)
}

// 改 Info.plist 后原签名失效，ad-hoc 重签让 macOS 愿意启动
execFileSync('codesign', ['--force', '--deep', '--sign', '-', DEST_APP], { stdio: 'inherit' })

writeFileSync(VERSION_FILE, version + '\n')
console.log(`[setup-electron-dev] Done (${BUNDLE_ID})`)
