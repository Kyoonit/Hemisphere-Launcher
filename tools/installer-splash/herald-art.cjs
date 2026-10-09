// Electron main (run by herald.mjs): draws the background of Herald's install window, 1040x600 (2x the window),
// and writes it as a 24-bit BMP (what the NSIS plugin loads). Different from the launcher's on purpose: darker
// art, Herald's green "H", no Hemisphere logo (the title and subtitle are drawn by the plugin).
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const [root, out] = process.argv.slice(-2)
const art = pathToFileURL(join(root, 'src/renderer/src/assets/backgrounds/player-bases.webp')).href
const html = `<!doctype html><html><body style="margin:0;width:1040px;height:600px;overflow:hidden;background:#0b0f19">
<div style="position:absolute;inset:-20px;background:url('${art}') center/cover;filter:blur(3px) saturate(.8)"></div>
<div style="position:absolute;inset:0;background:linear-gradient(160deg,rgba(6,46,24,.5),rgba(11,15,25,.66) 50%,rgba(11,15,25,.93))"></div>
<div style="position:absolute;inset:0;background:repeating-linear-gradient(135deg,rgba(74,222,128,.035) 0 2px,transparent 2px 22px)"></div>
<div style="position:absolute;left:0;right:0;top:0;height:6px;background:linear-gradient(90deg,#16a34a,#4ade80,#16a34a)"></div>
<div style="position:absolute;left:436px;top:80px;width:168px;height:168px;border-radius:38px;background:linear-gradient(135deg,#4ade80,#16a34a);
  display:grid;place-items:center;font:800 112px 'Segoe UI',sans-serif;color:#05210f;box-shadow:0 10px 30px rgba(0,0,0,.55),0 0 60px rgba(74,222,128,.25)">H</div>
</body></html>`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1040, height: 600, show: false, frame: false, useContentSize: true, webPreferences: { offscreen: true, webSecurity: false } })
  const page = join(app.getPath('temp'), 'herald-splash.html')
  writeFileSync(page, html)
  await win.loadFile(page)
  await new Promise((r) => setTimeout(r, 800))
  const img = (await win.webContents.capturePage()).resize({ width: 1040, height: 600 })
  const { width, height } = img.getSize()
  const bgra = img.toBitmap()
  // BMP: bottom-up rows, 24-bit BGR, rows padded to 4 bytes
  const row = Math.ceil((width * 3) / 4) * 4
  const bmp = Buffer.alloc(54 + row * height)
  bmp.write('BM', 0)
  bmp.writeUInt32LE(bmp.length, 2)
  bmp.writeUInt32LE(54, 10)
  bmp.writeUInt32LE(40, 14)
  bmp.writeInt32LE(width, 18)
  bmp.writeInt32LE(height, 22)
  bmp.writeUInt16LE(1, 26)
  bmp.writeUInt16LE(24, 28)
  bmp.writeUInt32LE(row * height, 34)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4
      const d = 54 + (height - 1 - y) * row + x * 3
      bmp[d] = bgra[s]
      bmp[d + 1] = bgra[s + 1]
      bmp[d + 2] = bgra[s + 2]
    }
  writeFileSync(out, bmp)
  app.quit()
})
