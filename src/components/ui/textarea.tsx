
import * as React from 'react'

export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => (
  <textarea 
    {...props} 
    style={{ 
      padding: '10px 12px', 
      borderRadius: 8, 
      border: '1px solid #cbd5e1', 
      width: '100%',
      fontSize: '14px',
      backgroundColor: 'white',
      transition: 'border-color 0.2s ease',
      boxSizing: 'border-box',
      resize: 'vertical',
      minHeight: '80px',
      fontFamily: 'inherit',
      ...props.style
    }} 
  />
)

export default Textarea
