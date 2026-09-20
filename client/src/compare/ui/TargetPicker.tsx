import { Check, ChevronDown } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { cn } from '@/lib/utils';
import type { CompareTarget } from '@/store/compareStore';
import { parseTargetKey, targetKey, targetLabel, targetOptions } from '../targets';
import { CONTROL_H, controlBase, menuItem, menuLabel, menuSurface } from './toolbar';

/**
 * One side's target selector.
 *
 * Radix DropdownMenu rather than a Select because the options are grouped
 * ("Years" / "Layers") and some are disabled, and a menu gives both without a
 * native listbox's un-themeable rendering. It is themed to match the rest of
 * the shadcn set in components/ui rather than styled from scratch — if you'd
 * rather have the real thing, `bunx shadcn@latest add dropdown-menu` and this
 * swaps over with no change to its props.
 */

interface Props {
  value: CompareTarget;
  onChange: (target: CompareTarget) => void;
  /** Screen-reader name — the trigger itself only shows the target label. */
  side: 'Left' | 'Right';
}

export function TargetPicker({ value, onChange, side }: Props) {
  const { years, layers } = targetOptions();
  const current = targetKey(value);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`${side} comparison target`}
        className={cn(
          controlBase,
          CONTROL_H,
          'max-w-38 justify-between px-2',
          'data-[state=open]:border-border-action data-[state=open]:bg-surface-3',
        )}
      >
        <span className="truncate">{targetLabel(value)}</span>
        <ChevronDown size={12} className="shrink-0 text-icon-base" aria-hidden />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={4} className={menuSurface}>
          <DropdownMenu.RadioGroup
            value={current}
            onValueChange={(key) => {
              const target = parseTargetKey(key);
              if (target) onChange(target);
            }}
          >
            <DropdownMenu.Label className={menuLabel}>Year</DropdownMenu.Label>
            {years.map((option) => (
              <DropdownMenu.RadioItem
                key={option.key}
                value={option.key}
                disabled={!option.available}
                className={menuItem}
              >
                <DropdownMenu.ItemIndicator className="absolute left-1.5 flex items-center">
                  <Check size={12} className="text-border-action" aria-hidden />
                </DropdownMenu.ItemIndicator>
                <span className="truncate">{option.label}</span>
              </DropdownMenu.RadioItem>
            ))}

            <DropdownMenu.Separator className="my-1 h-px bg-border-0" />

            <DropdownMenu.Label className={menuLabel}>Layer</DropdownMenu.Label>
            {layers.map((option) => (
              <DropdownMenu.RadioItem
                key={option.key}
                value={option.key}
                disabled={!option.available}
                className={menuItem}
              >
                <DropdownMenu.ItemIndicator className="absolute left-1.5 flex items-center">
                  <Check size={12} className="text-border-action" aria-hidden />
                </DropdownMenu.ItemIndicator>
                <span className="truncate">{option.label}</span>
                {!option.available && (
                  <span className="ml-auto pl-2 text-[10px] text-icon-base">n/a</span>
                )}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
