/**
 * tests/integrations/clickup/status-map.test.ts
 *
 * Test suite for bidirectional status mapping.
 * Verifies all OpenHiveOS states map correctly to ClickUp and vice versa.
 */

import { describe, it, expect } from 'vitest'
import {
  mapOpenHiveOSStatusToClickUp,
  mapClickUpStatusToOpenHiveOS,
} from '../../../src/integrations/clickup/status-map'

describe('status-map.ts', () => {
  describe('mapOpenHiveOSStatusToClickUp', () => {
    it('maps todo to open', () => {
      expect(mapOpenHiveOSStatusToClickUp('todo')).toBe('open')
    })

    it('maps wip to in_progress', () => {
      expect(mapOpenHiveOSStatusToClickUp('wip')).toBe('in_progress')
    })

    it('maps review to in_review', () => {
      expect(mapOpenHiveOSStatusToClickUp('review')).toBe('in_review')
    })

    it('maps done to closed', () => {
      expect(mapOpenHiveOSStatusToClickUp('done')).toBe('closed')
    })

    it('maps rework to open (reopen)', () => {
      expect(mapOpenHiveOSStatusToClickUp('rework')).toBe('open')
    })

    it('maps unknown status to open (safe default)', () => {
      expect(mapOpenHiveOSStatusToClickUp('unknown_status')).toBe('open')
      expect(mapOpenHiveOSStatusToClickUp('archived')).toBe('open')
      expect(mapOpenHiveOSStatusToClickUp('')).toBe('open')
    })
  })

  describe('mapClickUpStatusToOpenHiveOS', () => {
    it('maps open to todo', () => {
      expect(mapClickUpStatusToOpenHiveOS('open')).toBe('todo')
    })

    it('maps in_progress to wip', () => {
      expect(mapClickUpStatusToOpenHiveOS('in_progress')).toBe('wip')
    })

    it('maps in_review to review', () => {
      expect(mapClickUpStatusToOpenHiveOS('in_review')).toBe('review')
    })

    it('maps closed to done', () => {
      expect(mapClickUpStatusToOpenHiveOS('closed')).toBe('done')
    })

    it('maps unknown status to todo (safe default)', () => {
      expect(mapClickUpStatusToOpenHiveOS('unknown_status')).toBe('todo')
      expect(mapClickUpStatusToOpenHiveOS('archived')).toBe('todo')
      expect(mapClickUpStatusToOpenHiveOS('')).toBe('todo')
    })
  })

  describe('bidirectional mapping', () => {
    it('round-trips todo through both mappings', () => {
      const clickupStatus = mapOpenHiveOSStatusToClickUp('todo')
      const backToOpenHiveOS = mapClickUpStatusToOpenHiveOS(clickupStatus)
      expect(backToOpenHiveOS).toBe('todo')
    })

    it('round-trips wip through both mappings', () => {
      const clickupStatus = mapOpenHiveOSStatusToClickUp('wip')
      const backToOpenHiveOS = mapClickUpStatusToOpenHiveOS(clickupStatus)
      expect(backToOpenHiveOS).toBe('wip')
    })

    it('round-trips review through both mappings', () => {
      const clickupStatus = mapOpenHiveOSStatusToClickUp('review')
      const backToOpenHiveOS = mapClickUpStatusToOpenHiveOS(clickupStatus)
      expect(backToOpenHiveOS).toBe('review')
    })

    it('round-trips done through both mappings', () => {
      const clickupStatus = mapOpenHiveOSStatusToClickUp('done')
      const backToOpenHiveOS = mapClickUpStatusToOpenHiveOS(clickupStatus)
      expect(backToOpenHiveOS).toBe('done')
    })

    it('rework maps to open and back to todo (lossy by design)', () => {
      // rework → open → todo (this is expected; rework is an internal state)
      const clickupStatus = mapOpenHiveOSStatusToClickUp('rework')
      expect(clickupStatus).toBe('open')
      const backToOpenHiveOS = mapClickUpStatusToOpenHiveOS(clickupStatus)
      expect(backToOpenHiveOS).toBe('todo')
    })
  })
})
