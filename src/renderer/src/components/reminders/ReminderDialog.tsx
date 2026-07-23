import { useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  ReminderChoiceChip,
  ReminderField,
  ReminderTimeSelectTriple
} from './ReminderDialogControls'
import { translate } from '@/i18n/i18n'
import type { Reminder } from '../../../../shared/reminder-types'
import {
  buildReminderScheduleInput,
  createReminderDraft,
  describeReminderDraft,
  isReminderDraftSavable,
  resolveReminderDraft,
  type ReminderDraft,
  type ReminderOncePreset,
  type ReminderRepeatPreset
} from './reminder-dialog-state'

const ONCE_PRESETS: readonly [ReminderOncePreset, string][] = [
  ['in-15m', 'In 15m'],
  ['in-1h', 'In 1h'],
  ['in-3h', 'In 3h'],
  ['tomorrow-9', 'Tomorrow 9 AM'],
  ['custom', 'Pick time…']
]

const REPEAT_PRESETS: readonly [ReminderRepeatPreset, string][] = [
  ['hourly', 'Hourly'],
  ['daily', 'Daily'],
  ['weekdays', 'Weekdays'],
  ['weekly', 'Weekly']
]

const DAY_OPTIONS = [
  ['0', 'Sunday'],
  ['1', 'Monday'],
  ['2', 'Tuesday'],
  ['3', 'Wednesday'],
  ['4', 'Thursday'],
  ['5', 'Friday'],
  ['6', 'Saturday']
] as const

