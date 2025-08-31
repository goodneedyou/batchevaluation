
import * as React from 'react'
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  (props, ref) => <input ref={ref} {...props} style={{ padding:'8px 10px', borderRadius:8, border:'1px solid #cbd5e1', width: props.type==='file' ? undefined : '100%' }} />
)
Input.displayName = 'Input'
export default Input
