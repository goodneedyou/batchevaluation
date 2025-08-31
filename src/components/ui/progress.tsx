
import * as React from 'react'
export const Progress: React.FC<{ value?: number }> = ({ value=0 }) => (
  <div style={{ width:'100%', height:8, background:'#e2e8f0', borderRadius:9999 }}>
    <div style={{ width:`${Math.max(0, Math.min(100, value))}%`, height:'100%', background:'#6366f1', borderRadius:9999 }} />
  </div>
)
export default Progress
