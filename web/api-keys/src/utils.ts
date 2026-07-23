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

import { ApiKeyRestrictions, RestrictionLevel } from './types';

/**
 * Parses the URL hash parameters returned by Google OAuth.
 */
export function parseUrlHash(hash: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!hash) return params;

  // Remove the leading '#'
  const normalizedHash = hash.startsWith('#') ? hash.substring(1) : hash;
  const pairs = normalizedHash.split('&');

  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
  }

  return params;
}

/**
 * Checks if API restrictions are configured.
 */
export function hasApiRestrictions(restrictions?: ApiKeyRestrictions): boolean {
  return !!(
    restrictions &&
    restrictions.apiTargets &&
    restrictions.apiTargets.length > 0
  );
}

/**
 * Checks if application restrictions (browser, server, android, or ios) are configured.
 */
export function hasAppRestrictions(restrictions?: ApiKeyRestrictions): boolean {
  if (!restrictions) return false;

  const hasBrowser = !!(
    restrictions.browserKeyRestrictions?.allowedReferrers &&
    restrictions.browserKeyRestrictions.allowedReferrers.length > 0
  );

  const hasServer = !!(
    restrictions.serverKeyRestrictions?.allowedIps &&
    restrictions.serverKeyRestrictions.allowedIps.length > 0
  );

  const hasAndroid = !!(
    restrictions.androidKeyRestrictions?.allowedApplications &&
    restrictions.androidKeyRestrictions.allowedApplications.length > 0
  );

  const hasIos = !!(
    restrictions.iosKeyRestrictions?.allowedBundleIds &&
    restrictions.iosKeyRestrictions.allowedBundleIds.length > 0
  );

  return hasBrowser || hasServer || hasAndroid || hasIos;
}

/**
 * Categorizes the restriction level of an API Key.
 */
export function getRestrictionLevel(restrictions?: ApiKeyRestrictions): RestrictionLevel {
  const api = hasApiRestrictions(restrictions);
  const app = hasAppRestrictions(restrictions);

  if (api && app) {
    return 'full';
  } else if (api || app) {
    return 'some';
  } else {
    return 'none';
  }
}

/**
 * Formats restrictions into a human-readable list of strings for tooltips.
 */
export function getHumanReadableRestrictions(restrictions?: ApiKeyRestrictions): string[] {
  if (!restrictions) {
    return ['No restrictions applied. This key is vulnerable and can be used to call any enabled API from any environment.'];
  }

  const list: string[] = [];

  // API targets
  if (hasApiRestrictions(restrictions)) {
    const targets = restrictions.apiTargets!.map(t => {
      const methodsStr = t.methods && t.methods.length > 0 ? ` (methods: ${t.methods.join(', ')})` : '';
      return `${t.service}${methodsStr}`;
    });
    list.push(`API Restrictions: Restricted to ${targets.join(', ')}`);
  } else {
    list.push('API Restrictions: None (can call any Google Cloud API)');
  }

  // Browser referrers
  if (restrictions.browserKeyRestrictions?.allowedReferrers && restrictions.browserKeyRestrictions.allowedReferrers.length > 0) {
    list.push(`Application Restrictions (Web/Browser): Allowed referrers: ${restrictions.browserKeyRestrictions.allowedReferrers.join(', ')}`);
  }

  // Server IPs
  if (restrictions.serverKeyRestrictions?.allowedIps && restrictions.serverKeyRestrictions.allowedIps.length > 0) {
    list.push(`Application Restrictions (Server): Allowed IPs: ${restrictions.serverKeyRestrictions.allowedIps.join(', ')}`);
  }

  // Android apps
  if (restrictions.androidKeyRestrictions?.allowedApplications && restrictions.androidKeyRestrictions.allowedApplications.length > 0) {
    const apps = restrictions.androidKeyRestrictions.allowedApplications.map(app => {
      const shaShort = app.sha1Fingerprint ? ` [SHA1: ${app.sha1Fingerprint.substring(0, 8)}...]` : '';
      return `${app.packageName}${shaShort}`;
    });
    list.push(`Application Restrictions (Android): Allowed apps: ${apps.join(', ')}`);
  }

  // iOS apps
  if (restrictions.iosKeyRestrictions?.allowedBundleIds && restrictions.iosKeyRestrictions.allowedBundleIds.length > 0) {
    list.push(`Application Restrictions (iOS): Allowed bundle IDs: ${restrictions.iosKeyRestrictions.allowedBundleIds.join(', ')}`);
  }

  if (!hasAppRestrictions(restrictions)) {
    list.push('Application Restrictions: None (can be called from any server, IP, website, or mobile application)');
  }

  return list;
}

/**
 * Copies a string of text to the clipboard using the modern Clipboard API.
 * Falls back to execCommand if not supported in old browsers.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    }
  } catch (err) {
    console.error('Failed to copy text: ', err);
    return false;
  }
}

/**
 * Formats an ISO 8601 date string into a clean, human-readable date.
 */
export function formatDate(isoString?: string): string {
  if (!isoString) return 'Unknown';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return 'Unknown';
  }
}
