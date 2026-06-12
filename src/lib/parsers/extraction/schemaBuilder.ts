import type { Line, TableRegion, ColumnSchema, ColumnDef } from './extractionTypes';
import { COLUMN_BUFFER_PX } from './extractionTypes';
import { countDistinctConcepts, matchConcept } from './headerSynonyms';

function schemasMatchByConcepts(schema: ColumnSchema, headerLine: Line): boolean {
  if (schema.columns.length !== headerLine.items.length) return false;
  const { concepts: existingConcepts } = countDistinctConcepts(
    schema.columns.map(c => c.headerText),
  );
  const { concepts: newConcepts } = countDistinctConcepts(
    headerLine.items.map(i => i.text),
  );
  if (existingConcepts.size !== newConcepts.size) return false;
  for (const [idx, concept] of existingConcepts) {
    if (newConcepts.get(idx) !== concept) return false;
  }
  return true;
}

export function buildColumnSchemas(
  lines: Line[],
  regions: TableRegion[],
): ColumnSchema[] {
  const schemas: ColumnSchema[] = [];

  for (let ri = 0; ri < regions.length; ri++) {
    const region = regions[ri];
    const headerLine = lines[region.startLineIndex];

    // If no header line exists for this region, attempt schema inheritance
    if (!headerLine || !headerLine.items.length) {
      if (schemas.length > 0) {
        schemas.push({
          ...schemas[schemas.length - 1],
          sourceRegionIndex: ri,
        });
      }
      // No previous schema exists — region has no schema, falls through as prose
      continue;
    }

    const { concepts } = countDistinctConcepts(headerLine.items.map(i => i.text));

    let dateColumnIndex = 0;
    for (const [idx, concept] of concepts) {
      if (concept === 'date') {
        dateColumnIndex = idx;
        break;
      }
    }

    // Check if this matches a previous schema by concepts (not raw text)
    const matchingSchema = schemas.find(s => schemasMatchByConcepts(s, headerLine));

    if (matchingSchema) {
      schemas.push({
        ...matchingSchema,
        sourceRegionIndex: ri,
      });
    } else {
      const columns: ColumnDef[] = headerLine.items.map((item, i) => ({
        index: i,
        headerText: item.text,
        columnLeft: item.x - COLUMN_BUFFER_PX,
        columnRight: item.right + COLUMN_BUFFER_PX,
        type: (matchConcept(item.text) ?? 'unknown') as ColumnDef['type'],
      }));

      schemas.push({
        columns,
        dateColumnIndex,
        sourceRegionIndex: ri,
      });
    }
  }

  return schemas;
}
