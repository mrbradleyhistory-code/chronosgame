import { useRef } from 'react'

interface PinInputProps {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}

export function PinInput({ value, onChange, disabled }: PinInputProps) {
  const pinRefs = useRef<(HTMLInputElement | null)[]>([null, null, null, null])

  function handleChange(index: number, raw: string) {
    const digit = raw.replace(/\D/g, '').slice(-1)
    const chars = value.padEnd(4, ' ').split('')
    chars[index] = digit
    const next = chars.join('').trimEnd().slice(0, 4)
    onChange(next)
    if (digit && index < 3) {
      pinRefs.current[index + 1]?.focus()
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      if (!value[index] && index > 0) {
        const chars = value.split('')
        chars[index - 1] = ''
        onChange(chars.join(''))
        pinRefs.current[index - 1]?.focus()
      } else if (value[index]) {
        const chars = value.split('')
        chars[index] = ''
        onChange(chars.join(''))
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      pinRefs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < 3) {
      pinRefs.current[index + 1]?.focus()
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    if (pasted) {
      e.preventDefault()
      onChange(pasted)
      pinRefs.current[Math.min(pasted.length, 3)]?.focus()
    }
  }

  return (
    <div className="pin-input-row">
      {[0, 1, 2, 3].map((i) => (
        <input
          key={i}
          ref={(el) => { pinRefs.current[i] = el }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] ?? ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          disabled={disabled}
          className="pin-box"
          autoComplete="off"
        />
      ))}
    </div>
  )
}
