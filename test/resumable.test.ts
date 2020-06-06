import { Resumable } from '../src/resumable';

/**
 * Dummy test
 */
describe('Resumable', () => {
  it('works if true is truthy', () => {
    expect(true).toBeTruthy();
  });

  it('Resumable is instantiable', () => {
    expect(new Resumable({})).toBeInstanceOf(Resumable);
  });
});
