
import * as React from 'react'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  (props, ref) => (
    <input 
      ref={ref} 
      {...props} 
      style={{ 
        padding: '10px 12px', 
        borderRadius: 8, 
        border: '1px solid #cbd5e1', 
        width: props.type === 'file' ? undefined : '100%',
        fontSize: '14px',
        backgroundColor: 'white',
        transition: 'border-color 0.2s ease',
        boxSizing: 'border-box',
        ...props.style
      }} 
    />
  )
)

Input.displayName = 'Input'
export default Input
