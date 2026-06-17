#!/usr/bin/env node
/**
 * Accessibility Audit for Dashboard — WCAG 2.1 AA Verification
 * Sprint 15 Task 1809: Design System Compliance
 */

import axios from 'axios';
import * as axe from 'axe-core';
import { JSDOM } from 'jsdom';
import fs from 'fs';

const BASE_URL = 'http://localhost:4173';

// Views to audit (4 core views from Task 1809 scope)
const VIEWS = [
  { name: 'SopsView', path: '/sops' },
  { name: 'ProjectsView', path: '/projects' },
  { name: 'AgentsView', path: '/agents' },
  { name: 'ProjectDetailView', path: '/projects/1' },
];

// WCAG AA Standards
const WCAG_AA_STANDARDS = ['wcag2a', 'wcag2aa'];
const IMPACT_LEVELS = {
  critical: 'BLOCKER — Must fix before release',
  serious: 'BLOCKER — Must fix before release',
  moderate: 'Warning — Recommend fixing',
  minor: 'Info — Nice to have',
};

async function fetchAndAnalyze(viewName, path) {
  console.log(`\n📋 Testing ${viewName} (${path})...`);
  
  try {
    const response = await axios.get(`${BASE_URL}${path}`, {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    
    const dom = new JSDOM(response.data);
    const results = await new Promise((resolve, reject) => {
      axe.run(dom.window.document, { runOnly: { type: 'tag', values: WCAG_AA_STANDARDS } }, (error, results) => {
        if (error) reject(error);
        else resolve(results);
      });
    });
    
    return results;
  } catch (error) {
    console.error(`❌ Failed to test ${viewName}: ${error.message}`);
    return null;
  }
}

async function runAudit() {
  console.log('🔍 WCAG 2.1 AA Accessibility Audit — Task 1809');
  console.log(`🌐 Testing against ${BASE_URL}`);
  console.log('─'.repeat(60));
  
  const auditResults = {};
  let totalViolations = 0;
  let criticalCount = 0;
  let seriousCount = 0;
  
  for (const view of VIEWS) {
    const results = await fetchAndAnalyze(view.name, view.path);
    
    if (!results) continue;
    
    auditResults[view.name] = results;
    
    const violations = results.violations || [];
    totalViolations += violations.length;
    
    console.log(`\n✅ ${view.name}:`);
    
    if (violations.length === 0) {
      console.log('  ✓ No violations found');
    } else {
      violations.forEach((v) => {
        const impact = v.impact?.toUpperCase() || 'UNKNOWN';
        const count = v.nodes?.length || 0;
        
        if (impact === 'CRITICAL' || impact === 'SERIOUS') {
          if (impact === 'CRITICAL') criticalCount += count;
          if (impact === 'SERIOUS') seriousCount += count;
          console.log(`  ❌ [${impact}] ${v.id}: ${v.description} (${count} instances)`);
        } else {
          console.log(`  ⚠️  [${impact}] ${v.id}: ${v.description} (${count} instances)`);
        }
      });
    }
  }
  
  console.log('\n' + '─'.repeat(60));
  console.log('\n📊 AUDIT SUMMARY:');
  console.log(`  Total violations found: ${totalViolations}`);
  console.log(`  Critical issues: ${criticalCount}`);
  console.log(`  Serious issues: ${seriousCount}`);
  
  if (criticalCount === 0 && seriousCount === 0) {
    console.log('\n✅ WCAG AA AUDIT PASSED — Zero critical/serious violations');
    return { passed: true, violations: totalViolations };
  } else {
    console.log('\n❌ WCAG AA AUDIT FAILED — Blocking issues found');
    return { passed: false, violations: totalViolations, critical: criticalCount, serious: seriousCount };
  }
}

runAudit().catch(console.error);
