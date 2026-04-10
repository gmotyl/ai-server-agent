import { useState, useEffect, useCallback } from 'react'

let globalShow: (msg: string) => void = () => {}

export function showToast(msg: string) {
  globalShow(msg)
}

export function Toast() {
  const [message, setMessage] = useState('')
  const [visible, setVisible] = useState(false)

  const show = useCallback((msg: string) => {
    setMessage(msg)
    setVisible(true)
    setTimeout(() => setVisible(false), 2500)
  }, [])

  useEffect(() => {
    globalShow = show
  }, [show])

  return (
    <div className={`
      fixed bottom-6 left-1/2 -translate-x-1/2 z-[200]
      bg-surface-2 text-lime border border-lime/20
      px-5 py-2.5 rounded-[10px] font-mono text-[0.8rem] font-medium
      shadow-[0_8px_24px_rgba(0,0,0,0.4)]
      transition-all duration-300
      ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'}
    `}>
      {message}
    </div>
  )
}