export function ReminderDialog({
  open,
  reminder,
  onOpenChange
}: {
  open: boolean
  /** Present in edit mode; absent when creating. */
  reminder?: Reminder | null
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<ReminderDraft>(() =>
    createReminderDraft(reminder ?? undefined)
  )
  const wasOpenRef = useRef(open)
  const syncedReminderRef = useRef(reminder)
  if (!open) {
    wasOpenRef.current = false
  } else if (!wasOpenRef.current || syncedReminderRef.current !== reminder) {
    wasOpenRef.current = true
    syncedReminderRef.current = reminder
    setDraft(createReminderDraft(reminder ?? undefined))
  }

  const now = Date.now()
  const preview = describeReminderDraft(draft, now)
  const canSave = isReminderDraftSavable(draft, now)

  const save = (): void => {
    const resolved = resolveReminderDraft(draft, Date.now())
    const schedule = buildReminderScheduleInput(draft, Date.now())
    if (!resolved || !schedule) {
      return
    }
    const message = draft.message.trim()
    if (reminder) {
      void window.api.reminders.update({
        id: reminder.id,
        updates: {
          message,
          dueAt: resolved.dueAt,
          recurrence: resolved.recurrence,
          status: 'pending'
        }
      })
    } else {
      void window.api.reminders.create({
        message,
        dueAt: resolved.dueAt,
        recurrence: resolved.recurrence,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        worktreeId: null,
        createdVia: 'ui'
      })
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {reminder
              ? translate('auto.components.reminders.ReminderDialog.f1c8b2a397', 'Edit Reminder')
              : translate('auto.components.reminders.ReminderDialog.d47a91e5c3', 'New Reminder')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'auto.components.reminders.ReminderDialog.83b6f2d9a1',
              'Orca notifies this desktop and paired phones when it is due.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ReminderField
            label={translate('auto.components.reminders.ReminderDialog.a2e94c17f5', 'Message')}
          >
            <Input
              autoFocus
              value={draft.message}
              maxLength={500}
              placeholder={translate(
                'auto.components.reminders.ReminderDialog.c91d3b82e6',
                'What should Orca remind you about?'
              )}
              onChange={(event) =>
                setDraft((current) => ({ ...current, message: event.target.value }))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canSave) {
                  event.preventDefault()
                  save()
                }
              }}
            />
          </ReminderField>

          <div className="space-y-2">
            <Label>
              {translate('auto.components.reminders.ReminderDialog.e58a71c4b9', 'When')}
            </Label>
            <div className="flex gap-1.5">
              <ReminderChoiceChip
                selected={draft.mode === 'once'}
                label={translate('auto.components.reminders.ReminderDialog.b83e5a92d7', 'Once')}
                onSelect={() => setDraft((current) => ({ ...current, mode: 'once' }))}
              />
              <ReminderChoiceChip
                selected={draft.mode === 'repeat'}
                label={translate('auto.components.reminders.ReminderDialog.f24c81b6e9', 'Repeat')}
                onSelect={() =>
                  setDraft((current) => ({ ...current, mode: 'repeat', oncePreset: 'custom' }))
                }
              />
            </div>
          </div>

          {draft.mode === 'once' ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {ONCE_PRESETS.map(([value, label]) => (
                  <ReminderChoiceChip
                    key={value}
                    selected={draft.oncePreset === value}
                    label={label}
                    onSelect={() => setDraft((current) => ({ ...current, oncePreset: value }))}
                  />
                ))}
              </div>
              {draft.oncePreset === 'custom' ? (
                <div className="grid grid-cols-2 gap-2">
                  <ReminderField
                    label={translate('auto.components.reminders.ReminderDialog.91c5e2d7a4', 'Date')}
                  >
                    <Input
                      type="date"
                      value={draft.date}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, date: event.target.value }))
                      }
                    />
                  </ReminderField>
                  <ReminderField
                    label={translate('auto.components.reminders.ReminderDialog.d90981f766', 'Time')}
                  >
                    <ReminderTimeSelectTriple
                      time={draft.time}
                      onChange={(time) => setDraft((current) => ({ ...current, time }))}
                    />
                  </ReminderField>
                </div>
              ) : null}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <ReminderField
                label={translate('auto.components.reminders.ReminderDialog.233b8c94b6', 'Cadence')}
              >
                <Select
                  value={draft.repeatPreset}
                  onValueChange={(repeatPreset) =>
                    setDraft((current) => ({
                      ...current,
                      repeatPreset: repeatPreset as ReminderRepeatPreset
                    }))
                  }
                >
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REPEAT_PRESETS.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ReminderField>
              {draft.repeatPreset === 'weekly' ? (
                <ReminderField
                  label={translate('auto.components.reminders.ReminderDialog.6b914c5fbb', 'Day')}
                >
                  <Select
                    value={draft.dayOfWeek}
                    onValueChange={(dayOfWeek) =>
                      setDraft((current) => ({ ...current, dayOfWeek }))
                    }
                  >
                    <SelectTrigger className="w-full min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAY_OPTIONS.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </ReminderField>
              ) : null}
              {draft.repeatPreset !== 'hourly' ? (
                <ReminderField
                  label={translate('auto.components.reminders.ReminderDialog.d90981f766', 'Time')}
                >
                  <ReminderTimeSelectTriple
                    time={draft.time}
                    onChange={(time) => setDraft((current) => ({ ...current, time }))}
                  />
                </ReminderField>
              ) : (
                <ReminderField
                  label={translate('auto.components.reminders.ReminderDialog.9e677335b0', 'Minute')}
                >
                  <ReminderTimeSelectTriple
                    time={draft.time}
                    onChange={(time) => setDraft((current) => ({ ...current, time }))}
                  />
                </ReminderField>
              )}
            </div>
          )}

          <div className={cn('text-xs', preview ? 'text-muted-foreground' : 'text-destructive')}>
            {draft.mode === 'repeat'
              ? translate(
                  'auto.components.reminders.ReminderDialog.a7e39b51c2',
                  'Next: {{value0}}',
                  { value0: preview ?? '—' }
                )
              : preview
                ? translate(
                    'auto.components.reminders.ReminderDialog.c46d82e1b5',
                    'Fires: {{value0}}',
                    { value0: preview }
                  )
                : translate(
                    'auto.components.reminders.ReminderDialog.e92b57a3d8',
                    'Pick a future time.'
                  )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {translate('auto.components.reminders.ReminderDialog.01af244097', 'Cancel')}
          </Button>
          <Button type="button" disabled={!canSave} onClick={save}>
            {reminder
              ? translate('auto.components.reminders.ReminderDialog.b1d74c92e5', 'Save')
              : translate('auto.components.reminders.ReminderDialog.f8a2c61d94', 'Create Reminder')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
