// The CPU backend against a real <video>. See videoScenarios.ts.
import { describe } from 'vitest'
import { videoScenarios } from './videoScenarios.js'

describe('a real video on the CPU backend', () => {
  videoScenarios('cpu')
})
