import { useState } from 'react'

export function Avatar({ name, url }: { name: string; url?: string | null }) {
  const [failed, setFailed] = useState(false)
  if (url && !failed)
    return <img className="leaderboard-avatar" src={url} alt="" referrerPolicy="no-referrer" loading="lazy"
      onError={() => setFailed(true)}/>
  return <span className="leaderboard-avatar leaderboard-avatar-initials" aria-hidden="true">
    {(name.trim().slice(0, 1) || '?').toUpperCase()}</span>
}
