
import * as React from 'react'
export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => (
  <textarea {...props} style={{ padding:'8px 10px', borderRadius:8, border:'1px solid #cbd5e1', width:'100%' }} />
)
export default Textarea
