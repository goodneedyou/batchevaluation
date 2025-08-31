
import * as React from 'react'
export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, ...p }) => (
  <div {...p} style={{ border:'1px solid #e2e8f0', borderRadius:12, background:'#fff' }}>{children}</div>
)
export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, ...p }) => (
  <div {...p} style={{ padding:'12px 16px', borderBottom:'1px solid #e2e8f0' }}>{children}</div>
)
export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({ children, ...p }) => (
  <h3 {...p} style={{ margin:0, fontSize:16 }}>{children}</h3>
)
export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ children, ...p }) => (
  <p {...p} style={{ margin:0, color:'#475569', fontSize:12 }}>{children}</p>
)
export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, ...p }) => (
  <div {...p} style={{ padding:'12px 16px' }}>{children}</div>
)
