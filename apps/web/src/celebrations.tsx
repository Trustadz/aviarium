import { useState, type CSSProperties } from 'react'

const budgieColors = {
  green: { body: '#9bac47', shade: '#73883d', face: '#ffe06a', wing: '#f0c950', ink: '#3d4931', cheek: '#788941' },
  blue: { body: '#62a9b5', shade: '#408795', face: '#fff0cc', wing: '#ead8b3', ink: '#294e60', cheek: '#508da4' },
  white: { body: '#faf9f3', shade: '#d9e0e5', face: '#fffdf7', wing: '#e7edf0', ink: '#60778b', cheek: '#8496ad' },
}

type BudgieColor = keyof typeof budgieColors

const cereColors = { hen: '#80513e', cock: '#487fb6' }
type BudgieSex = keyof typeof cereColors

function Budgie({ color, sex }: { color: BudgieColor; sex: BudgieSex }) {
  const { body, shade, face, wing, ink, cheek } = budgieColors[color]
  return <svg className="budgie-art" viewBox="0 0 160 132" aria-hidden="true">
    <path className="budgie-wing budgie-wing-far"
      d="M105 65C103 48 93 27 79 19C76 32 81 46 87 55C80 51 74 47 69 43C72 57 87 67 105 65Z"
      fill={shade}/>
    <path d="M78 77Q50 80 9 103Q26 105 68 91Q53 101 43 106Q68 103 93 82Z" fill={ink}/>
    <path d="M59 80C74 69 90 64 105 55C116 48 126 42 136 43C145 43 151 47 151 55C150 71 133 88 109 91C90 95 73 88 59 80Z"
      fill={body}/>
    <path d="M59 80C76 79 91 88 110 85C128 83 140 76 148 65C141 82 127 90 109 91C90 95 73 88 59 80Z"
      fill={shade}/>
    {color === 'white' && <path d="M67 77C79 68 91 65 105 57C111 59 113 66 109 71C103 79 85 83 67 77Z"
      fill="#8094a9"/>}
    <path d="M107 54C118 47 127 42 136 43C145 43 151 47 151 55C150 63 143 68 136 70C126 72 118 64 107 54Z"
      fill={face}/>
    <path d="M123 47Q120 51 124 56M117 49Q115 53 118 57M111 53Q110 56 113 59"
      fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round"/>
    <g className="budgie-wing">
      <path d="M104 65C97 48 84 30 66 18Q59 13 50 11Q50 19 60 32Q51 30 45 24Q48 37 63 46Q54 46 50 42Q57 57 78 62Q87 73 104 65Z"
        fill={wing}/>
      <path d="M52 16Q62 28 73 30Q70 38 81 42Q79 48 88 53Q73 53 65 45Q72 45 74 42Q61 39 54 32Q62 34 65 33Q56 25 52 16Z" fill={ink}/>
      <path d="M57 47Q70 54 78 52Q79 58 88 60Q92 63 96 63Q83 68 73 60Q63 58 57 47Z" fill={ink}/>
    </g>
    <ellipse cx="130" cy="61" rx="4.5" ry="2.7" transform="rotate(-29 130 61)" fill={cheek}/>
    <circle cx="129" cy="66" r="1.5" fill={ink}/>
    <circle cx="134" cy="67" r="1.3" fill={ink}/>
    <circle cx="139" cy="51" r="3.1" fill="#232827"/>
    <circle cx="140" cy="50" r="1" fill="#fffdf2"/>
    <path d="M147 56Q154 54 155 58Q155 63 150 65Q151 61 145 59Z" fill="#ce8b37"/>
    <path d="M144 55Q147 52 151 54Q154 56 150 58Q145 59 144 55Z" fill={cereColors[sex]}/>
  </svg>
}

const flock = [
  { color: 'blue', sex: 'cock' },
  { color: 'green', sex: 'hen' },
  { color: 'white', sex: 'hen' },
  { color: 'green', sex: 'cock' },
  { color: 'blue', sex: 'hen' },
  { color: 'white', sex: 'hen' },
  { color: 'green', sex: 'cock' },
] as const

const flightPaths = [
  { lane: 37, scale: .68, delay: 120, duration: 2070, flap: 245 },
  { lane: 60, scale: .74, delay: 240, duration: 2000, flap: 262 },
  { lane: 29, scale: .6, delay: 450, duration: 2060, flap: 226 },
  { lane: 47, scale: 1, delay: 0, duration: 1880, flap: 282 },
  { lane: 52, scale: .88, delay: 380, duration: 1960, flap: 254 },
  { lane: 69, scale: .9, delay: 540, duration: 1910, flap: 293 },
  { lane: 41, scale: .76, delay: 620, duration: 2030, flap: 238 },
] as const

export function BudgieFlock() {
  const [{ birds, direction }] = useState(() => {
    const birds = [...flock]
    for (let index = birds.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1))
      ;[birds[index], birds[swap]] = [birds[swap], birds[index]]
    }
    return { birds, direction: Math.random() < .5 ? 'right' : 'left' }
  })
  return <div className="celebration-flock" data-direction={direction} aria-hidden="true">
    {flightPaths.map((path, index) => <div key={path.delay} className="flock-flight" style={{
      '--lane': `${path.lane}%`,
      '--size': path.scale,
      '--flight-delay': `${path.delay}ms`,
      '--flight-duration': `${path.duration}ms`,
      '--flap-duration': `${path.flap}ms`,
      '--flap-phase': `-${path.delay % path.flap}ms`,
    } as CSSProperties}>
      <Budgie {...birds[index]}/>
    </div>)}
  </div>
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
