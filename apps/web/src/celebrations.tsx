import type { CSSProperties } from 'react'
import type { Message } from './messages.js'

export interface CelebrationVisitor {
  id: string
  name: Message
  line: Message
  palette: { body: string; accent: string; detail: string }
}

export function celebrationStyleFor(visitor: CelebrationVisitor): CSSProperties {
  return {
    '--bird-body': visitor.palette.body,
    '--bird-accent': visitor.palette.accent,
    '--bird-detail': visitor.palette.detail,
  } as CSSProperties
}

export const celebrationVisitors: readonly CelebrationVisitor[] = [{
  id: 'budgerigar',
  name: 'Budgies',
  line: 'A flutter of applause.',
  palette: { body: '#7fbf5f', accent: '#f4d35e', detail: '#5a9bb5' },
}]

export function drawCelebration(_persist = true): CelebrationVisitor {
  return celebrationVisitors[0]
}

interface BudgiePalette {
  body: string
  wing: string
  wingDark: string
  face: string
  cheek: string
  tail: string
  beak: string
  eye: string
  mark: string
}

const green: BudgiePalette = {
  body: '#6fa84f', wing: '#3f6f38', wingDark: '#2a4f2c', face: '#e8c84a', cheek: '#5a8fa8',
  tail: '#2f6a68', beak: '#b98a3a', eye: '#1a241f', mark: '#1a2a1a',
}
const blue: BudgiePalette = {
  body: '#6f9fc0', wing: '#3f6f8a', wingDark: '#2a4f66', face: '#f0eeda', cheek: '#5a8fa8',
  tail: '#2f5f78', beak: '#b98a3a', eye: '#1a2428', mark: '#1a2a33',
}
const yellow: BudgiePalette = {
  body: '#e0c34a', wing: '#9a8430', wingDark: '#6f5f20', face: '#f5eaa0', cheek: '#5a8fa8',
  tail: '#7a6a2a', beak: '#b98a3a', eye: '#2a241a', mark: '#4a3a12',
}
const white: BudgiePalette = {
  body: '#e8e6d8', wing: '#b8c4bc', wingDark: '#8a9a90', face: '#f8f6ea', cheek: '#6a94a4',
  tail: '#96a8a0', beak: '#b98a3a', eye: '#222222', mark: '#5a6a60',
}

