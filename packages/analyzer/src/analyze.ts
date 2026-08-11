import { isAbsolute, join, relative } from 'node:path';
import { Node, Project, SyntaxKind } from 'ts-morph';
import { eq, like, sql } from 'drizzle-orm';
import { newId, type Workspace } from '@ta/core';
import { elements, selectors, sourceComponents, type TaDb } from '@ta/store';

export interface SourceTestId {
  /** Literal value, or a pattern like "todo-item-*" from a template literal. */
  value: string;
  isPattern: boolean;
  component: string;
  filePath: string;
}

export interface AnalyzeResult {
  components: number;
  testIds: SourceTestId[];
  linkedElements: number;
  boostedSelectors: number;
  /** testids present in source but never observed at runtime — coverage gaps. */
  unseenTestIds: SourceTestId[];
}

/**
 * Static analysis of the target app's source: extract data-testids (literal +
 * template patterns) per component, link them to runtime graph elements, boost
 * source-grounded selector scores, and surface source-only testids as gaps.
 */
export async function analyzeSource(params: {
  sourceRoot: string;
  ws: Workspace;
  db: TaDb;
  appId: string;
  onProgress?: (msg: string) => void;
}): Promise<AnalyzeResult> {
  const { db, appId } = params;
  const log = params.onProgress ?? (() => {});
  const root = isAbsolute(params.sourceRoot) ? params.sourceRoot : join(params.ws.root, params.sourceRoot);

  const project = new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { jsx: 4 } });
  project.addSourceFilesAtPaths([join(root, '**/*.tsx'), join(root, '**/*.jsx'), `!${join(root, '**/node_modules/**')}`]);
  const files = project.getSourceFiles();
  log(`scanning ${files.length} JSX/TSX files under ${root}`);

  const testIds: SourceTestId[] = [];
  const componentsByFile = new Map<string, Set<string>>();

  for (const file of files) {
    const filePath = relative(root, file.getFilePath());
    for (const attr of file.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
      if (attr.getNameNode().getText() !== 'data-testid') continue;
      const component = enclosingComponentName(attr) ?? '(anonymous)';
      const set = componentsByFile.get(filePath) ?? new Set<string>();
      set.add(component);
      componentsByFile.set(filePath, set);

      const initializer = attr.getInitializer();
      if (!initializer) continue;
      if (Node.isStringLiteral(initializer)) {
        testIds.push({ value: initializer.getLiteralValue(), isPattern: false, component, filePath });
      } else if (Node.isJsxExpression(initializer)) {
        const expr = initializer.getExpression();
        if (Node.isTemplateExpression(expr)) {
          // `todo-item-${id}` → pattern "todo-item-*"
          const head = expr.getHead().getLiteralText();
          const spansTail = expr.getTemplateSpans().map((s) => s.getLiteral().getLiteralText());
          const pattern = [head, ...spansTail].join('*');
          testIds.push({ value: pattern, isPattern: true, component, filePath });
        } else if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
          testIds.push({ value: expr.getLiteralText(), isPattern: false, component, filePath });
        }
      }
    }
  }

  // Persist component inventory (replace prior analysis for this app).
  db.delete(sourceComponents).where(eq(sourceComponents.appId, appId)).run();
  const componentIdByKey = new Map<string, string>();
  for (const [filePath, comps] of componentsByFile) {
    for (const comp of comps) {
      const id = newId('src');
      componentIdByKey.set(`${filePath}#${comp}`, id);
      db.insert(sourceComponents)
        .values({
          id,
          appId,
          filePath,
          exportName: comp,
          framework: 'react',
          testIdsJson: JSON.stringify(
            testIds.filter((t) => t.filePath === filePath && t.component === comp).map((t) => t.value),
          ),
        })
        .run();
    }
  }

  // Link runtime elements to source + boost grounded selectors.
  let linkedElements = 0;
  let boostedSelectors = 0;
  const seen = new Set<string>();
  for (const tid of testIds) {
    const sourceId = componentIdByKey.get(`${tid.filePath}#${tid.component}`) ?? null;
    const matches = tid.isPattern
      ? db.select().from(elements).where(like(elements.testId, tid.value.replace(/\*/g, '%'))).all()
      : db.select().from(elements).where(eq(elements.testId, tid.value)).all();
    if (matches.length > 0) seen.add(tid.value);
    for (const el of matches) {
      db.update(elements).set({ sourceComponentId: sourceId }).where(eq(elements.id, el.id)).run();
      linkedElements++;
      if (!tid.isPattern) {
        const boosted = db
          .update(selectors)
          .set({ score: sql`MIN(1.1, ${selectors.score} + 0.1)` })
          .where(eq(selectors.elementId, el.id))
          .run();
        boostedSelectors += boosted.changes;
      }
    }
  }

  const unseenTestIds = testIds.filter((t) => !seen.has(t.value));
  return {
    components: componentIdByKey.size,
    testIds,
    linkedElements,
    boostedSelectors,
    unseenTestIds,
  };
}

function enclosingComponentName(node: Node): string | undefined {
  let current: Node | undefined = node;
  while (current) {
    if (Node.isFunctionDeclaration(current) && current.getName()) return current.getName();
    if (Node.isVariableDeclaration(current)) return current.getName();
    current = current.getParent();
  }
  return undefined;
}
