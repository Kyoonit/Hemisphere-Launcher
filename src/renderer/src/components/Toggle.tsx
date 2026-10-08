/** On/off switch in the Hemisphere style (green when on). */
export default function Toggle({ on, onChange, label, disabled, title }: { on: boolean; onChange(on: boolean): void; label: string; disabled?: boolean; title?: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-10 flex-none rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'bg-green-600' : 'bg-gray-600'}`}
    >
      <span className={`absolute top-[3px] left-[3px] h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 ${on ? 'translate-x-[18px]' : ''}`} />
    </button>
  )
}
