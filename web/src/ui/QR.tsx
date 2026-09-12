import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function QR({ value, size = 320, label }: { value: string; size?: number; label?: string }) {
  const [src, setSrc] = useState<string>('')
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#33393f', light: '#ffffff' } })
      .then((u) => { if (alive) setSrc(u) }).catch(() => setSrc(''))
    return () => { alive = false }
  }, [value, size])
  return (
    <div className="qr" style={{ width: size }}>
      {src ? <img src={src} width={size} height={size} alt={label ?? 'QR'} style={{ display: 'block', borderRadius: 8 }} /> : <div style={{ width: size, height: size, background: '#ffffff', borderRadius: 8 }} />}
      {label && <div className="qr-label">{label}</div>}
    </div>
  )
}