function Budgie({ palette, flap = '.22s' }: { palette: BudgiePalette; flap?: string }) {
  const style = {
    '--flap': flap,
    '--budgie-body': palette.body,
    '--budgie-wing': palette.wing,
    '--budgie-wing-dark': palette.wingDark,
    '--budgie-face': palette.face,
    '--budgie-cheek': palette.cheek,
    '--budgie-tail': palette.tail,
    '--budgie-beak': palette.beak,
    '--budgie-eye': palette.eye,
    '--budgie-mark': palette.mark,
  } as CSSProperties
  return <g className="budgie" style={style}>
    <g className="budgie-wing budgie-wing-far">
      <path d="M118 72 C102 50 80 34 54 26 C64 46 82 64 104 80Z" fill="var(--budgie-wing-dark)"/>
      <path d="M110 70 C96 52 80 40 62 32 C72 50 86 64 104 78Z" fill="var(--budgie-wing)" opacity=".45"/>
      <path d="M58 32 C70 48 86 64 102 78" fill="none" stroke="var(--budgie-mark)" strokeWidth="1.7" strokeLinecap="round" opacity=".65"/>
    </g>
    <g className="budgie-tail">
      <path d="M66 92 C48 104 28 120 6 136 C30 126 54 120 76 108Z" fill="var(--budgie-tail)"/>
      <path d="M62 98 C42 112 22 128 4 142 C30 130 54 122 78 112Z" fill="var(--budgie-wing-dark)"/>
      <path d="M72 96 C60 112 46 126 30 138 C52 126 70 118 86 110Z" fill="var(--budgie-tail)" opacity=".72"/>
      <path d="M60 106 C46 118 34 130 24 140 M70 108 C58 120 46 132 36 142" fill="none"
        stroke="var(--budgie-mark)" strokeWidth="1.3" strokeLinecap="round" opacity=".35"/>
    </g>
    <path d="M52 78 C68 60 96 50 124 54 C146 57 158 66 164 76 C170 86 162 96 146 102 C118 112 80 104 60 92 C50 86 48 82 52 78Z" fill="var(--budgie-body)"/>
    <path d="M82 100 C102 110 128 108 146 98 C132 112 104 116 84 106Z" fill="var(--budgie-face)" opacity=".22"/>
    <path d="M74 94 C84 91 94 94 100 100 C90 105 80 103 74 98Z" fill="var(--budgie-cheek)" opacity=".8"/>
    <g className="budgie-wing budgie-wing-near">
      <path d="M120 76 C104 50 80 30 48 22 C58 46 76 66 98 82 C108 90 118 86 120 76Z" fill="var(--budgie-wing)"/>
      <path d="M112 78 C100 62 84 48 64 38 C76 56 92 72 110 82Z" fill="var(--budgie-wing-dark)" opacity=".35"/>
      <path d="M54 30 C64 44 76 58 90 70 M64 26 C74 40 88 54 102 66" fill="none"
        stroke="var(--budgie-mark)" strokeWidth="2" strokeLinecap="round" opacity=".8"/>
    </g>
    <path d="M130 50 C144 44 158 50 164 62 C168 72 166 82 158 88 C148 80 136 78 126 82 C122 72 124 58 130 50Z" fill="var(--budgie-face)"/>
    <path d="M132 52 C142 47 154 50 161 59 M128 60 C138 55 150 57 158 65" fill="none"
      stroke="var(--budgie-mark)" strokeWidth="2" strokeLinecap="round" opacity=".72"/>
    <circle cx="150" cy="64" r="2.6" fill="var(--budgie-eye)"/>
    <circle cx="150.8" cy="63.2" r=".7" fill="#fffdf2" opacity=".8"/>
    <ellipse cx="147" cy="80" rx="3.4" ry="2.8" fill="var(--budgie-cheek)"/>
    <path d="M163 68 C170 69 174 74 169 78 C166 81 162 78 160 74Z" fill="var(--budgie-beak)"/>
    <path d="M110 104 C108 110 112 114 118 116 M124 106 C122 112 126 116 132 116" fill="none"
      stroke="var(--budgie-beak)" strokeWidth="2" strokeLinecap="round" opacity=".8"/>
  </g>
}

function FlockBird({ className, palette, size, delay, flip = false, flap = '.22s' }: {
  className: string; palette: BudgiePalette; size: number; delay: string; flip?: boolean; flap?: string
}) {
  return <g className={`flock-flight ${className}`} style={{ animationDelay: delay }}>
    <g className="flock-size" style={{ transform: `scale(${size})` }}>
      {flip ? <g transform="scale(-1 1)"><g transform="translate(-115 -90)"><Budgie palette={palette} flap={flap}/></g></g>
        : <g transform="translate(-115 -90)"><Budgie palette={palette} flap={flap}/></g>}
    </g>
  </g>
}

export function BudgieFlock() {
  return <svg className="budgie-art" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <FlockBird className="flight-1" palette={green} size={.62} delay="0s" flap=".18s"/>
    <FlockBird className="flight-2" palette={blue} size={.55} delay=".06s" flip flap=".2s"/>
    <FlockBird className="flight-3" palette={yellow} size={.46} delay=".14s" flap=".17s"/>
    <FlockBird className="flight-4" palette={green} size={.38} delay=".1s" flap=".22s"/>
    <FlockBird className="flight-5" palette={white} size={.36} delay=".2s" flip flap=".19s"/>
    <FlockBird className="flight-6" palette={blue} size={.32} delay=".28s" flap=".23s"/>
    <FlockBird className="flight-7" palette={yellow} size={.42} delay=".18s" flap=".19s"/>
    <FlockBird className="flight-1" palette={green} size={.34} delay=".13s" flap=".22s"/>
    <FlockBird className="flight-2" palette={blue} size={.32} delay=".19s" flip flap=".24s"/>
    <FlockBird className="flight-7" palette={white} size={.3} delay=".27s" flip flap=".21s"/>
  </svg>
}

type PieceShape = 'leaf' | 'feather' | 'seed' | 'petal'

