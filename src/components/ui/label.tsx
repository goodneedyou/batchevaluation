
import * as React from 'react'
export const Label: React.FC<React.LabelHTMLAttributes<HTMLLabelElement>> = ({ children, ...p }) => (
  <label {...p} style={{ display:'block', fontSize:12, color:'#334155', marginBottom:4 }}>{children}</label>
)
export default Label
