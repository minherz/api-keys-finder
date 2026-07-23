// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect } from 'vitest';
import {
  parseUrlHash,
  hasApiRestrictions,
  hasAppRestrictions,
  getRestrictionLevel,
  getHumanReadableRestrictions,
  formatDate
} from './utils';
import { ApiKeyRestrictions } from './types';

describe('utils.ts unit tests', () => {
  describe('parseUrlHash', () => {
    it('should parse standard query parameter hashes correctly', () => {
      const hash = '#access_token=ya29.xxxx&token_type=Bearer&expires_in=3600&state=secure_state';
      const parsed = parseUrlHash(hash);
      expect(parsed.access_token).toBe('ya29.xxxx');
      expect(parsed.token_type).toBe('Bearer');
      expect(parsed.expires_in).toBe('3600');
      expect(parsed.state).toBe('secure_state');
    });

    it('should work without the leading hash mark', () => {
      const hash = 'access_token=ya29.xxxx&state=123';
      const parsed = parseUrlHash(hash);
      expect(parsed.access_token).toBe('ya29.xxxx');
      expect(parsed.state).toBe('123');
    });

    it('should return empty object for empty or missing hash', () => {
      expect(parseUrlHash('')).toEqual({});
    });
  });

  describe('hasApiRestrictions', () => {
    it('should return false for empty or undefined restrictions', () => {
      expect(hasApiRestrictions(undefined)).toBe(false);
      expect(hasApiRestrictions({})).toBe(false);
    });

    it('should return false for empty apiTargets array', () => {
      expect(hasApiRestrictions({ apiTargets: [] })).toBe(false);
    });

    it('should return true when apiTargets has items', () => {
      expect(hasApiRestrictions({ apiTargets: [{ service: 'translate.googleapis.com' }] })).toBe(true);
    });
  });

  describe('hasAppRestrictions', () => {
    it('should return false for empty or undefined restrictions', () => {
      expect(hasAppRestrictions(undefined)).toBe(false);
      expect(hasAppRestrictions({})).toBe(false);
    });

    it('should return true for browser restrictions', () => {
      const r: ApiKeyRestrictions = {
        browserKeyRestrictions: { allowedReferrers: ['*.example.com'] }
      };
      expect(hasAppRestrictions(r)).toBe(true);
    });

    it('should return true for server restrictions', () => {
      const r: ApiKeyRestrictions = {
        serverKeyRestrictions: { allowedIps: ['192.168.1.1'] }
      };
      expect(hasAppRestrictions(r)).toBe(true);
    });

    it('should return true for android restrictions', () => {
      const r: ApiKeyRestrictions = {
        androidKeyRestrictions: {
          allowedApplications: [{ packageName: 'com.example', sha1Fingerprint: 'A1B2' }]
        }
      };
      expect(hasAppRestrictions(r)).toBe(true);
    });

    it('should return true for ios restrictions', () => {
      const r: ApiKeyRestrictions = {
        iosKeyRestrictions: { allowedBundleIds: ['com.example.bundle'] }
      };
      expect(hasAppRestrictions(r)).toBe(true);
    });

    it('should return false if arrays are empty', () => {
      const r: ApiKeyRestrictions = {
        browserKeyRestrictions: { allowedReferrers: [] },
        serverKeyRestrictions: { allowedIps: [] }
      };
      expect(hasAppRestrictions(r)).toBe(false);
    });
  });

  describe('getRestrictionLevel', () => {
    it('should return none when there are no restrictions', () => {
      expect(getRestrictionLevel(undefined)).toBe('none');
      expect(getRestrictionLevel({})).toBe('none');
    });

    it('should return some when only API restrictions are present', () => {
      const r: ApiKeyRestrictions = {
        apiTargets: [{ service: 'sheets.googleapis.com' }]
      };
      expect(getRestrictionLevel(r)).toBe('some');
    });

    it('should return some when only application restrictions are present', () => {
      const r: ApiKeyRestrictions = {
        browserKeyRestrictions: { allowedReferrers: ['*'] }
      };
      expect(getRestrictionLevel(r)).toBe('some');
    });

    it('should return full when both API and application restrictions are present', () => {
      const r: ApiKeyRestrictions = {
        apiTargets: [{ service: 'sheets.googleapis.com' }],
        browserKeyRestrictions: { allowedReferrers: ['*'] }
      };
      expect(getRestrictionLevel(r)).toBe('full');
    });
  });

  describe('getHumanReadableRestrictions', () => {
    it('should return warning for undefined restrictions', () => {
      const text = getHumanReadableRestrictions(undefined);
      expect(text[0]).toContain('No restrictions applied');
    });

    it('should detail API and Application restrictions correctly', () => {
      const r: ApiKeyRestrictions = {
        apiTargets: [{ service: 'sheets.googleapis.com', methods: ['GetValues'] }],
        browserKeyRestrictions: { allowedReferrers: ['https://example.com/*'] }
      };
      const text = getHumanReadableRestrictions(r);
      expect(text).toHaveLength(2);
      expect(text[0]).toContain('API Restrictions: Restricted to sheets.googleapis.com (methods: GetValues)');
      expect(text[1]).toContain('Application Restrictions (Web/Browser): Allowed referrers: https://example.com/*');
    });
  });

  describe('formatDate', () => {
    it('should handle undefined or invalid dates gracefully', () => {
      expect(formatDate(undefined)).toBe('Unknown');
      expect(formatDate('invalid-date')).toBe('Unknown');
    });

    it('should format valid ISO strings correctly', () => {
      const dateStr = '2026-07-04T12:00:00Z';
      const formatted = formatDate(dateStr);
      expect(formatted).not.toBe('Unknown');
      expect(formatted).toContain('2026');
    });
  });
});
