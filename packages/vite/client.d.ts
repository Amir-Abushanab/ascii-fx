declare module 'virtual:ascii-profile/*' {
  /** Pass to loadProfile()/useAsciiProfile()/component profile props. */
  const profileRef: { url: string; id: string }
  export default profileRef
}

declare module 'virtual:ascii-frame/*' {
  /** Pass to loadFrame() together with the matching profile. */
  const frameRef: { url: string; id: string; profile: string }
  export default frameRef
}
