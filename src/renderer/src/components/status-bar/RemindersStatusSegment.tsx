import React, { useMemo, useState } from 'react'
import { Bell, BellPlus, Check, Pencil, Trash2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { ReminderDialog } from '@/components/reminders/ReminderDialog'
import { navigateToReminderWorktree } from '@/components/reminders/reminder-fired-toast'
import {
  describeReminderDueDelta,
  describeReminderSchedule
} from '../../../../shared/reminder-schedule'
import { isSettledReminderStatus, type Reminder } from '../../../../shared/reminder-types'
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from './status-bar-context-menu-policy'
import { translate } from '@/i18n/i18n'

type RemindersStatusSegmentProps = {
  compact?: boolean
  iconOnly: boolean
}

function ReminderRow({
  reminder,
  onEdit
}: {
  reminder: Reminder
  onEdit: (reminder: Reminder) => void
}): React.JSX.Element {
  const dueLabel =
    reminder.status === 'missed'
      ? translate('auto.components.status.bar.RemindersStatusSegment.e51c3a97b2', 'Missed')
      : `${describeReminderSchedule(reminder)} · ${describeReminderDueDelta(reminder.dueAt, Date.now())}`
  return (
    <div className="group/reminder flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => navigateToReminderWorktree(reminder.worktreeId)}
      >
        <span className="block truncate text-xs font-medium text-foreground">
          {reminder.message}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">{dueLabel}</span>
      </button>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/reminder:opacity-100">
        <button
          type="button"
          onClick={() => void window.api.reminders.complete({ id: reminder.id })}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={translate(
            'auto.components.status.bar.RemindersStatusSegment.b24f96c1a7',
            'Done'
          )}
        >
          <Check className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => onEdit(reminder)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={translate(
            'auto.components.status.bar.RemindersStatusSegment.15529ede69',
            'Edit'
          )}
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => void window.api.reminders.delete({ id: reminder.id })}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
          aria-label={translate(
            'auto.components.status.bar.RemindersStatusSegment.196593b6a9',
            'Delete'
          )}
        >
          <Trash2 className="size-3" />
        </button>
      </span>
    </div>
  )
}

export function RemindersStatusSegment({
  iconOnly
}: RemindersStatusSegmentProps): React.JSX.Element {
  const reminders = useAppStore((s) => s.reminders)
  const [open, setOpen] = useState(false)
  const [editor, setEditor] = useState<{ open: boolean; reminder: Reminder | null }>({
    open: false,
    reminder: null
  })

  // Why: missed reminders stay listed (not just pending/fired) so an overdue
  // reminder that expired while the app was closed doesn't vanish silently.
  const visibleReminders = useMemo(
    () =>
      reminders
        .filter(
          (reminder) => !isSettledReminderStatus(reminder.status) || reminder.status === 'missed'
        )
        .sort((left, right) => left.dueAt - right.dueAt),
    [reminders]
  )
  const pendingCount = useMemo(
    () => visibleReminders.filter((reminder) => reminder.status !== 'missed').length,
    [visibleReminders]
  )

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent/70"
                aria-label={translate(
                  'auto.components.status.bar.RemindersStatusSegment.c72e91b5a4',
                  'Reminders, {{value0}} pending',
                  { value0: pendingCount }
                )}
              >
                <Bell className="size-3 text-muted-foreground" />
                {(!iconOnly || pendingCount > 0) && (
                  <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                    {pendingCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {translate(
              'auto.components.status.bar.RemindersStatusSegment.d81f5c39e7',
              'Reminders — {{value0}} pending',
              { value0: pendingCount }
            )}
          </TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-80 p-1">
          <div className="max-h-72 overflow-y-auto py-0.5">
            {visibleReminders.length === 0 ? (
              <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                {translate(
                  'auto.components.status.bar.RemindersStatusSegment.f39c52a8d1',
                  'No reminders'
                )}
              </div>
            ) : null}
            {visibleReminders.map((reminder) => (
              <ReminderRow
                key={reminder.id}
                reminder={reminder}
                onEdit={(target) => {
                  setOpen(false)
                  setEditor({ open: true, reminder: target })
                }}
              />
            ))}
          </div>
          <div className="border-t border-border/50 p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-xs text-muted-foreground"
              onClick={() => {
                setOpen(false)
                setEditor({ open: true, reminder: null })
              }}
            >
              <BellPlus className="size-3.5" />
              {translate(
                'auto.components.status.bar.RemindersStatusSegment.a64d83b1f9',
                'New reminder'
              )}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <ReminderDialog
        open={editor.open}
        reminder={editor.reminder}
        onOpenChange={(nextOpen) => setEditor((current) => ({ ...current, open: nextOpen }))}
      />
    </>
  )
}
