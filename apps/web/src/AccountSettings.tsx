import { useEffect, useId, useRef, useState } from 'react'
import { ChevronUp, Settings2, Shield, UserRound } from 'lucide-react'
import { api, errorMessage, json, type SessionAccount } from './api.js'

export function Avatar({ name, src }: { name: string; src?: string | null }) {
  const [failed, setFailed] = useState<string>()
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase()
  return <span className="account-avatar" aria-hidden="true">
    {src && src !== failed ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(src)}/>
      : initials || <UserRound size={17}/>}
  </span>
}

export function AccountMenu({ account, open, administration }: {
  account?: SessionAccount
  open: (settings: 'display' | 'account') => void
  administration?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const options = useId()
  useEffect(() => {
    if (!expanded) return
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) setExpanded(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [expanded])

  if (!account) return <button className="account-trigger" aria-label="Device settings" onClick={() => open('display')}><Settings2 size={21}/><span>Device</span></button>

  function select(which: 'display' | 'account') {
    setExpanded(false)
    open(which)
  }
  return <div className="account-menu" ref={menu}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false) }}
    onKeyDown={event => {
      if (expanded && event.key === 'Escape') {
        event.stopPropagation()
        setExpanded(false)
        trigger.current?.focus()
      }
    }}>
    <button ref={trigger} className="account-trigger" aria-label={'Account menu for ' + account.name} title={account.name}
      aria-expanded={expanded} aria-controls={options} onClick={() => setExpanded(value => !value)}>
      <Avatar name={account.name} src={account.avatar}/><span>{account.name}</span><ChevronUp className="account-chevron" size={13} aria-hidden="true"/>
    </button>
    <div id={options} className="account-options" hidden={!expanded}>
      <button className="text-button" onClick={() => select('display')}><Settings2 size={17}/> Device settings</button>
      <button className="text-button" onClick={() => select('account')}><UserRound size={17}/> Account settings</button>
      {administration && <button className="text-button" onClick={() => {
        setExpanded(false)
        administration()
      }}><Shield size={17}/> Administration</button>}
    </div>
  </div>
}

async function avatarImage(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8_000_000)
    throw new Error('Choose a PNG, JPEG, or WebP image under 8 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare this image.')
    const size = Math.min(bitmap.width, bitmap.height)
    context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 128, 128)
    return canvas.toDataURL('image/webp', 0.85)
  } finally {
    bitmap.close()
  }
}

export function ProfileForm({ account, online, refresh }: {
  account: SessionAccount
  online: boolean
  refresh: () => Promise<void>
}) {
  const [name, setName] = useState(account.name)
  const [avatar, setAvatar] = useState<string | null>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const image = avatar === undefined ? account.avatar : avatar ?? account.pocketAvatar
  const disabled = busy || !online
  return <form className="profile-form" onSubmit={event => {
    event.preventDefault()
    setError('')
    setStatus('')
    setBusy(true)
    void api('/me/profile', json('PATCH', { name, avatar }), account.id).then(async () => {
      await refresh()
      setName(name.trim())
      setAvatar(undefined)
      setStatus('Profile saved.')
    }).catch(error => setError(errorMessage(error))).finally(() => setBusy(false))
  }}>
    <div className="profile-avatar">
      <Avatar name={name} src={image}/>
      <label>Avatar <input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        setError('')
        setStatus('')
        setBusy(true)
        void avatarImage(file).then(setAvatar).catch(error => setError(errorMessage(error))).finally(() => setBusy(false))
      }}/></label>
    </div>
    {(typeof avatar === 'string' || avatar === undefined && account.customAvatar) &&
      <button type="button" className="text-button" disabled={disabled} onClick={() => { setAvatar(null); setStatus('') }}>
        {account.testRole ? 'Use test avatar' : account.pocketAvatar ? 'Use Pocket ID avatar' : 'Use initials'}
      </button>}
    <label>Display name<input value={name} required maxLength={120} disabled={disabled} onChange={event => {
      setName(event.target.value); setStatus('')
    }}/></label>
    <button className="primary" disabled={disabled || !name.trim() || (name === account.name && avatar === undefined)}>Save profile</button>
    {error && <p role="alert" className="error">{error}</p>}
    {status && <p role="status">{status}</p>}
    {!online && <p>Reconnect to edit your profile.</p>}
  </form>
}
