import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { getReminderClockParts, updateReminderTimePart } from './reminder-dialog-state'

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1))
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => String(index))

export function ReminderField({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

export function ReminderChoiceChip({
  selected,
  label,
  onSelect
}: {
  selected: boolean
  label: string
  onSelect: () => void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? 'default' : 'outline'}
      aria-pressed={selected}
      onClick={onSelect}
      className="h-7 px-2 text-xs"
    >
      {label}
    </Button>
  )
}

export function ReminderTimeSelectTriple({
  time,
  onChange
}: {
  time: string
  onChange: (nextTime: string) => void
}): React.JSX.Element {
  const clock = getReminderClockParts(time)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)] gap-2">
      <Select
        value={String(clock.hour12)}
        onValueChange={(hour12) =>
          onChange(updateReminderTimePart(time, { hour12: Number(hour12) }))
        }
      >
        <SelectTrigger
          aria-label={translate('auto.components.reminders.ReminderDialog.6b802ecc99', 'Hour')}
          className="w-full min-w-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HOUR_OPTIONS.map((hour) => (
            <SelectItem key={hour} value={hour}>
              {hour}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={String(clock.minute)}
        onValueChange={(minute) =>
          onChange(updateReminderTimePart(time, { minute: Number(minute) }))
        }
      >
        <SelectTrigger
          aria-label={translate('auto.components.reminders.ReminderDialog.9e677335b0', 'Minute')}
          className="w-full min-w-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MINUTE_OPTIONS.map((minute) => (
            <SelectItem key={minute} value={minute}>
              {minute.padStart(2, '0')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={clock.period}
        onValueChange={(period) =>
          onChange(updateReminderTimePart(time, { period: period as 'AM' | 'PM' }))
        }
      >
        <SelectTrigger
          aria-label={translate('auto.components.reminders.ReminderDialog.22359b186a', 'AM or PM')}
          className="w-full min-w-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
