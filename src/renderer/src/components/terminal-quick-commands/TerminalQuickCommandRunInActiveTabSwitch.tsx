import { translate } from '@/i18n/i18n'
type TerminalQuickCommandRunInActiveTabSwitchProps = {
  runInActiveTab: boolean
  onToggle: () => void
}

export function TerminalQuickCommandRunInActiveTabSwitch({
  runInActiveTab,
  onToggle
}: TerminalQuickCommandRunInActiveTabSwitchProps): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <div className="text-sm font-medium">
          {translate(
            'auto.components.terminal.quick.commands.TerminalQuickCommandRunInActiveTabSwitch.7d3c91a5e2',
            'Run in active terminal'
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {translate(
            'auto.components.terminal.quick.commands.TerminalQuickCommandRunInActiveTabSwitch.b1f8e6c204',
            'Send to the current terminal tab instead of opening a new one.'
          )}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={runInActiveTab}
        aria-label={translate(
          'auto.components.terminal.quick.commands.TerminalQuickCommandRunInActiveTabSwitch.f5a2d78b91',
          'Toggle run in active terminal'
        )}
        onClick={onToggle}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors ${
          runInActiveTab ? 'bg-foreground' : 'bg-muted-foreground/30'
        }`}
      >
        <span
          className={`pointer-events-none block size-3.5 rounded-full bg-background shadow-sm transition-transform ${
            runInActiveTab ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}
