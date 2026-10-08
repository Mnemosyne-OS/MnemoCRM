import {
  addStage,
  boardColumns,
  closeDeal,
  createDeal,
  moveDeal,
  moveStage,
  normalizeDeal,
  normalizeSettings,
  parseAmount,
  removeStage,
  renameStage,
  reopenDeal,
  starterSettings,
  totalOf,
} from './deal';
import type { Deal } from './types';

const deal = (over: Partial<Deal> & { id: string; stageId: string }): Deal => ({
  schema: 1,
  title: over.id,
  productIds: [],
  history: [],
  ...over,
});

describe('parseAmount: what a person types', () => {
  it.each([
    ['120', 120],
    ['120,50', 120.5],
    ['1 200', 1200],
    ['1200.5', 1200.5],
    ['45 €', 45],
  ])('%s → %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it('empty is ABSENT, not zero', () => {
    expect(parseAmount('   ')).toBeUndefined();
  });

  it('unreadable or negative is refused (null), never guessed', () => {
    for (const bad of ['-5', 'abc', '12,345', '1.2.3']) expect(parseAmount(bad)).toBeNull();
  });
});

describe('settings', () => {
  it('writes the starter stages with the labels of the moment', () => {
    const s = starterSettings((id) => `L-${id}`);
    expect(s.stages.map((x) => x.label)).toEqual(['L-request', 'L-quote', 'L-making', 'L-delivered', 'L-paid']);
    expect(s.currency).toBe('EUR');
  });

  it('refuses a file with no usable stage, so the caller can leave it intact', () => {
    expect(normalizeSettings({ stages: [] })).toBeNull();
    expect(normalizeSettings({ stages: [{ id: 'a' }] })).toBeNull();
    expect(normalizeSettings('x')).toBeNull();
  });

  it('drops duplicate stage ids and a bad currency', () => {
    const s = normalizeSettings({ stages: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }], currency: 'euros' })!;
    expect(s.stages).toEqual([{ id: 'a', label: 'A' }]);
    expect(s.currency).toBe('EUR');
  });
});

describe('deals', () => {
  it('keeps a deal whose stage disappeared, under its old id', () => {
    const d = normalizeDeal({ id: 'd1', title: 'Bols', stageId: 'gone' })!;
    const cols = boardColumns([d], [{ id: 'a', label: 'A' }]);
    expect(cols).toHaveLength(2);
    expect(cols[1].stage).toBeNull();
    expect(cols[1].deals[0].id).toBe('d1');
  });

  it('shows no orphan column when every deal has a known stage', () => {
    expect(boardColumns([deal({ id: 'd', stageId: 'a' })], [{ id: 'a', label: 'A' }])).toHaveLength(1);
  });

  it('keeps closed deals off the board', () => {
    const closed = closeDeal(deal({ id: 'd', stageId: 'a' }), 'won', 'won');
    expect(boardColumns([closed], [{ id: 'a', label: 'A' }])[0].deals).toEqual([]);
  });

  it('an unreadable amount is absent, never 0', () => {
    expect('amount' in normalizeDeal({ id: 'd', title: 'T', stageId: 'a', amount: 'lots' })!).toBe(false);
    expect('amount' in normalizeDeal({ id: 'd', title: 'T', stageId: 'a', amount: -3 })!).toBe(false);
    expect(normalizeDeal({ id: 'd', title: 'T', stageId: 'a', amount: 0 })!.amount).toBe(0);
  });

  it('writes a move in the history, and does nothing when the stage is the same', () => {
    const d = deal({ id: 'd', stageId: 'a' });
    expect(moveDeal(d, { id: 'a', label: 'A' }, 'x')).toBe(d);
    const moved = moveDeal(d, { id: 'b', label: 'B' }, 'Moved to B');
    expect(moved.stageId).toBe('b');
    expect(moved.history[0].text).toBe('Moved to B');
  });

  it('reopening removes the closing mark and keeps the history', () => {
    const reopened = reopenDeal(closeDeal(deal({ id: 'd', stageId: 'a' }), 'lost', 'lost'), 'back');
    expect(reopened.closed).toBeUndefined();
    expect(reopened.history.map((e) => e.text)).toEqual(['back', 'lost']);
  });

  it('creates with dates and a file-safe id', () => {
    const d = createDeal({ title: 'Vase', stageId: 'a' }, new Date('2026-09-24T10:00:00Z'))!;
    expect(d.id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(d.createdAt).toBe('2026-09-24T10:00:00.000Z');
  });
});

describe('totals', () => {
  it('no amount anywhere is NO total (a dash), not 0', () => {
    expect(totalOf([deal({ id: 'a', stageId: 's' })])).toBeNull();
    expect(totalOf([])).toBeNull();
  });

  it('a total with missing amounts is marked partial', () => {
    expect(totalOf([deal({ id: 'a', stageId: 's', amount: 100 }), deal({ id: 'b', stageId: 's' })])).toEqual({ sum: 100, counted: 1, partial: true });
    expect(totalOf([deal({ id: 'a', stageId: 's', amount: 0.1 }), deal({ id: 'b', stageId: 's', amount: 0.2 })])).toEqual({ sum: 0.3, counted: 2, partial: false });
  });
});

describe('editing stages', () => {
  const s = starterSettings((id) => id);

  it('refuses to remove a stage that still holds open deals, and says how many', () => {
    const res = removeStage(s, 'quote', [deal({ id: '1', stageId: 'quote' }), deal({ id: '2', stageId: 'quote' })]);
    expect(res).toEqual({ error: 'STAGE_NOT_EMPTY', count: 2 });
  });

  it('a closed deal does not pin its stage', () => {
    const res = removeStage(s, 'quote', [closeDeal(deal({ id: '1', stageId: 'quote' }), 'won', 'w')]);
    expect('error' in res).toBe(false);
  });

  it('keeps at least one stage', () => {
    const one = { ...s, stages: [s.stages[0]] };
    expect(removeStage(one, s.stages[0].id, [])).toEqual({ error: 'LAST_STAGE' });
  });

  it('refuses an empty name, caps the count, reorders within bounds', () => {
    expect(addStage(s, '  ')).toEqual({ error: 'EMPTY_LABEL' });
    expect(renameStage(s, 'quote', '')).toEqual({ error: 'EMPTY_LABEL' });
    let many = s;
    for (let i = 0; i < 7; i++) many = addStage(many, `x${i}`) as typeof s;
    expect(addStage(many, 'one too many')).toEqual({ error: 'TOO_MANY' });
    expect(moveStage(s, 'request', -1)).toBe(s);
    expect(moveStage(s, 'request', 1).stages.map((x) => x.id).slice(0, 2)).toEqual(['quote', 'request']);
  });
});
