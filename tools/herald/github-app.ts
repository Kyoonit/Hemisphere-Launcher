// Adds the TEST GitHub App ("Herald Publisher (test)") to the local Herald server secrets.
//   npm run herald:github-app -- <downloaded .pem> <App ID> <Installation ID>
// GitHub gives the key as PKCS#1 PEM; the Worker needs PKCS#8 DER (WebCrypto), base64. Delete the .pem afterwards:
// the copy in herald/server/.dev.vars (git-ignored) is enough for local tests.
import { createPrivateKey } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [pem, appId, installationId] = process.argv.slice(2)
if (!pem || !/^\d+$/.test(appId ?? '') || !/^\d+$/.test(installationId ?? '')) {
  console.error('usage: npm run herald:github-app -- <downloaded .pem> <App ID> <Installation ID>')
  process.exitCode = 1
} else {
  const varsPath = join(import.meta.dirname, '..', '..', 'herald', 'server', '.dev.vars')
  if (!existsSync(varsPath)) throw new Error('Run "npm run herald:test-key" first')
  const der = createPrivateKey(readFileSync(pem)).export({ type: 'pkcs8', format: 'der' }) as Buffer
  const lines = readFileSync(varsPath, 'utf8').split(/\r?\n/).filter((l) => l && !/^(GITHUB_APP_ID|GITHUB_APP_KEY|GITHUB_INSTALLATION_ID|GITHUB_TOKEN)=/.test(l))
  lines.push(`GITHUB_APP_ID=${appId}`, `GITHUB_APP_KEY=${der.toString('base64')}`, `GITHUB_INSTALLATION_ID=${installationId}`)
  writeFileSync(varsPath, lines.join('\n') + '\n')
  console.log(`GitHub App ${appId} (installation ${installationId}) added to ${varsPath}. You can now delete ${pem}.`)
}
