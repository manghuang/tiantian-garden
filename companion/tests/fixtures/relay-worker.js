import worker from '../../cloudflare/worker.js';
import { GardenControl } from '../../cloudflare/control.js';

// Test-only dependency injection. The deployed Worker has no mock-upstream switch.
export class TestControl extends GardenControl {
  constructor(ctx, env) { super(ctx, env); this.fetcher = (url, options) => env.TEST_UPSTREAM.fetch(new Request(url, options)); }
}
export default worker;
