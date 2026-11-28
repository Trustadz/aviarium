/** Vite resolves imported SVG artwork to its emitted asset URL. */
declare module '*.svg' {
  const url: string
  export default url
}

/** Vite resolves imported PNG artwork to its emitted asset URL. */
declare module '*.png' {
  const url: string
  export default url
}
