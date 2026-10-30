#!/usr/bin/env node
/**
 * 把 package.json 里占位的仓库地址换成真实地址。
 *
 *   npm run repo -- <github-username>
 *   npm run repo -- <github-username> <repo-name>    # 仓库名不是 dsh-task-sfx 时
 *
 * 只改 repository / homepage / bugs 三个字段，其它内容原样保留（含字段顺序）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const manifestPath = join(root, 'package.json')
const readmePath = join(root, 'README.md')
const PLACEHOLDER = 'YOUR_GITHUB_USERNAME'

const OWNER = /^[A-Za-z\d](?:[A-Za-z\d-]{0,38})$/
const REPO = /^[A-Za-z\d._-]{1,100}$/

const owner = (process.argv[2] ?? '').trim()
const repo = (process.argv[3] ?? 'dsh-task-sfx').trim()

if (!OWNER.test(owner)) {
  console.error('用法: npm run repo -- <github-username> [repo-name]')
  console.error(`收到的用户名 ${JSON.stringify(owner)} 不是合法的 GitHub 账号名。`)
  process.exit(1)
}
if (!REPO.test(repo)) {
  console.error(`收到的仓库名 ${JSON.stringify(repo)} 不合法。`)
  process.exit(1)
}

const slug = `${owner}/${repo}`
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

manifest.repository = { type: 'git', url: `git+https://github.com/${slug}.git` }
manifest.homepage = `https://github.com/${slug}#readme`
manifest.bugs = { url: `https://github.com/${slug}/issues` }

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`repository / homepage / bugs 已指向 https://github.com/${slug}`)

/* README 里的 clone 地址同样换成真实用户名。 */
const readme = readFileSync(readmePath, 'utf8')
if (readme.includes(PLACEHOLDER)) {
  writeFileSync(readmePath, readme.split(PLACEHOLDER).join(owner), 'utf8')
  console.log(`README.md 里的 ${PLACEHOLDER} 已换成 ${owner}`)
}
