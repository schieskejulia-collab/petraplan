import assert from 'node:assert/strict';
import test from 'node:test';
import { createQueryDefinition } from './queryDefinition.js';

test('normalizes a query definition into auditable sections', () => {
  const definition = createQueryDefinition({
    queryId: ' ZECOPAM1Q0003 ',
    dataProvider: ' ZECOPAM1 ',
    filters: [{
      infoObject: ' 0COMP_CODE ',
      restriction: 'single value',
      fromValue: '1000',
    }],
    freeCharacteristics: [' 0MATERIAL ', '0PLANT'],
    structures: [
      { elementName: 'Revenue', infoObject: ' 0NET_SALES ' },
      { elementName: 'Margin', formula: 'Revenue - Cost' },
    ],
    variables: [{
      name: 'Period',
      infoObject: '0CALMONTH',
      variableType: 'characteristic',
      processingType: 'customer exit',
      parameter: 'current period minus 1',
    }],
  });

  assert.deepEqual(definition, {
    queryId: 'ZECOPAM1Q0003',
    dataProvider: 'ZECOPAM1',
    filters: [{
      infoObject: '0COMP_CODE',
      restriction: 'single value',
      fromValue: '1000',
    }],
    freeCharacteristics: ['0MATERIAL', '0PLANT'],
    structures: [
      { elementName: 'Revenue', infoObject: '0NET_SALES' },
      { elementName: 'Margin', formula: 'Revenue - Cost' },
    ],
    variables: [{
      name: 'Period',
      infoObject: '0CALMONTH',
      variableType: 'characteristic',
      processingType: 'customer exit',
      parameter: 'current period minus 1',
    }],
  });
});

test('keeps formulas separate from source fields', () => {
  const definition = createQueryDefinition({
    queryId: 'Q-MARGIN',
    dataProvider: 'CUBE-SALES',
    structures: [{
      elementName: 'Contribution',
      formula: 'Revenue - VariableCosts',
    }],
  });

  assert.equal(definition.structures[0]?.infoObject, undefined);
  assert.equal(definition.structures[0]?.formula, 'Revenue - VariableCosts');
});

test('rejects incomplete query sections instead of guessing', () => {
  assert.throws(
    () => createQueryDefinition({
      queryId: 'Q-INVALID',
      dataProvider: 'CUBE-SALES',
      filters: [{ infoObject: '', restriction: 'single value' }],
    }),
    /filters\[0\]\.infoObject is required/,
  );

  assert.throws(
    () => createQueryDefinition({
      queryId: 'Q-INVALID',
      dataProvider: 'CUBE-SALES',
      structures: [{ elementName: 'Unknown' }],
    }),
    /requires infoObject or formula/,
  );

  assert.throws(
    () => createQueryDefinition({
      queryId: 'Q-INVALID',
      dataProvider: 'CUBE-SALES',
      variables: [{
        name: 'Period',
        infoObject: '0CALMONTH',
        variableType: '',
        processingType: 'manual',
      }],
    }),
    /variables\[0\]\.variableType is required/,
  );
});
