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

declare let process: any;

import { describe, it, expect, beforeEach } from 'vitest';
import viteConfig from '../vite.config';

describe('Vite Configuration', () => {
  beforeEach(() => {
    process.env.VITE_GOOGLE_OAUTH_CLIENT_ID = '1234567890-testclientid.apps.googleusercontent.com';
  });

  it('configures base path as /api-keys/', async () => {
    // viteConfig can be a function returning UserConfig or Promise<UserConfig>
    const config = typeof viteConfig === 'function'
      ? await (viteConfig as Function)({ mode: 'development', command: 'serve' })
      : await viteConfig;

    expect(config.base).toBe('/api-keys/');
  });
});
