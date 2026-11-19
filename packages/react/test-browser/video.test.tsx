// <AsciiVideo> on the CPU backend with a real clip. See videoScenarios.tsx.
import { describe } from 'vitest'
import { asciiVideoScenarios } from './videoScenarios.js'

describe('<AsciiVideo> with a real clip, CPU backend', () => {
  asciiVideoScenarios('cpu')
})
