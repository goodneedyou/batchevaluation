
import * as React from 'react'
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'outline'|'secondary'|'ghost' }
export const Button: React.FC<Props> = ({ children, ...props }) => (
  <button {...props} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer' }}>
    {children}
  </button>
)
export default Button