interface BurstPiece {
  x: number
  y: number
  rotate: number
  delay: number
  scale: number
  shape: PieceShape
  fill: string
}

const fills = ['#7f9c6a', '#a8bb8d', '#f4d35e', '#5a9bb5', '#fffdf2', '#e07a5f', '#d9a441']
let seed = 17
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 2 ** 32
}
const shapes: PieceShape[] = ['leaf', 'feather', 'seed', 'petal']
const pieces: BurstPiece[] = Array.from({ length: 64 }, (_, index) => {
  const central = index < 14
  return {
    x: (random() * 2 - 1) * (central ? 220 : 640),
    y: central ? -390 - random() * 260 : -150 - random() * 460,
    rotate: random() * 720 - 360,
    delay: random() * .22,
    scale: central ? 1.05 + random() * .75 : .7 + random() * .95,
    shape: shapes[index % shapes.length],
    fill: fills[index % fills.length],
  }
})

function BurstShape({ shape, fill }: { shape: PieceShape; fill: string }) {
  if (shape === 'feather') return <g>
    <path d="M0 0 C9 12 10 32 0 44 C-10 32 -9 12 0 0Z" fill={fill}/>
    <path d="M0 7 V36" fill="none" stroke="#3d405b" strokeWidth="1.4" strokeLinecap="round" opacity=".4"/>
  </g>
  if (shape === 'seed') return <g>
    <ellipse cx="0" cy="0" rx="7" ry="4.2" fill={fill}/>
    <path d="M-5 0 H5" fill="none" stroke="#3d405b" strokeWidth="1.2" opacity=".35"/>
  </g>
  if (shape === 'petal') return <g>
    <circle cx="-5" cy="0" r="5" fill={fill}/>
    <circle cx="5" cy="0" r="5" fill={fill}/>
    <circle cx="0" cy="-5" r="5" fill={fill}/>
    <circle cx="0" cy="5" r="5" fill={fill}/>
    <circle cx="0" cy="0" r="3" fill="#d9a441"/>
  </g>
  return <g>
    <path d="M0 0 C12 -18 32 -19 42 0 C32 19 12 18 0 0Z" fill={fill}/>
    <path d="M5 0 H35" fill="none" stroke="#3d405b" strokeWidth="1.4" strokeLinecap="round" opacity=".3"/>
  </g>
}

export function CelebrationBurst() {
  return <svg className="burst-art" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <g transform="translate(600 830)">
      {pieces.map((piece, index) => <g key={index} className="burst-piece" style={{
        '--x': `${piece.x}px`, '--y': `${piece.y}px`, '--r': `${piece.rotate}deg`,
        '--delay': `${piece.delay}s`, '--scale': piece.scale,
      } as CSSProperties}>
        <BurstShape shape={piece.shape} fill={piece.fill}/>
      </g>)}
    </g>
  </svg>
}
let sparkleSeed = 91
const sparkleRandom = () => {
  sparkleSeed = (Math.imul(sparkleSeed, 1664525) + 1013904223) >>> 0
  return sparkleSeed / 2 ** 32
}
const sparkleFills = ['#f4d35e', '#fffdf2', '#5a9bb5', '#e07a5f']
const sparkles: BurstPiece[] = Array.from({ length: 18 }, (_, index) => ({
  x: (sparkleRandom() * 2 - 1) * 540,
  y: -240 - sparkleRandom() * 380,
  rotate: sparkleRandom() * 540 - 270,
  delay: sparkleRandom() * .3,
  scale: .35 + sparkleRandom() * .45,
  shape: index % 2 ? 'petal' : 'seed',
  fill: sparkleFills[index % sparkleFills.length],
}))

export function CelebrationSparkle() {
  return <svg className="sparkle-art" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <g transform="translate(600 830)">
      {sparkles.map((piece, index) => <g key={index} className="sparkle-piece" style={{
        '--x': `${piece.x}px`, '--y': `${piece.y}px`, '--r': `${piece.rotate}deg`,
        '--delay': `${piece.delay}s`, '--scale': piece.scale,
      } as CSSProperties}>
        <BurstShape shape={piece.shape} fill={piece.fill}/>
      </g>)}
    </g>
  </svg>
}
