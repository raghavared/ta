#!/usr/bin/env node
import { Command } from 'commander';
import { analyzeCommand } from './commands/analyze.js';
import { doctorCommand } from './commands/doctor.js';
import { healCommand } from './commands/heal.js';
import { exploreCommand } from './commands/explore.js';
import { generateCommand } from './commands/generate.js';
import { designCommand, requirementsCommand } from './commands/ingest.js';
import { initCommand } from './commands/init.js';
import { issuesCommand } from './commands/issues.js';
import { planCommand } from './commands/plan.js';
import { reportCommand } from './commands/report.js';
import { runCommand } from './commands/run.js';
import { serveCommand } from './commands/serve.js';
import { triageCommand } from './commands/triage.js';

const program = new Command();

program
  .name('ta')
  .description('Agentic UI testing platform: explore, plan, approve, generate, run, heal, learn')
  .version('0.1.0');

program
  .command('init')
  .description('Create a .ta workspace for a target app')
  .requiredOption('--url <url>', 'base URL of the target app')
  .option('--name <name>', 'project name (defaults to hostname)')
  .option('--dir <dir>', 'workspace directory (default: .ta)')
  .action(initCommand);

program
  .command('doctor')
  .description('Check environment and engine health')
  .action(doctorCommand);

program
  .command('explore')
  .description('Agentically explore the target UI and build the knowledge graph')
  .option('--max-states <n>', 'override maxStates budget')
  .option('--max-actions <n>', 'override maxActions budget')
  .option('--headed', 'show the browser while exploring')
  .action(exploreCommand);

program
  .command('requirements')
  .description('Ingest BRD/PRD docs into structured requirements (drives planning + RTM)')
  .option('--engine <id>', 'override the configured engine')
  .action(requirementsCommand);

program
  .command('design')
  .description('Ingest design screenshots as a source of truth (vision engine)')
  .option('--engine <id>', 'override the configured engine')
  .action(designCommand);

program
  .command('plan')
  .description('Plan human-readable test cases from the graph (review before generating)')
  .option('--sync', 'import reviewer decisions from testcases/*.md')
  .option('--engine <id>', 'override the configured engine')
  .action(planCommand);

program
  .command('generate')
  .description('Generate Playwright specs from APPROVED test cases only')
  .option('--engine <id>', 'override the configured engine')
  .action(generateCommand);

program
  .command('run')
  .description('Run generated Playwright tests and record results')
  .action(runCommand);

program
  .command('analyze')
  .description('Static-analyze the target source (testids, components) and ground selectors')
  .action(analyzeCommand);

program
  .command('heal')
  .description('Self-heal broken selectors: re-locate, patch selectors.ts, re-run')
  .option('--run <id>', 'heal failures from a specific run (default: latest)')
  .action(healCommand);

program
  .command('triage')
  .description('Classify failures (app-bug vs selector vs timing) and file issues')
  .option('--run <id>', 'triage a specific run (default: latest)')
  .option('--engine <id>', 'override the configured engine')
  .action(triageCommand);

program
  .command('issues')
  .description('List issues; --sync exports the issue sheet (CSV)')
  .option('--sync', 'export issues to .ta/issues.csv')
  .action(issuesCommand);

program
  .command('report')
  .description('Generate the standard test summary report (markdown + HTML)')
  .option('--run <id>', 'report on a specific run (default: latest)')
  .action(reportCommand);

program
  .command('serve')
  .description('Serve the web dashboard (graph, review queue, runs, issues, RTM)')
  .option('--port <port>', 'port (default 4700)')
  .action(serveCommand);

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
