import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WebFrame, WebPageHeader, type WebFramePhase } from '../components/WebFrame'

/** The website's menu and footer lead elsewhere on the site: hidden, the rules' own tabs stay; a dark scrollbar */
const RULES_ONLY = 'body nav.sticky, body footer { display: none !important; } html { color-scheme: dark; scrollbar-color: #4b5563 transparent; }'

/** The website's rules inside the launcher (needs internet): its tabs (rules, shopping, performance…) work as on the site. */
export default function RulesScreen({ onBack }: { onBack(): void }) {
  const { t } = useTranslation()
  const view = useRef<PageWebview>(null)
  const [phase, setPhase] = useState<WebFramePhase>('checking')
  return (
    <div className="flex h-full flex-col px-8 pt-5 pb-1">
      <WebPageHeader title={t('rulesPage.title')} ready={phase === 'ready'} onBack={onBack} onReload={() => view.current?.reload()} onOpenInBrowser={() => window.hemisphere.pages.openInBrowser('rules')} />
      <div className="flex min-h-0 flex-1">
        <WebFrame page="rules" view={view} css={RULES_ONLY} onPhase={setPhase} />
      </div>
    </div>
  )
}
