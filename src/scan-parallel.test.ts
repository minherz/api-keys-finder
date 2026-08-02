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
import { executeParallelScan } from './scan-parallel';
import { GcpProject } from './types';
import { getScannerConfig } from './utils';

vi.mock('./auth', () => ({
  getAuthToken: () => 'dummy_token'
}));

describe('scan-parallel unit tests', () => {
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

  it('should recover from GFE concurrency collisions (BACKEND_COLLISION)', async () => {
    const projects: GcpProject[] = [
      { projectId: 'proj-collision', name: 'Proj Collision', lifecycleState: 'ACTIVE', projectNumber: '123', createTime: '2026-01-01' }
    ];

    const warnSpy = vi.spyOn(console, 'warn');

    const mockFetch = vi.fn()
      // Attempt 1: 403 Forbidden with empty body (collision)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => ''
      } as Response)
      // Attempt 2: 403 Forbidden with empty body (collision)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => ''
      } as Response)
      // Attempt 3: Success!
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [{ uid: 'key-1' }] })
      } as Response);

    vi.stubGlobal('fetch', mockFetch);

    const onProgress = vi.fn();
    const onResult = vi.fn();
    const onError = vi.fn();

    const signal = new AbortController().signal;
    const result = await executeParallelScan(projects, signal, onProgress, onResult, onError);

    expect(result.quotaProject).toBe('proj-collision');
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toContain('[BACKEND_COLLISION]');
  });

  it('should retry unrecognized 502/429 transient errors', async () => {
    const projects: GcpProject[] = [
      { projectId: 'proj-badgateway', name: 'Proj Bad Gateway', lifecycleState: 'ACTIVE', projectNumber: '123', createTime: '2026-01-01' }
    ];

    const mockFetch = vi.fn()
      // Attempt 1: 502 Bad Gateway with raw html text
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: async () => '<html>502 Bad Gateway</html>'
      } as Response)
      // Attempt 2: Success!
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [{ uid: 'key-1' }] })
      } as Response);

    vi.stubGlobal('fetch', mockFetch);

    const onProgress = vi.fn();
    const onResult = vi.fn();
    const onError = vi.fn();

    const signal = new AbortController().signal;
    const result = await executeParallelScan(projects, signal, onProgress, onResult, onError);

    expect(result.quotaProject).toBe('proj-badgateway');
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('should treat unrecognized 403 as permanent and not retry', async () => {
    const projects: GcpProject[] = [
      { projectId: 'proj-unrecognized403', name: 'Proj Unrecognized 403', lifecycleState: 'ACTIVE', projectNumber: '123', createTime: '2026-01-01' }
    ];

    const customErrorBody = {
      error: {
        code: 403,
        status: 'PERMISSION_DENIED',
        message: 'This is a genuine permanent permission block.'
      }
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => JSON.stringify(customErrorBody)
    } as Response);

    vi.stubGlobal('fetch', mockFetch);

    const onProgress = vi.fn();
    const onResult = vi.fn();
    const onError = vi.fn();

    const signal = new AbortController().signal;
    const result = await executeParallelScan(projects, signal, onProgress, onResult, onError);

    expect(result.quotaProject).toBeNull();
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1); // No retries!
  });

  it('should defer SERVICE_DISABLED immediately to backlog sweep without retry', async () => {
    const projects: GcpProject[] = [
      { projectId: 'proj-disabled', name: 'Proj Disabled', lifecycleState: 'ACTIVE', projectNumber: '123', createTime: '2026-01-01' }
    ];

    const disabledErrorBody = {
      error: {
        code: 403,
        status: 'PERMISSION_DENIED',
        details: [{ reason: 'SERVICE_DISABLED' }]
      }
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => JSON.stringify(disabledErrorBody)
    } as Response);

    vi.stubGlobal('fetch', mockFetch);

    const onProgress = vi.fn();
    const onResult = vi.fn();
    const onError = vi.fn();

    const signal = new AbortController().signal;
    const result = await executeParallelScan(projects, signal, onProgress, onResult, onError);

    expect(result.quotaProject).toBeNull();
    expect(onResult).not.toHaveBeenCalled();
    // Reported backlog sweep failure since there was no quota project found
    expect(onError).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1); // No direct retry on SERVICE_DISABLED
  });

  it('should suppress logs if verbosity control is disabled', async () => {
    const projects: GcpProject[] = [
      { projectId: 'proj-nologs', name: 'Proj No Logs', lifecycleState: 'ACTIVE', projectNumber: '123', createTime: '2026-01-01' }
    ];

    // Disable debug logs
    localStorage.removeItem('api_keys_scanner_debug');

    const logSpy = vi.spyOn(console, 'log');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ keys: [] })
    } as Response);
    vi.stubGlobal('fetch', mockFetch);

    const onProgress = vi.fn();
    const onResult = vi.fn();
    const onError = vi.fn();

    const signal = new AbortController().signal;
    await executeParallelScan(projects, signal, onProgress, onResult, onError);

    // Scanner debug outputs should be completely suppressed
    const hasScannerDebugCall = logSpy.mock.calls.some(call => 
      call[0] && typeof call[0] === 'string' && call[0].includes('[SCANNER_DEBUG]')
    );
    expect(hasScannerDebugCall).toBe(false);
  });

  it('should retrieve dynamic threshold and debug configurations correctly from localStorage', () => {

    // Default configuration when empty
    localStorage.removeItem('api_keys_scanner_threshold');
    localStorage.removeItem('api_keys_scanner_debug');
    expect(getScannerConfig()).toEqual({ debug: false, threshold: 64 });

    // Custom threshold config
    localStorage.setItem('api_keys_scanner_threshold', '12');
    localStorage.setItem('api_keys_scanner_debug', 'true');
    expect(getScannerConfig()).toEqual({ debug: true, threshold: 12 });

    // Fallback on invalid non-numeric threshold
    localStorage.setItem('api_keys_scanner_threshold', 'not-a-number');
    expect(getScannerConfig().threshold).toBe(64);

    // Fallback on zero/negative values
    localStorage.setItem('api_keys_scanner_threshold', '-5');
    expect(getScannerConfig().threshold).toBe(64);
  });
});
