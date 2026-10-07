/** Page shown in the browser after Microsoft redirects back to the launcher. Static, no scripts. */
const TEXT = {
  en: {
    ok: ['Signed in!', 'You can close this tab and return to the Hemisphere Launcher.'],
    fail: ['Sign-in not completed', 'Return to the Hemisphere Launcher and try again.'],
  },
  fr: {
    ok: ['Connexion réussie !', 'Tu peux fermer cet onglet et revenir au launcher Hemisphere.'],
    fail: ['Connexion non terminée', 'Reviens au launcher Hemisphere et réessaie.'],
  },
} as const

export function callbackPage(ok: boolean, language: string): string {
  const t = TEXT[language === 'fr' ? 'fr' : 'en'][ok ? 'ok' : 'fail']
  const accent = ok ? '#4ade80' : '#f87171'
  return `<!doctype html><html><head><meta charset="utf-8"><title>Hemisphere Launcher</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:linear-gradient(180deg,#111827,#1f2937);
font-family:-apple-system,"Segoe UI",Roboto,sans-serif;color:#e5e7eb}
div{background:rgba(31,41,55,.7);padding:40px 48px;border-radius:8px;text-align:center;box-shadow:0 10px 15px -3px rgba(0,0,0,.3)}
h1{margin:0 0 8px;color:${accent};font-size:28px;text-transform:uppercase}p{margin:0;color:#9ca3af}</style></head>
<body><div><h1>${t[0]}</h1><p>${t[1]}</p></div></body></html>`
}
