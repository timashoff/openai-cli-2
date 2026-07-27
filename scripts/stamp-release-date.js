// npm `version` lifecycle hook: stamps today's date into package.json next to
// the freshly bumped version, so the app can show WHEN its running code was
// released (`ai` boot banner). Runs automatically on `npm version ...` as part
// of the release ritual — never edit releaseDate by hand.
import fs from 'node:fs'
import path from 'node:path'

const pkgPath = path.join(import.meta.dirname, '../package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
pkg.releaseDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`stamped releaseDate ${pkg.releaseDate} for v${pkg.version}`)
