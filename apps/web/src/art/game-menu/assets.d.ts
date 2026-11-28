/** Vite resolves imported SVG artwork to its emitted asset URL. */
declare module '*.svg' {
  const url: string
  export default url
}
