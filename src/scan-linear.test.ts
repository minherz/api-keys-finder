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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeLinearScan } from './scan-linear';
import { GcpProject } from './types';

vi.mock('./auth', () => ({
  getAuthToken: () => 'dummy_token'
}));

describe('scan-linear unit tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock localStorage
    const store: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
      removeItem: vi.fn((key: string) => { delete store[key]; }),
      clear: vi.fn(() => { for (const k in store) delete store[k]; }),
      length: 0,
      key: vi.fn()
    } as any;

    // Enable debug logs for testing
    localStorage.setItem('api_keys_scanner_debug', 'true');
  });

  it('should scan projects sequentially and succeed', async () => {
    const projects: GcpProject[] = [
      { projectId: 'proj-1', name: 'Proj 1', lifecycleState: 'ACTIVE', projectNumber: '123', createTime: '2026-01-01' },
      { projectId: 'proj-2', name: 'Proj 2', lifecycleState: 'ACTIVE', projectNumber: '456', createTime: '2026-01-01' }
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        keys: [{ uid: 'key-123', displayName: 'My Key 1' }]
      })
    } as Response);
    vi.stubGlobal('fetch', mockFetch);

    const onProgress = vi.fn();
    const onResult = vi.fn();
    const onError = vi.fn();

    const signal = new AbortController().signal;
    const result = await executeLinearScan(projects, signal, onProgress, onResult, onError);

    expect(result.quotaProject).toBe('proj-2'); // Last successful direct scan
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it('should handle service disabled with immediate in-line quota borrowing', async () => {
    const projects: GcpProject[] = [
      { projectId: 'proj-working', name: 'Proj Working', lifecycleState: 'ACTIVE', projectNumber: '123', createTime: '2026-01-01' },
      { projectId: 'proj-disabled', name: 'Proj Disabled', lifecycleState: 'ACTIVE', projectNumber: '456', createTime: '2026-01-01' }
    ];

    const disabledResponse = {
      error: {
        code: 403,
        status: 'PERMISSION_DENIED',
        details: [{ reason: 'SERVICE_DISABLED' }]
      }
    };

    const mockFetch = vi.fn()
      // proj-working direct scan (succeeds)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [{ uid: 'key-1' }] })
      } as Response)
      // proj-disabled direct scan (fails with service disabled)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => JSON.stringify(disabledResponse)
      } as Response)
      // proj-disabled retry borrowing from proj-working (succeeds)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [{ uid: 'key-2' }] })
      } as Response);

    vi.stubGlobal('fetch', mockFetch);

    const onProgress = vi.fn();
    const onResult = vi.fn();
    const onError = vi.fn();

    const signal = new AbortController().signal;
    const result = await executeLinearScan(projects, signal, onProgress, onResult, onError);

    expect(result.quotaProject).toBe('proj-working');
    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();

    // Verify correct x-goog-user-project header on retry
    const lastFetchCallHeaders = mockFetch.mock.calls[2][1].headers;
    expect(lastFetchCallHeaders['x-goog-user-project']).toBe('proj-working');
  });

  it('should handle post-scan backlog retry sweep', async () => {
    const projects: GcpProject[] = [
      { projectId: 'proj-disabled', name: 'Proj Disabled', lifecycleState: 'ACTIVE', projectNumber: '123', createTime: '2026-01-01' },
      { projectId: 'proj-working', name: 'Proj Working', lifecycleState: 'ACTIVE', projectNumber: '456', createTime: '2026-01-01' }
    ];

    const disabledResponse = {
      error: {
        code: 403,
        status: 'PERMISSION_DENIED',
        details: [{ reason: 'SERVICE_DISABLED' }]
      }
    };

    const mockFetch = vi.fn()
      // proj-disabled direct scan (fails with service disabled)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => JSON.stringify(disabledResponse)
      } as Response)
      // proj-working direct scan (succeeds, establishes quotaProjectId)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [{ uid: 'key-1' }] })
      } as Response)
      // proj-disabled backlog retry borrowing from proj-working (succeeds)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [{ uid: 'key-2' }] })
      } as Response);

    vi.stubGlobal('fetch', mockFetch);

    const onProgress = vi.fn();
    const onResult = vi.fn();
    const onError = vi.fn();

    const signal = new AbortController().signal;
    const result = await executeLinearScan(projects, signal, onProgress, onResult, onError);

    expect(result.quotaProject).toBe('proj-working');
    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });
});
